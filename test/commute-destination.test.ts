import { test, expect } from 'bun:test';
import { parseFilters } from '../src/search.ts';
import { resolveWorkplace, routeCommutes, CommuteError } from '../server/commute.ts';

test('preset and coordinate destinations resolve without transmitting a location', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error('Unexpected external request'); };
  expect((await resolveWorkplace(parseFilters({ workplace: 'rockefeller' }), fetcher))?.label).toBeTruthy();
  expect(await resolveWorkplace(parseFilters({ workplace: 'custom', customWorkplace: '40.75, -73.98' }), fetcher)).toEqual({ label: 'Custom workplace', latitude: 40.75, longitude: -73.98 });
  expect(calls).toBe(0);
});

test('an explicitly submitted address resolves through the existing geocoder and ambiguous matches fail', async () => {
  const filters = parseFilters({ workplace: 'custom', customWorkplace: '350 Fifth Avenue, New York, NY 10118' });
  const destination = await resolveWorkplace(filters, async url => {
    expect(new URL(url).hostname).toBe('geocoding.geo.census.gov');
    expect(new URL(url).searchParams.get('address')).toBe(filters.customWorkplace);
    return Response.json({ result: { addressMatches: [{ matchedAddress: '350 Fifth Avenue', coordinates: { x: -73.9857, y: 40.7484 } }] } });
  });
  expect(destination).toEqual({ label: '350 Fifth Avenue', longitude: -73.9857, latitude: 40.7484 });
  await expect(resolveWorkplace(filters, async () => Response.json({ result: { addressMatches: [] } }))).rejects.toThrow('full street address');
});

test('disconnected or failed routing never manufactures estimates for a changed destination', async () => {
  const destination = { label: 'New destination', latitude: 40.75, longitude: -73.98 };
  const listings = [{ latitude: 40.72, longitude: -74.0, transitSeconds: 60 }];
  await expect(routeCommutes(listings, destination, null, async () => { throw new Error('No request permitted'); })).rejects.toBeInstanceOf(CommuteError);
  await expect(routeCommutes(listings, destination, { appId: 'synthetic', apiKey: 'synthetic' }, async () => Response.json({}, { status: 503 }))).rejects.toThrow('couldn’t calculate routes');
});
