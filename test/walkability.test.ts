import { expect, test } from 'bun:test';
import { walkCell, withInsights } from '../src/insights.ts';
import { openData } from '../server/open-data.ts';
import { fillWalkability, fillWalkabilityFromInventory, readWalkability, walkabilityAt } from '../server/walkability.ts';
import { testListing } from './fixtures/listing.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

/** The EPA's service, answering by the latitude asked about. */
function epa(answers: Record<string, unknown> = {}) {
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    const query = new URL(url).searchParams;
    const [longitude, latitude] = query.get('geometry')!.split(',');
    asked.push(`${latitude},${longitude}`);
    expect(new URL(url).origin + new URL(url).pathname).toBe(
      'https://geodata.epa.gov/arcgis/rest/services/OA/WalkabilityIndex/MapServer/0/query',
    );
    expect(query.get('outFields')).toBe('NatWalkInd');
    const answer = latitude! in answers ? answers[latitude!] : { features: [{ attributes: { NatWalkInd: 16.6 } }] };
    return answer instanceof Response ? answer : Response.json(answer);
  };
  return { fetcher, asked };
}
const at = (id: string, latitude: number | null, longitude: number | null = -73.95) => testListing({ id, latitude, longitude });

test('the index at a point is the EPA’s figure for its block group, or none where it has none', async () => {
  expect(await walkabilityAt(40.7823, -73.9495, epa().fetcher)).toBe(16.6);
  expect(await walkabilityAt(40.5, -73.9, epa({ '40.5': { features: [] } }).fetcher), 'water, or outside the index').toBeNull();
  expect(await walkabilityAt(40.5, -73.9, epa({ '40.5': { features: [{ attributes: { NatWalkInd: 99 } }] } }).fetcher)).toBeNull();
  await expect(walkabilityAt(40.5, -73.9, epa({ '40.5': new Response('busy', { status: 503 }) }).fetcher)).rejects.toThrow(/HTTP 503/);
  await expect(walkabilityAt(40.5, -73.9, epa({ '40.5': { error: { code: 400 } } }).fetcher)).rejects.toThrow(/not recognized/);
});

test('each night learns the places listings are in that are not known yet, once each', async () => {
  const bucket = createMemoryBucket();
  expect(await readWalkability(bucket)).toEqual({});
  const listings = [at('a', 40.7823), at('b', 40.78234), at('c', 40.7001), at('d', 40.6001), at('e', null), at('f', 40.5001)];
  const service = epa({ '40.7001': { features: [] }, '40.6001': new Response('busy', { status: 503 }) });
  // Two listings in one cell ask once; a place with no figure is remembered as none; one the service refused is not.
  expect(await fillWalkability(bucket, listings, service.fetcher, 3)).toBe(2);
  expect(service.asked).toEqual(['40.7823,-73.95', '40.7001,-73.95', '40.6001,-73.95']);
  expect(await readWalkability(bucket)).toEqual({ '40.782,-73.950': 16.6, '40.700,-73.950': 0 });
  // The next night: only what is still unknown.
  const again = epa();
  expect(await fillWalkability(bucket, listings, again.fetcher)).toBe(2);
  expect(again.asked).toEqual(['40.6001,-73.95', '40.5001,-73.95']);
  expect(await fillWalkability(bucket, listings, again.fetcher), 'all known').toBe(0);
  // A night when nothing answers keeps what was known.
  const more = [...listings, at('g', 40.4001)];
  expect(await fillWalkability(bucket, more, async () => new Response('busy', { status: 503 }))).toBe(0);
  expect(Object.keys(await readWalkability(bucket))).toHaveLength(4);
  // From the app's own inventory (here the bundled one): up to the night's limit of places.
  const fresh = createMemoryBucket();
  expect(await fillWalkabilityFromInventory({ BUCKET: fresh }, epa().fetcher)).toBe(800);
  expect(Object.keys(await readWalkability(fresh))).toHaveLength(800);
});

test('listings carry the figure for their place as a whole number, and searches read it with the other lists', async () => {
  expect(walkCell(40.78231, -73.94947)).toBe('40.782,-73.949');
  expect(walkCell(null, -73.9)).toBeNull();
  expect(walkCell(40.7, Number.NaN)).toBeNull();
  const cells = { '40.782,-73.950': 16.6, '40.700,-73.950': 0 };
  const [known, none, unknown, unplaced] = withInsights(
    [at('a', 40.7823), at('c', 40.7001), at('d', 40.6001), at('e', null)],
    {},
    { walkability: cells },
  );
  expect(known!.insights.walkability).toBe(17);
  expect(none!.insights.walkability).toBeUndefined();
  expect(unknown!.insights.walkability).toBeUndefined();
  expect(unplaced!.insights.walkability).toBeUndefined();
  const bucket = createMemoryBucket();
  await fillWalkability(bucket, [at('a', 40.7823)], epa().fetcher);
  expect((await openData(bucket, 5)).walkability).toEqual({ '40.782,-73.950': 16.6 });
});
