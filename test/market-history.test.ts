import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseDashboardCsv } from '../server/dashboard-csv.ts';
import { archivedSeriesZip, dashboardFileUrl, parseSeriesZip } from '../server/dashboard-snapshot.ts';
import { DASHBOARD_AREAS, DASHBOARD_CATALOG } from '../server/data/dashboard-catalog.ts';
import { createD1Bucket } from '../server/storage/d1-bucket.ts';
import {
  ensureMarketSeries,
  marketHistoryState,
  marketMonth,
  marketValues,
  monthsBetween,
  refreshMarketHistory,
  seriesId,
  valueRows,
} from '../server/storage/market-history.ts';
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

/** StreetEasy's download links, answered from the bundled archive (the same files), with changes a test makes. */
async function streetEasy(change: (name: string, zip: Uint8Array) => Response | Uint8Array = (_, zip) => zip) {
  const files = unzipSync(await archive());
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    const name = url.split('/').at(-1)!.replace('.zip', '.csv');
    const result = change(name, files[name.replace('.csv', '.zip')]!);
    return result instanceof Response ? result : new Response(new Uint8Array(result));
  };
  return { fetcher, requested };
}
/** A series' zip with one month added (NYC's value set, every other area blank), as a new release would be. */
function newerRelease(name: string, zip: Uint8Array) {
  const csv = strFromU8(unzipSync(zip)[name]!).trimEnd();
  const [header, ...rows] = csv.split('\n');
  const added = [header + ',2026-11', ...rows.map((row) => row + (row.startsWith('NYC,') ? ',4200.0' : ','))].join('\n') + '\n';
  return zipSync({ [name]: strToU8(added) });
}

test('a resync downloads each series from StreetEasy and replaces only the files that changed', async () => {
  const { d1 } = await fakeD1();
  await ensureMarketSeries(d1, [RENT], archive);
  // Unchanged files are skipped: the archive holds exactly what StreetEasy publishes.
  const same = await streetEasy();
  expect(await refreshMarketHistory(d1, same.fetcher)).toMatchObject({ changed: 44, files: 45 });
  expect(same.requested).toContain('https://cdn-charts.streeteasy.com/rentals/All/medianAskingRent_All.zip');
  expect(same.requested).toContain('https://cdn-charts.streeteasy.com/sales/Condo/medianSalesPrice_Condo.zip');
  expect(await refreshMarketHistory(d1, (await streetEasy()).fetcher)).toMatchObject({ changed: 0 });

  // A new month: only that file is replaced, and the catalog moves on to it.
  const release = await streetEasy((name, zip) => (name === RENT ? newerRelease(name, zip) : zip));
  expect(await refreshMarketHistory(d1, release.fetcher, new Date('2026-12-08T12:00:00Z'))).toMatchObject({ changed: 1 });
  expect((await marketMonth(d1, RENT, '2026-11', '2025-11'))[0]).toEqual({ area: 1, value: 4200, yearAgo: 3850 });
  const state = await marketHistoryState(d1);
  expect(state.imports.get(seriesId(RENT))).toMatchObject({
    source: 'cdn',
    last_month: '2026-11',
    imported_at: '2026-12-08T12:00:00.000Z',
  });
}, 60_000);

test("a new area in StreetEasy's files gets its own number, and the earlier areas keep theirs", async () => {
  const { d1 } = await fakeD1();
  const release = await streetEasy((name, zip) => {
    if (name !== RENT) return zip;
    const csv = strFromU8(unzipSync(zip)[name]!);
    const months = csv.split('\n')[0]!.split(',').length - 3;
    return zipSync({ [name]: strToU8(csv + 'Hudson Yards North,Manhattan,neighborhood' + ',1000.0'.repeat(months) + '\n') });
  });
  await refreshMarketHistory(d1, release.fetcher);
  const { areas } = await marketHistoryState(d1);
  expect(areas).toHaveLength(183);
  expect(areas[0]).toEqual({ id: 1, name: 'NYC', borough: '', type: 'city' });
  expect(areas.at(-1)).toEqual({ id: 183, name: 'Hudson Yards North', borough: 'Manhattan', type: 'neighborhood' });
  expect((await marketValues(d1, [RENT], [183], '2026-10', '2026-10')).values[RENT]!['183']).toEqual([1000]);
}, 60_000);

test('a download that drops once is retried, so one network hiccup does not fail the dashboard', async () => {
  const { d1 } = await fakeD1();
  let dropped = false;
  const flaky = await streetEasy((name, zip) => {
    if (name === RENT && !dropped) {
      dropped = true;
      throw new TypeError('Network connection lost.');
    }
    return zip;
  });
  expect(await refreshMarketHistory(d1, flaky.fetcher)).toMatchObject({ changed: 45, files: 45 });
  expect(flaky.requested.filter((url) => url.endsWith('/medianAskingRent_All.zip'))).toHaveLength(2);
}, 60_000);

test('files StreetEasy cannot serve are reported, and the saved figures are kept', async () => {
  const { d1 } = await fakeD1();
  await ensureMarketSeries(d1, [RENT], archive);
  const broken = await streetEasy((name, zip) =>
    name === RENT
      ? new Response('missing', { status: 404 })
      : name === 'rentalIndex_All.csv'
        ? new Uint8Array([1, 2, 3])
        : name === 'priceIndex_All.csv'
          ? zipSync({ 'other.csv': strToU8('x') })
          : name === 'daysOnMarket_All.csv'
            ? new Uint8Array(9 * 1024 * 1024)
            : zip,
  );
  await expect(refreshMarketHistory(d1, broken.fetcher)).rejects.toThrow(
    /4 of 45 files could not be read \(.*\); the saved figures were kept/,
  );
  expect((await marketMonth(d1, RENT, '2026-10', '2025-10'))[0]?.value).toBe(4100);
  await expect(refreshMarketHistory(d1, async () => Promise.reject('offline'))).rejects.toThrow('45 of 45 files');
  await expect(refreshMarketHistory(d1, async () => new Response('x', { status: 500 }))).rejects.toThrow('45 of 45 files');
}, 60_000);

test('a resync of every source includes the dashboard, and reports what it did', async () => {
  const { refreshSources } = await import('../server/refresh.ts');
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const { d1 } = await fakeD1();
  const { fetcher } = await streetEasy();
  const onDemand = { onDemand: true, sourceId: 'streeteasy-dashboard', fetcher };
  const result = await refreshSources({ BUCKET: createD1Bucket(d1) }, onDemand);
  expect(result.sources.find(({ id }) => id === 'streeteasy-dashboard')).toMatchObject({ status: 'updated', listingCount: 45, total: 45 });
  const again = await refreshSources({ BUCKET: createD1Bucket(d1) }, { ...onDemand, now: new Date(Date.now() + 60_000) });
  expect(again.sources.find(({ id }) => id === 'streeteasy-dashboard')).toMatchObject({ status: 'current', listingCount: 0 });
  // A store without the database (the in-memory one tests use elsewhere) says what is missing.
  const memory = await refreshSources({ BUCKET: createMemoryBucket() }, onDemand);
  expect(memory.sources.find(({ id }) => id === 'streeteasy-dashboard')).toMatchObject({
    status: 'failed',
    error: 'StreetEasy Data Dashboard: market history needs the D1 database.',
  });
  // A failure without a message of its own reads generically, and the earlier total stays.
  const failing = await refreshSources(
    { BUCKET: createD1Bucket(d1) },
    { ...onDemand, now: new Date(Date.now() + 120_000), fetcher: () => Promise.reject(new TypeError('network down')) },
  );
  expect(failing.sources.find(({ id }) => id === 'streeteasy-dashboard')).toMatchObject({ status: 'failed', total: 45 });
  // A database failure is reported in general terms, not as the database's own message.
  const down = {
    ...d1,
    prepare: () => {
      throw new Error('D1 internal detail');
    },
  };
  const broken = await refreshSources({ BUCKET: { ...createMemoryBucket(), database: down } }, onDemand);
  expect(broken.sources.find(({ id }) => id === 'streeteasy-dashboard')?.error).toBe(
    'The StreetEasy Data Dashboard files could not be downloaded.',
  );
}, 60_000);

test('StreetEasy publishes each series at a predictable address', () => {
  expect(dashboardFileUrl('rentalIndex_All.csv')).toBe('https://cdn-charts.streeteasy.com/rentals/All/rentalIndex_All.zip');
  expect(dashboardFileUrl('daysOnMarket_Sfr.csv')).toBe('https://cdn-charts.streeteasy.com/sales/Sfr/daysOnMarket_Sfr.zip');
});

test('valueRows refuses areas of a kind the tables do not know', () => {
  const file = { name: RENT, metric: 'medianAskingRent' as const, segment: 'All', months: ['2026-10'] };
  expect(() => valueRows({ ...file, areas: [{ name: 'Nowhere', borough: 'Queens', type: 'county', values: [1] }] })).toThrow(
    'an area of an unknown kind: county',
  );
  expect(valueRows({ ...file, areas: [{ name: 'NYC', borough: '', type: 'city', values: [null] }] })).toEqual([]);
});

test('an unknown series name is refused before anything is written', async () => {
  const { d1 } = await fakeD1();
  await expect(ensureMarketSeries(d1, ['missing.csv'], archive)).rejects.toThrow('Unknown dashboard series');
  expect(await archivedSeriesZip('missing.csv', archive)).toBeNull();
});

test('a damaged archive is refused, and a later read can still succeed', async () => {
  let attempt = 0;
  const flaky = async () => (++attempt === 1 ? new Uint8Array([1, 2, 3]) : archive());
  await expect(archivedSeriesZip('rentalIndex_All.csv', flaky)).rejects.toThrow(/does not match the original download/);
  expect(parseSeriesZip('rentalIndex_All.csv', (await archivedSeriesZip('rentalIndex_All.csv', flaky))!).months[0]).toBe('2007-01');
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
  expect(catalog.refreshedAt).toBeNull();
  // Without a database the catalog comes from the archive's own list.
  const bare = await readJson<HistoryCatalog>(get('', {}, { ...services, database: undefined }));
  expect([bare.series.length, bare.areas.length, bare.refreshedAt]).toEqual([45, 182, null]);
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
  // StreetEasy's published figures are open to visitors, with the source named on the page.
  expect((await get('', {}, { privateAuthenticated: false })).status).toBe(200);

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
  for (const path of ['', `/values?series=${RENT}&areas=1&from=2026-01&to=2026-10`, `/month?series=${RENT}&month=2026-10`]) {
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
