import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { parseDashboardCsv } from '../server/dashboard-csv.ts';
import { dashboardFile } from '../server/dashboard-snapshot.ts';
import { DASHBOARD_AREAS, DASHBOARD_CATALOG } from '../server/data/dashboard-catalog.ts';
import { ensureMarketSeries, marketMonth, marketValues, monthsBetween, seriesId, valueRows } from '../server/storage/market-history.ts';
import type { HistoryCatalog, HistoryMonth, HistoryValues } from '../src/market-history.ts';
import { handleApi } from './fixtures/api.ts';
import { fakeD1 } from './fixtures/fake-d1.ts';
import { readJson, type ErrorBody } from './fixtures/json.ts';

const ARCHIVE = new URL('../public/data/streeteasy-dashboard-2026-11-17.zip', import.meta.url);
const archive = () => Bun.file(ARCHIVE).bytes();
const NAMES = DASHBOARD_CATALOG.map(({ name }) => name);
const RENT = 'medianAskingRent_All.csv';
const area = (name: string) => DASHBOARD_AREAS.findIndex((item) => item.name === name) + 1;

test('every reported value in the archive is loaded into the market history tables, and blanks stay blank', async () => {
  const { d1 } = await fakeD1();
  expect(await ensureMarketSeries(d1, NAMES, archive)).toBe(45);
  const count = async (table: string) => (await d1.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;
  // 1,582,852 cells in the 45 files, of which 337,240 are blank.
  expect(await count('market_values')).toBe(1_245_612);
  expect([await count('market_areas'), await count('market_series'), await count('market_imports')]).toEqual([182, 45, 45]);
  // Days on market has 15 negative values in the source; they are kept as reported, and the page leaves them out.
  const negative = await d1.prepare('SELECT count(*) AS n FROM market_values WHERE value < 0').first<{ n: number }>();
  expect(negative?.n).toBe(15);

  // Each file, read straight from the archive, matches what the tables hold.
  const files = unzipSync(await archive());
  for (const name of ['medianAskingRent_All.csv', 'rentalIndex_All.csv', 'daysOnMarket_Sfr.csv']) {
    const file = parseDashboardCsv(name, strFromU8(unzipSync(files[name.replace('.csv', '.zip')]!)[name]!));
    const first = file.areas.find((row) => row.values.some((value) => value !== null))!;
    const ids = [area(first.name)];
    const { months, values } = await marketValues(d1, [name], ids, file.months[0]!, file.months.at(-1)!);
    expect(months).toEqual(monthsBetween(file.months[0]!, file.months.at(-1)!));
    expect(months.map((month) => values[name]![ids[0]!]![months.indexOf(month)])).toEqual(
      months.map((month) => (file.months.includes(month) ? (first.values[file.months.indexOf(month)] ?? null) : null)),
    );
  }
  // Loading again does nothing.
  expect(await ensureMarketSeries(d1, NAMES, archive)).toBe(0);
}, 60_000);

test('a series loaded from an older archive is replaced the next time it is read', async () => {
  const { d1 } = await fakeD1();
  await ensureMarketSeries(d1, [RENT], archive);
  await d1.prepare("UPDATE market_values SET value = 1 WHERE series_id = ?1 AND month = '2026-10'").bind(seriesId(RENT)).all();
  await d1.prepare("UPDATE market_imports SET archive_sha256 = 'older' WHERE series_id = ?1").bind(seriesId(RENT)).all();
  expect(await ensureMarketSeries(d1, [RENT], archive)).toBe(1);
  const [nyc] = await marketMonth(d1, RENT, '2026-10', '2025-10');
  expect(nyc).toEqual({ area: 1, value: 4100, yearAgo: 3950 });
});

test('valueRows refuses areas the catalog does not list', () => {
  const file = { name: RENT, metric: 'medianAskingRent' as const, segment: 'All', months: ['2026-10'] };
  expect(() => valueRows({ ...file, areas: [{ name: 'Nowhere', borough: 'Queens', type: 'neighborhood', values: [1] }] })).toThrow(
    'rebuild it with scripts/dashboard-catalog.ts',
  );
  expect(valueRows({ ...file, areas: [{ name: 'NYC', borough: '', type: 'city', values: [null] }] })).toEqual([]);
});

test('an unknown series name is refused before anything is written', async () => {
  const { d1 } = await fakeD1();
  await expect(ensureMarketSeries(d1, ['missing.csv'], archive)).rejects.toThrow('Unknown dashboard series');
  expect(await dashboardFile('missing.csv', archive)).toBeNull();
});

test('a damaged archive is refused, and a later read can still succeed', async () => {
  let attempt = 0;
  const flaky = async () => (++attempt === 1 ? new Uint8Array([1, 2, 3]) : archive());
  await expect(dashboardFile('rentalIndex_All.csv', flaky)).rejects.toThrow(/does not match the original download/);
  expect((await dashboardFile('rentalIndex_All.csv', flaky))?.months[0]).toBe('2007-01');
  expect(attempt).toBe(2);
});

test('the market history API: catalog, values and one month across every area', async () => {
  const { d1 } = await fakeD1();
  const services = { privateAuthenticated: true, dashboardArchive: archive, database: d1 };
  const get = (path: string, env = {}, given: object = services) =>
    handleApi(new Request('https://app.test/api/history' + path), env, given);

  const catalog = await readJson<HistoryCatalog>(get(''));
  expect(catalog.series).toHaveLength(45);
  expect(catalog.areas).toHaveLength(182);
  expect(catalog.areas[0]).toEqual({ id: 1, name: 'NYC', borough: '', type: 'city' });
  expect(catalog.latestMonth).toBe('2026-10');
  expect(catalog.series.find(({ name }) => name === RENT)).toMatchObject({ label: 'Median asking rent', unit: 'USD', market: 'Rentals' });

  const brooklyn = area('Brooklyn');
  const values = await readJson<HistoryValues>(
    get(`/values?series=${RENT},discountShare_All.csv&areas=1,${brooklyn}&from=2025-10&to=2026-10`),
  );
  expect(values.months).toHaveLength(13);
  expect(values.values[RENT]!['1']!.at(-1)).toBe(4100);
  expect(values.values['discountShare_All.csv']![String(brooklyn)]).toHaveLength(13);

  const month = await readJson<HistoryMonth>(get(`/month?series=${RENT}&month=2026-10`));
  expect(month.yearAgo).toBe('2025-10');
  expect(month.rows.length).toBeGreaterThan(100);
  expect(month.rows[0]).toEqual({ area: 1, value: 4100, yearAgo: 3950 });
});

test('the market history API refuses bad requests and reports what it cannot read', async () => {
  const { d1 } = await fakeD1();
  const services = { privateAuthenticated: true, dashboardArchive: archive, database: d1 };
  const get = (path: string, env = {}, given: object = services) =>
    handleApi(new Request('https://app.test/api/history' + path), env, given);
  // A private server shares the figures only with someone signed in; a public one with anyone.
  expect((await get('', {}, {})).status).toBe(403);
  expect((await get('/values?series=x', {}, {})).status).toBe(403);
  expect((await get('', { PUBLIC_APP: 'true' }, {})).status).toBe(200);

  for (const query of [
    `/values?series=missing.csv&areas=1&from=2026-01&to=2026-10`,
    `/values?series=${RENT}&areas=0&from=2026-01&to=2026-10`,
    `/values?series=${RENT}&areas=1,1&from=2026-01&to=2026-10`,
    `/values?series=${RENT}&areas=1,2,3,4,5,6,7,8,9&from=2026-01&to=2026-10`,
    `/values?series=${RENT}&areas=1&from=2026-10&to=2026-01`,
    `/values?series=${RENT}&areas=1&from=2026-13&to=2026-10`,
    `/month?series=${RENT}&month=Oct`,
  ])
    expect((await get(query)).status, query).toBe(422);

  const noDatabase = { ...services, database: undefined };
  expect((await get(`/values?series=${RENT}&areas=1&from=2026-01&to=2026-10`, {}, noDatabase)).status).toBe(503);
  expect((await get(`/month?series=${RENT}&month=2026-10`, {}, noDatabase)).status).toBe(503);

  const broken = {
    ...services,
    database: {
      ...d1,
      prepare: () => {
        throw new Error('D1 down');
      },
    },
  };
  for (const path of [`/values?series=${RENT}&areas=1&from=2026-01&to=2026-10`, `/month?series=${RENT}&month=2026-10`]) {
    const response = await get(path, {}, broken);
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error).toBe('The market history could not be read.');
  }
});

test('the app offers market history wherever someone can sign in, or the app is public', async () => {
  const { appConfig } = await import('../server/app-config.ts');
  expect([
    appConfig({}).dashboardAvailable,
    appConfig({ APP_ACCESS_TOKEN: '' }).dashboardAvailable,
    appConfig({ PUBLIC_APP: 'true' }).dashboardAvailable,
    appConfig({ APP_ACCESS_TOKEN: 'synthetic-test-only' }).dashboardAvailable,
    appConfig({ BETTER_AUTH_SECRET: 'synthetic-test-only' }).dashboardAvailable,
  ]).toEqual([false, false, true, true, true]);
});
