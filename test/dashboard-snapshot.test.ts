import { required } from './test-values.ts';
import { test, expect } from 'bun:test';
import { dashboardSnapshot } from '../server/dashboard-snapshot.ts';
import { handleApi } from '../server/api.ts';
import { formatDashboardValue } from '../src/dashboard-data.ts';
import { readJson, type ErrorBody } from './fixtures/json.ts';

/** The dashboard catalog and one dashboard file, as the API returns them. */
type DashboardCatalog = { files: unknown[] };
type DashboardDownload = { file: { months: string[] }; provenance: { source: string } };

const archive = () => Bun.file(new URL('../public/data/streeteasy-dashboard-2026-11-17.zip', import.meta.url)).bytes();
test('official frozen master includes45files and every historic cell; anomalies explicitly retained', async () => {
  const result = await dashboardSnapshot(undefined, archive);
  expect(required(result).files).toHaveLength(45);
  let cells = 0, blank = 0, negative = 0;
  for (const item of required(required(result).files)) {
    const file = required(required(await dashboardSnapshot(item.name, archive)).file);
    expect(item.firstMonth).toBe(file.months[0]); expect(item.lastMonth).toBe(required(file.months.at(-1))); expect(item.areaCount).toBe(file.areas.length);
    cells += file.months.length * file.areas.length;
    for (const area of file.areas) for (const value of area.values) {
      if (value === null) blank++;
      if (value !== null && value < 0) { negative++; expect(file.metric).toBe('daysOnMarket'); expect(formatDashboardValue(value,file.metric)).toContain('source anomaly'); }
    }
  }
  expect(cells).toBe(1582852); expect(blank).toBe(337240); expect(negative).toBe(15);
  expect(await dashboardSnapshot('missing.csv', archive)).toBeNull();
});
test('the dashboard is served only to a signed-in request in private mode', async () => {
  const request = (suffix = '', init: RequestInit = {}) => new Request('https://app.test/api/dashboard' + suffix, init);
  const env = { APP_ACCESS_TOKEN: 'secret' };
  const signedIn = { privateAuthenticated: true, dashboardArchive: archive };
  expect((await handleApi(request(), {})).status).toBe(403);
  expect((await handleApi(request(), env)).status).toBe(403);
  // The Worker entry checks the token in constant time and reports the result; a header alone is not trusted here.
  expect((await handleApi(request('', { headers: { Authorization: 'Bearer secret' } }), env)).status).toBe(403);
  const res = await handleApi(request(), env, signedIn);
  expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store'); expect((await readJson<DashboardCatalog>(res)).files).toHaveLength(45);
  expect((await handleApi(request(), { PUBLIC_APP: 'true' })).status).toBe(200);
  expect((await handleApi(request('?file=missing.csv'), env, signedIn)).status).toBe(404);
  expect((await handleApi(request('', { method: 'POST' }), env, signedIn)).status).toBe(405);
  const file = await handleApi(request('?file=rentalIndex_All.csv'), env, signedIn);
  expect((await readJson<DashboardDownload>(file)).file.months[0]).toBe('2007-01');
});

test('a missing or altered archive is reported, and a later read can still succeed', async () => {
  let attempt = 0;
  const flaky = async () => ++attempt === 1 ? new Uint8Array([1, 2, 3]) : archive();
  await expect(dashboardSnapshot('rentalIndex_All.csv', flaky)).rejects.toThrow(/does not match the original download/);
  expect(required(required(await dashboardSnapshot('rentalIndex_All.csv', flaky)).file).months[0]).toBe('2007-01');
  expect(attempt).toBe(2);
  const unconfigured = await handleApi(new Request('https://app.test/api/dashboard?file=rentalIndex_All.csv'), { PUBLIC_APP: 'true' });
  expect(unconfigured.status).toBe(503);
  expect((await readJson<ErrorBody>(unconfigured)).error).toMatch(/could not be read/);
});
