import { expect, test } from 'bun:test';
import { buildingGrade, marketBadge, rentBenchmarks, withInsights } from '../src/insights.ts';
import { compareResults, matchListings, parseFilters } from '../src/search.ts';
import { buildingKey } from '../src/listings.ts';
import { testListing } from './fixtures/listing.ts';

const facts = (fields: Partial<Parameters<typeof buildingGrade>[0] & object> = {}) => ({
  stabilized: null,
  openViolations: null,
  complaints: null,
  bedbugs: null,
  flood: null,
  checkedAt: '2026-11-24T00:00:00Z',
  ...fields,
});

test('each rent is compared with the median of similar apartments in its neighborhood or ZIP code', () => {
  const village = [3000, 3200, 3400, 3600, 3800].map((rent, index) =>
    testListing({ id: 'v' + index, address: index + ' Bank Street', neighborhood: 'West Village', bedrooms: 1, rent }),
  );
  const cheap = testListing({ id: 'cheap', address: '9 Bank Street', neighborhood: 'west-village', bedrooms: 1, rent: 1500 });
  const lonely = testListing({ id: 'lonely', address: '1 Elm Street', zip: '10001', bedrooms: 3, rent: 9000 });
  const result = withInsights([...village, cheap, lonely]);
  expect(rentBenchmarks(village).get('n:west village|1')).toEqual({ median: 3400, count: 5 });
  expect(rentBenchmarks([testListing({ rent: 1 }), testListing({ rent: 3 }), testListing({ rent: 0 })]).get('z:07302|1')?.median).toBe(2);
  const [first] = result;
  expect(first.insights).toEqual({ marketMedian: 3300, comparedWith: 6, vsMarket: -0.09, warnings: [] });
  const flagged = result.find(({ id }) => id === 'cheap')!;
  expect(flagged.insights.vsMarket).toBe(-0.55);
  expect(flagged.insights.warnings[0]).toMatch(/55% below similar apartments/);
  expect(result.find(({ id }) => id === 'lonely')!.insights, 'too few to compare').toEqual({ warnings: [] });
  expect(marketBadge(first.insights)).toBe('9% below similar');
  expect(marketBadge({ vsMarket: 0.2, warnings: [] })).toBe('20% above similar');
  expect(marketBadge({ vsMarket: 0.02, warnings: [] })).toBeNull();
  expect(marketBadge(undefined)).toBeNull();
});

test('a missing street number and the same unit at another rent are warned about', () => {
  const [noNumber, unitA, unitB] = withInsights([
    testListing({ id: 'x', address: 'Bank Street' }),
    testListing({ id: 'a', unit: '4B', rent: 2000 }),
    testListing({ id: 'b', unit: '4-B', rent: 2300 }),
  ]);
  expect(noNumber.insights.warnings).toEqual(['No street number is given. Ask for the exact address before you tour.']);
  expect(unitA.insights.warnings).toEqual(['This unit is also listed at $2,300.']);
  expect(unitB.insights.warnings).toEqual(['This unit is also listed at $2,000.']);
});

test('buildings are graded from their records, and listings can be filtered by them', () => {
  expect(buildingGrade(undefined)).toBeNull();
  expect(buildingGrade(facts({ stabilized: true }))).toBeNull();
  expect(buildingGrade(facts({ openViolations: 0, complaints: 0 }))).toBe('A');
  expect(buildingGrade(facts({ openViolations: 3, complaints: 5 }))).toBe('B');
  expect(buildingGrade(facts({ openViolations: 10, complaints: 5, flood: true }))).toBe('C');
  expect(buildingGrade(facts({ openViolations: 30, complaints: 20, bedbugs: true }))).toBe('D');

  const stabilized = testListing({ id: 's', address: '1 Good Street' });
  const troubled = testListing({ id: 't', address: '2 Bad Street' });
  const unknown = testListing({ id: 'u', address: '3 New Street' });
  const buildings = {
    [buildingKey(stabilized)!]: facts({ stabilized: true, openViolations: 0, complaints: 0 }),
    [buildingKey(troubled)!]: facts({ stabilized: false, openViolations: 40, complaints: 30 }),
  };
  const listings = withInsights([stabilized, troubled, unknown], buildings);
  expect(listings[0].building?.stabilized).toBe(true);
  expect(listings[2].building).toBeUndefined();
  const ids = (raw: Record<string, unknown>) =>
    matchListings(listings, parseFilters({ region: 'all', bedrooms: null, maxRent: null, ...raw }), null).map(({ id }) => id);
  expect(ids({})).toEqual(['s', 't', 'u']);
  expect(ids({ stabilizedOnly: true })).toEqual(['s']);
  expect(ids({ goodBuildings: true }), 'unknown buildings stay').toEqual(['s', 'u']);
  expect(ids({ belowMarket: true })).toEqual([]);
  expect(parseFilters({ stabilizedOnly: 'yes' }).stabilizedOnly, 'not a flag').toBeUndefined();
});

test('a neighborhood filter matches its name without case or punctuation', () => {
  const listings = [
    testListing({ id: 'w', neighborhood: 'West Village' }),
    testListing({ id: 'c', neighborhood: 'Chelsea' }),
    testListing({ id: 'n' }),
  ];
  const ids = (neighborhood: string) =>
    matchListings(listings, parseFilters({ region: 'all', bedrooms: null, maxRent: null, neighborhood }), null).map(({ id }) => id);
  expect(ids('west-village')).toEqual(['w']);
  expect(ids('')).toEqual(['w', 'c', 'n']);
});

test('first seen, the last price cut, and newest and best-value sorting', async () => {
  const { freshness, listedLabel } = await import('../src/insights.ts');
  const history = (rents: number[], truncated = false) => ({
    sourceId: 's',
    firstObservedAt: '2026-11-01T00:00:00Z',
    lastObservedAt: `2026-11-0${rents.length}T00:00:00Z`,
    truncated,
    observations: rents.map((rent, index) => ({ checkedAt: `2026-11-0${index + 1}T00:00:00Z`, rent, priceIncludesFees: false })),
  });
  expect(freshness(history([3000, 2800]))).toEqual({ firstSeen: '2026-11-01T00:00:00Z', priceCut: 200 });
  expect(freshness(history([3000, 2800, 2900]))).toEqual({ firstSeen: '2026-11-01T00:00:00Z' });
  expect(freshness(history([3000, 2800, 2800]))).toMatchObject({ priceCut: 200 });
  expect(freshness(history([3000], true)), 'an older first sighting is unknown').toEqual({});
  expect(freshness(null)).toEqual({});
  const now = new Date('2026-11-24T12:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  expect([0, 1, 3, 7, 13, 21, 90].map((days) => listedLabel(ago(days), now))).toEqual([
    'New today',
    'New yesterday',
    'New 3 days ago',
    'On Walkup 1 week',
    'On Walkup 1 week',
    'On Walkup 3 weeks',
    'On Walkup 3 months',
  ]);
  expect(listedLabel(undefined, now)).toBeNull();

  const recent = testListing({ id: 'new', rent: 3000, insights: { warnings: [], firstSeen: new Date().toISOString(), vsMarket: 0.1 } });
  const old = testListing({ id: 'old', rent: 2000, insights: { warnings: [], firstSeen: '2020-01-01T00:00:00Z', vsMarket: -0.2 } });
  const unknown = testListing({ id: 'unknown', rent: 1000 });
  const ids = (raw: Record<string, unknown>, sort = 'rent') =>
    matchListings([recent, old, unknown], parseFilters({ region: 'all', bedrooms: null, maxRent: null, ...raw }), null)
      .sort((a, b) => compareResults(a, b, sort))
      .map(({ id }) => id);
  expect(ids({ newWithinDays: 3 })).toEqual(['new']);
  expect(ids({ newWithinDays: 5 }), 'only offered windows').toEqual(['unknown', 'old', 'new']);
  expect(ids({}, 'newest')).toEqual(['new', 'old', 'unknown']);
  expect(ids({}, 'value')).toEqual(['old', 'new', 'unknown']);
});
