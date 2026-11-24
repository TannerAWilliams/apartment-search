import { expect, test } from 'bun:test';
import { buildingGrade, marketBadge, rentBenchmarks, withInsights } from '../src/insights.ts';
import { matchListings, parseFilters } from '../src/search.ts';
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
