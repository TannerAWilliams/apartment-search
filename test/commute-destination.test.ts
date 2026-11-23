import { test, expect } from 'bun:test';
import { parseFilters } from '../src/search.ts';
import { resolveWorkplace, routeCommutes, CommuteError } from '../server/commute.ts';

test('preset and coordinate destinations resolve without transmitting a location', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error('Unexpected external request');
  };
  expect((await resolveWorkplace(parseFilters({ workplace: 'rockefeller' }), fetcher))?.label).toBeTruthy();
  expect(await resolveWorkplace(parseFilters({ workplace: 'custom', customWorkplace: '40.75, -73.98' }), fetcher)).toEqual({
    label: 'Custom workplace',
    latitude: 40.75,
    longitude: -73.98,
  });
  expect(calls).toBe(0);
});

test('a typed place or address is found with OpenStreetMap, and exact addresses also with the Census geocoder', async () => {
  const filters = parseFilters({ workplace: 'custom', customWorkplace: 'Empire State Building' });
  const asked: URL[] = [];
  const osm = async (url: string, init?: RequestInit) => {
    asked.push(new URL(url));
    expect(new Headers(init?.headers).get('User-Agent')).toContain('ApartmentSearch');
    return Response.json([
      { display_name: 'Empire State Building, 350, 5th Avenue, Koreatown, Manhattan', lat: '40.7484', lon: '-73.9857' },
    ]);
  };
  expect(await resolveWorkplace(filters, osm)).toEqual({
    label: 'Empire State Building, 350, 5th Avenue',
    latitude: 40.7484,
    longitude: -73.9857,
  });
  // Searched within the NY, NJ and CT area only.
  expect(asked[0]?.hostname).toBe('nominatim.openstreetmap.org');
  expect(Object.fromEntries(asked[0]!.searchParams)).toMatchObject({ q: 'Empire State Building', bounded: '1', countrycodes: 'us' });

  // Nothing found, an error, or an unusable answer from OpenStreetMap: the Census geocoder tries the exact address.
  const census = {
    result: { addressMatches: [{ matchedAddress: '350 FIFTH AVE, NEW YORK, NY, 10118', coordinates: { x: -73.9857, y: 40.7484 } }] },
  };
  for (const osmAnswer of [
    Response.json([]),
    new Response('busy', { status: 503 }),
    Response.json({}),
    Response.json([{ lat: 'x', lon: '1' }]),
  ]) {
    const destination = await resolveWorkplace(filters, async (url) =>
      new URL(url).hostname === 'nominatim.openstreetmap.org' ? osmAnswer.clone() : Response.json(census),
    );
    expect(destination?.label).toBe('350 FIFTH AVE, NEW YORK, NY, 10118');
  }
  // Neither finds it: a message that says what to type instead.
  const nowhere = async (url: string) =>
    new URL(url).hostname === 'nominatim.openstreetmap.org' ? Response.json([]) : Response.json({ result: { addressMatches: [] } });
  await expect(resolveWorkplace(filters, nowhere)).rejects.toThrow('a street address with the city, or a landmark name');
  // A nameless match keeps what was typed as its label.
  expect((await resolveWorkplace(filters, async () => Response.json([{ lat: '40.7', lon: '-74' }])))?.label).toBe('Empire State Building');
});

test("OpenStreetMap answers are kept in Cloudflare's cache, so a repeated destination is not asked for again", async () => {
  const store = new Map<string, Response>();
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, response: Response) => void store.set(url, response),
  };
  const scope = globalThis as { caches?: unknown };
  scope.caches = { default: cache };
  try {
    let requests = 0;
    const osm = async () => {
      requests++;
      return Response.json([{ display_name: 'Hoboken (PATH), Hudson Place, Downtown', lat: '40.7355', lon: '-74.0288' }]);
    };
    const filters = parseFilters({ workplace: 'custom', customWorkplace: 'Hoboken PATH' });
    const first = await resolveWorkplace(filters, osm);
    const second = await resolveWorkplace(filters, osm);
    expect(second).toEqual(first);
    expect(requests).toBe(1);
    expect([...store.values()][0]?.headers.get('Cache-Control')).toBe('max-age=2592000');
  } finally {
    delete scope.caches;
  }
});

test('disconnected or failed routing never manufactures estimates for a changed destination', async () => {
  const destination = { label: 'New destination', latitude: 40.75, longitude: -73.98 };
  const listings = [{ latitude: 40.72, longitude: -74.0, transitSeconds: 60 }];
  await expect(
    routeCommutes(listings, destination, null, async () => {
      throw new Error('No request permitted');
    }),
  ).rejects.toBeInstanceOf(CommuteError);
  await expect(
    routeCommutes(listings, destination, { appId: 'synthetic', apiKey: 'synthetic' }, async () => Response.json({}, { status: 503 })),
  ).rejects.toThrow('couldn’t calculate routes');
});
