import { test, expect } from 'bun:test';
import { bestFit } from '../src/best-fit.ts';
import { compareResults, matchListings, needsCommute, parseFilters } from '../src/search.ts';
import { formatSearch } from '../src/market.ts';
const workplace = { label: 'Test destination', latitude: 40.7, longitude: -74 };
const route = { provider: 'TravelTime', arrivalPeriod: 'weekday_morning', checkedAt: '2026-11-17T12:00:00Z', destination: workplace };
test('best-fit shows reproducible budget and actual matching commute components', () => {
  const fit = bestFit({ rent: 2000, transitSeconds: 1800, commuteEstimate: route }, { maxRent: 4000, maxTransitMinutes: 60 }, workplace);
  expect(fit.score).toBe(50); expect(fit.affordability).toBe(30); expect(fit.commute).toBe(20);
  expect(fit.unknowns).toEqual([]); expect(fit.checkedAt).toBe(route.checkedAt);
  expect(bestFit({ rent: 9000, transitSeconds: 9000, commuteEstimate: route }, { maxRent: 4000 }, workplace).score).toBe(0);
});
test('unknown or malformed prices/routes never earn points and distance never substitutes', () => {
  for (const rent of [undefined, null, 0, -1, NaN, Infinity, '2000']) expect(bestFit({ rent }, {}).score).toBe(0);
  for (const listing of [{ miles: 0 }, { transitSeconds: 1 }, { transitSeconds: 1, commuteEstimate: { ...route, provider: 'unknown' } }, { transitSeconds: 1, commuteEstimate: { ...route, destination: { ...workplace, longitude: 0 } } }]) {
    expect(bestFit(listing, {}, workplace).commute).toBe(0); expect(bestFit(listing, {}, workplace).minutes).toBeNull();
  }
  const fit = bestFit({}, { maxRent: null });
  expect(fit.rentLimit).toBe(5000); expect(fit.commuteLimit).toBe(60); expect(fit.unknowns).toHaveLength(2);
});
test('driving-only preference uses driving; transit remains default for both constraints', () => {
  const listing = { transitSeconds: 1800, drivingSeconds: 900, commuteEstimate: route };
  expect(bestFit(listing, { maxDrivingMinutes: 30 }, workplace).commute).toBe(20);
  expect(bestFit(listing, { maxDrivingMinutes: 30 }, workplace).mode).toBe('driving');
  expect(bestFit(listing, { maxDrivingMinutes: 30, maxTransitMinutes: 60 }, workplace).mode).toBe('transit');
  expect(bestFit(listing, {}, undefined).minutes).toBeNull();
});
test('best-fit recomputes after route enrichment, sorts before pagination, and alone requests no routes', () => {
  const filters = parseFilters({ region: 'all', bedrooms: 1, maxRent: 5000, sort: 'best' });
  expect(needsCommute(filters)).toBe(false);
  const listing = { id: 'a', state: 'NY', city: 'Brooklyn', zip: '11201', latitude: 40.7, longitude: -74, bedrooms: 1, rent: 3000, sources: [], kind: 'snapshot' };
  const matches = matchListings([listing, { ...listing, id: 'b', rent: 2000 }, { ...listing, id: 'c', rent: 6000 }], filters, workplace);
  expect(matches).toHaveLength(2);
  const enriched = matches.map(row => ({ ...row, commuteEstimate: route, transitSeconds: row.id === 'a' ? 600 : 3600 }));
  const result = formatSearch(enriched, filters, workplace, 'fixture', [], []);
  expect(result.matches.map(x => x.id)).toEqual(['a', 'b']); expect(result.matches[0].bestFit.minutes).toBe(10);
  expect(formatSearch(enriched, { ...filters, sort: 'rent' }, workplace, 'fixture', [], []).matches[0].bestFit).toBeUndefined();
});
test('equal fit scores use deterministic rent/id fallback', () => {
  expect(compareResults({ id: 'a', rent: 2000, bestFit: { score: 1 } }, { id: 'b', rent: 2000, bestFit: { score: 1 } }, 'best')).toBeLessThan(0);
});
