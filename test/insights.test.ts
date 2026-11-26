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
  // How far below is shown by the badge, not repeated as a warning.
  expect(flagged.insights.warnings).toEqual([]);
  expect(marketBadge(flagged.insights)).toBe('55% below similar');
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
    'Listed today',
    'Listed yesterday',
    'Listed 3 days ago',
    'Listed 1 week ago',
    'Listed 1 week ago',
    'Listed 3 weeks ago',
    'Listed 3 months ago',
  ]);
  expect(listedLabel(undefined, now)).toBeNull();

  // New and newest go by the listing site's own posting date; Walkup's first sighting does not count.
  const recent = testListing({ id: 'new', rent: 3000, listedAt: new Date().toISOString(), insights: { warnings: [], vsMarket: 0.1 } });
  const old = testListing({
    id: 'old',
    rent: 2000,
    listedAt: '2020-01-01T00:00:00Z',
    insights: { warnings: [], firstSeen: new Date().toISOString(), vsMarket: -0.2 },
  });
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

test('every listing 5% or more below similar ones is a deal, however far below; a rent under $500 comes last', () => {
  const room = testListing({ id: 'room', rent: 300, address: '99 Columbia Ave' });
  const scam = { ...testListing({ id: 'scam', rent: 800 }), insights: { warnings: [], vsMarket: -0.64 } };
  const deal = { ...testListing({ id: 'deal', rent: 3000 }), insights: { warnings: [], vsMarket: -0.2 } };
  const plain = testListing({ id: 'plain', rent: 3500 });
  for (const sort of ['rent', 'value', 'newest'])
    expect([room, scam, plain, deal].sort((a, b) => compareResults(a, b, sort)).at(-1)?.id).toBe('room');
  // Far below similar ones is not judged: it sorts like any other listing.
  expect([plain, deal, scam].sort((a, b) => compareResults(a, b, 'rent')).map(({ id }) => id)).toEqual(['scam', 'deal', 'plain']);
  const deals = matchListings([scam, deal, plain] as never, parseFilters({ region: 'all', belowMarket: true }), null);
  expect(deals.map(({ id }) => id).sort()).toEqual(['deal', 'scam']);
  // 20% below is the line: 19% below is not a deal.
  const close = { ...testListing({ id: 'close', rent: 3100 }), insights: { warnings: [], vsMarket: -0.19 } };
  expect(matchListings([close, deal] as never, parseFilters({ region: 'all', belowMarket: true }), null).map(({ id }) => id)).toEqual([
    'deal',
  ]);
});

test('room to negotiate: a listing long on the market or cut more than once says so', async () => {
  const { freshness, leverage } = await import('../src/insights.ts');
  const observed = (rents: number[]) => ({
    sourceId: 's',
    firstObservedAt: '2026-11-01T00:00:00Z',
    lastObservedAt: `2026-11-0${rents.length}T00:00:00Z`,
    truncated: false,
    observations: rents.map((rent, index) => ({
      checkedAt: `2026-11-0${index + 1}T00:00:00Z`,
      rent,
      priceIncludesFees: false,
    })),
  });
  // Every drop is counted, a rise between them or not; one drop alone is the last cut, as before.
  expect(freshness(observed([3200, 3100, 3150, 2950]))).toMatchObject({ priceCut: 200, priceCuts: 2, priceCutTotal: 300 });
  expect(freshness(observed([3200, 3100]))).toEqual({ firstSeen: '2026-11-01T00:00:00Z', priceCut: 100 });
  const now = Date.parse('2026-11-25T12:00:00Z');
  const listing = (listedAt: string | undefined, insights: object = {}) => ({ listedAt, insights: { warnings: [], ...insights } });
  expect(leverage(listing('2026-10-22T12:00:00Z', { priceCuts: 2, priceCutTotal: 300 }), now)).toBe(
    'Room to negotiate: on the market 34 days; rent cut twice, $300 in all.',
  );
  expect(leverage(listing('2026-11-20T12:00:00Z', { priceCuts: 3, priceCutTotal: 450 }), now)).toBe(
    'Room to negotiate: rent cut 3 times, $450 in all.',
  );
  expect(leverage(listing(undefined, { priceCut: 150 }), now)).toBe('Room to negotiate: rent cut $150.');
  expect(leverage(listing('2026-10-22T12:00:00Z'), now)).toBe('Room to negotiate: on the market 34 days.');
  // New and never cut, or with no date from the site: nothing to say.
  expect(leverage(listing('2026-11-20T12:00:00Z'), now)).toBeNull();
  expect(leverage({ listedAt: 'soon' })).toBeNull();
});
