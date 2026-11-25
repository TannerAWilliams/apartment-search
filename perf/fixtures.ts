/**
 * A production-sized inventory for performance tests: listings shaped like the real ones (the same fields, price
 * history and source links), spread over the sources as production's are, with the subway stations, the
 * rent-stabilized registry and building facts the scoring reads. Everything comes from a seeded generator, so
 * every run measures the same data.
 */
import type { ListingData } from '../src/domain.ts';
import { buildingKey } from '../src/listings.ts';
import type { Bucket } from '../server/contracts.ts';
import { createD1Bucket } from '../server/storage/d1-bucket.ts';
import { DIRECT_RENTAL_SOURCES } from '../server/sources/direct-rentals.ts';
import { fakeD1 } from '../test/fixtures/fake-d1.ts';

/** Production held 18,370 listings when this was written; the default leaves room to grow. */
export const PRODUCTION_SIZE = 20_000;

/** A small seeded generator (mulberry32): the same numbers on every machine. */
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLACES = [
  { city: 'New York', state: 'NY', region: 'nyc', zip: 10001, latitude: 40.75, longitude: -73.99, spread: 0.06, weight: 30 },
  { city: 'Brooklyn', state: 'NY', region: 'nyc', zip: 11201, latitude: 40.67, longitude: -73.95, spread: 0.07, weight: 25 },
  { city: 'Queens', state: 'NY', region: 'nyc', zip: 11101, latitude: 40.74, longitude: -73.88, spread: 0.07, weight: 12 },
  { city: 'Bronx', state: 'NY', region: 'nyc', zip: 10451, latitude: 40.84, longitude: -73.89, spread: 0.05, weight: 6 },
  { city: 'Jersey City', state: 'NJ', region: 'nj', zip: 7302, latitude: 40.72, longitude: -74.05, spread: 0.04, weight: 12 },
  { city: 'Newark', state: 'NJ', region: 'nj', zip: 7102, latitude: 40.73, longitude: -74.18, spread: 0.05, weight: 8 },
  { city: 'Stamford', state: 'CT', region: 'ct', zip: 6901, latitude: 41.05, longitude: -73.54, spread: 0.04, weight: 4 },
  { city: 'White Plains', state: 'NY', region: 'westchester', zip: 10601, latitude: 41.03, longitude: -73.76, spread: 0.04, weight: 3 },
] as const;
const STREETS = ['Grove St', 'Henry St', 'Bedford Ave', 'W 48th St', 'Broadway', 'Atlantic Ave', 'Montgomery St', 'E 85th St', 'Court St'];
const NEIGHBORHOODS = 40;
/** How production's listings divide among sources: two large aggregators, then a long tail. */
const SOURCE_WEIGHTS = [38, 30, 9, 5, 4, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1];

const pick = <T>(random: () => number, items: readonly T[], weights?: readonly number[]): T => {
  if (!weights) return items[Math.floor(random() * items.length)]!;
  let at = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, weight] of weights.entries()) if ((at -= weight) < 0) return items[index]!;
  return items.at(-1)!;
};

/** `count` listings, with the source each belongs to. */
export function makeListings(count: number, seed = 1, now = new Date('2026-11-25T12:00:00Z')) {
  const random = seeded(seed);
  const sources = DIRECT_RENTAL_SOURCES.slice(0, SOURCE_WEIGHTS.length);
  const checkedAt = now.toISOString();
  const bySource = new Map<string, ListingData[]>(sources.map(({ id }) => [id, []]));
  for (let index = 0; index < count; index++) {
    const place = pick(
      random,
      PLACES,
      PLACES.map(({ weight }) => weight),
    );
    const source = pick(random, sources, SOURCE_WEIGHTS);
    const bedrooms = Math.floor(random() * 4);
    const rent = Math.round((1800 + bedrooms * 900 + random() * 2500) / 25) * 25;
    const listedDays = Math.floor(random() * 30);
    const address = `${1 + Math.floor(random() * 900)} ${pick(random, STREETS)}`;
    const zip = String(place.zip + Math.floor(random() * 12)).padStart(5, '0');
    const id = `${source.marketplace}:${index}`;
    const observations = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, step) => ({
      checkedAt: new Date(now.getTime() - (listedDays - step) * 86_400_000).toISOString(),
      rent: rent + (step === 0 ? 0 : -50 * step),
      priceIncludesFees: false,
    }));
    const listing = {
      id,
      address,
      unit: random() < 0.7 ? String(1 + Math.floor(random() * 40)) : '',
      city: place.city,
      state: place.state,
      zip,
      county: '',
      rent,
      bedrooms,
      latitude: place.latitude + (random() - 0.5) * place.spread,
      longitude: place.longitude + (random() - 0.5) * place.spread,
      bathrooms: random() < 0.8 ? 1 + Math.floor(random() * 2) : null,
      squareFeet: random() < 0.5 ? 400 + Math.floor(random() * 900) : null,
      petsAllowed: random() < 0.4 ? random() < 0.7 : null,
      laundry: random() < 0.3 ? 'in_building' : null,
      region: place.region,
      neighborhood: random() < 0.85 ? `${place.city} ${Math.floor(random() * NEIGHBORHOODS)}` : '',
      company: `Management ${Math.floor(random() * 300)}`,
      seenAt: checkedAt,
      listedAt: new Date(now.getTime() - listedDays * 86_400_000).toISOString(),
      sources: [
        { id: source.marketplace, name: source.name, url: `https://listings.example/${source.marketplace}/${index}`, kind: 'feed' },
      ],
      kind: 'feed',
      checkedAt,
      priceHistory: {
        identity: JSON.stringify([id, `${place.state}|${zip}|${address.toLowerCase()}`]),
        sourceId: source.id,
        firstObservedAt: observations[0]!.checkedAt,
        lastObservedAt: observations.at(-1)!.checkedAt,
        observations,
        truncated: false,
      },
    } as unknown as ListingData;
    bySource.get(source.id)!.push(listing);
  }
  return bySource;
}

/** About 500 subway stations over the city, as the MTA's list has. */
export function makeStations(seed = 2) {
  const random = seeded(seed);
  const lines = ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W'];
  return Array.from({ length: 500 }, (_, index) => ({
    name: `Station ${index}`,
    routes: [pick(random, lines), pick(random, lines)],
    latitude: 40.6 + random() * 0.28,
    longitude: -74.03 + random() * 0.2,
    ...(random() < 0.3 ? { accessible: true } : {}),
  }));
}

/**
 * A bucket on the production schema (SQLite in memory behind the D1 store) holding `count` listings, every
 * source freshly checked, with the open data and building facts a search reads.
 */
export async function seededDatabase(count = PRODUCTION_SIZE, now = new Date('2026-11-25T12:00:00Z')) {
  const { d1 } = await fakeD1();
  const bucket = createD1Bucket(d1);
  const bySource = makeListings(count, 1, now);
  const checkedAt = now.toISOString();
  for (const [id, listings] of bySource)
    await bucket.snapshots.write(id, { summary: { checkedAt, transport: 'public-site', truncated: false }, listings, history: [] });
  await bucket.put(
    'rentals/refresh.json',
    JSON.stringify({
      lastCheckedAt: checkedAt,
      sources: [...bySource.keys()].map((id) => ({ id, name: id, status: 'updated', checkedAt, updatedAt: checkedAt })),
    }),
  );
  await bucket.put('transit/stations.json', JSON.stringify({ checkedAt, stations: makeStations() }));
  // A registry the size of the state's (about 57,000 buildings), a tenth of them buildings in this inventory.
  const all = [...bySource.values()].flat();
  const random = seeded(3);
  const registry: Record<string, number> = {};
  for (let index = 0; index < 57_000; index++) registry[`NY|1${String(index).padStart(4, '0')}|${index} filler st`] = 2025;
  const facts: Record<string, unknown> = {};
  for (const listing of all) {
    const key = buildingKey(listing);
    if (!key) continue;
    if (random() < 0.1) registry[key] = 2025;
    if (random() < 0.05)
      facts[key] = { stabilized: null, openViolations: Math.floor(random() * 9), complaints: 1, bedbugs: false, flood: false, checkedAt };
  }
  await bucket.put('buildings/stabilized.json', JSON.stringify({ checkedAt, buildings: registry }));
  await bucket.put('buildings/facts.json', JSON.stringify(facts));
  return d1;
}

/** A bucket over a seeded database. A new bucket over the same database starts cold: nothing kept in memory. */
export const coldBucket = (database: Awaited<ReturnType<typeof seededDatabase>>): Bucket => createD1Bucket(database);
