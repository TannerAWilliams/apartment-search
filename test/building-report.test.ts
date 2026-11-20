import { test, expect } from 'bun:test';
import { buildingReport, BUILDING_SOURCES, justFixOwnershipUrl, JUSTFIX_RENT_HISTORY_URL } from '../src/building-report.ts';
test('NYC report separates unknown records from zero and complaints from violations', () => {
  const report = buildingReport({ address: '10 Example St', city: 'Brooklyn', state: 'NY', zip: '11201' });
  expect(report.nyc).toBe(true); expect(report.complaints).toBeNull(); expect(report.violations).toBeNull(); expect(report.checkedAt).toBeNull();
  expect(report.identity).toContain('Not matched'); expect(report.notice).toContain('not an issued violation');
  expect(report.notice).toContain('No official building records have been fetched');
});
test('all five boroughs supported, outside jurisdiction never inherits provider region assertion', () => {
  for (const county of ['New York', 'Kings', 'Bronx', 'Queens', 'Richmond']) expect(buildingReport({ state: 'NY', county }).nyc).toBe(true);
  for (const listing of [{ state: 'NJ', city: 'New York', region: 'nyc' }, { state: 'NY', county: 'Nassau', region: 'nyc' }, {}, null]) {
    const report = buildingReport(listing); expect(report.nyc).toBe(false); expect(report.sources).toEqual([]);
  }
});
test('official source links fixed HTTPS destinations, never listing-controlled URLs', () => {
  const report = buildingReport({ state: 'NY', zip: '11201', sources: [{ url: 'https://evil.invalid' }] });
  expect(report.sources).toEqual(BUILDING_SOURCES);
  expect(report.sources.map(source => source.name)).toContain('NYC flood maps');
  expect(report.sources.map(source => source.name)).toContain('HPD bedbug annual reporting');
  for (const source of report.sources) {
    const url = new URL(source.url); expect(url.protocol).toBe('https:'); expect(['www.nyc.gov', 'data.cityofnewyork.us', 'hcr.ny.gov', 'portal.hcr.ny.gov']).toContain(url.hostname);
  }
  expect(report.sources[3].purpose).toContain('row counts are not complaint counts');
});

test('JustFix uses the matched tax lot and falls back to building search without a valid BBL', () => {
  expect(justFixOwnershipUrl('3000120004')).toBe('https://whoownswhat.justfix.org/en/bbl/3000120004');
  for (const bbl of [undefined, null, '', '9000120004', '3000120004/other', 'https://example.com']) {
    expect(justFixOwnershipUrl(bbl)).toBe('https://whoownswhat.justfix.org/en');
  }
  expect(JUSTFIX_RENT_HISTORY_URL).toBe('https://app.justfix.org/en/rh/splash');
});
