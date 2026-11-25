import { expect, test } from 'bun:test';
import { suggestPlaces } from '../server/commute.ts';
import { handleApi } from './fixtures/api.ts';
import './fixtures/quiet-logs.ts';

const feature = (properties: Record<string, unknown>, coordinates: unknown = [-73.9857, 40.7484]) => ({
  geometry: { coordinates },
  properties,
});
const photon = {
  features: [
    feature({ name: 'Empire State Building', housenumber: '350', street: '5th Avenue', city: 'New York', state: 'New York' }),
    feature({ name: 'Empire State Building', housenumber: '350', street: '5th Avenue', city: 'New York', state: 'New York' }),
    feature({ housenumber: '1', street: 'Main St', district: 'Brooklyn', state: 'New York' }),
    feature({ street: 'Grove St', county: 'Hudson', state: 'New Jersey' }),
    feature({ name: 'Nowhere' }, ['x', 'y']),
    feature({}),
    null,
  ],
};

test('places are suggested as a destination is typed, within the area, each once', async () => {
  const urls: string[] = [];
  const places = await suggestPlaces('empire st', async (url) => {
    urls.push(String(url));
    return Response.json(photon);
  });
  expect(places.map(({ label }) => label)).toEqual([
    'Empire State Building, 350 5th Avenue, New York',
    '1 Main St, Brooklyn, NY',
    'Grove St, Hudson',
  ]);
  expect(new URL(urls[0]!).searchParams.get('bbox')).toBe('-75.6,39.9,-71.7,41.7');
  expect(await suggestPlaces('x', async () => Response.json({}))).toEqual([]);
  await expect(suggestPlaces('x', async () => new Response('busy', { status: 503 }))).rejects.toThrow(/unavailable/);
});

test('the places API checks what was typed and never fails while typing', async () => {
  const ask = (body: unknown, fetcher?: typeof fetch) =>
    handleApi(
      new Request('https://app.test/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      {},
      fetcher ? { fetcher } : {},
    );
  expect((await ask({ query: 'ab' })).status).toBe(422);
  const down = await ask({ query: 'empire' }, (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch);
  expect(await down.json()).toEqual({ places: [] });
  const found = await ask({ query: 'empire' }, (async () => Response.json(photon)) as unknown as typeof fetch);
  expect(((await found.json()) as { places: unknown[] }).places).toHaveLength(3);
});
