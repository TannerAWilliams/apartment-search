/**
 * StreetEasy's monthly market data in D1 (deploy/cloudflare/migrations/0002 and 0003). A series is written in
 * one transaction, so a reader sees all of it or none of it. It comes from the archive bundled with the app the
 * first time it is asked for, and from StreetEasy's own download links (refreshMarketHistory) when you resync,
 * which replaces only the series whose file changed.
 */
import { DASHBOARD_FILES, type DashboardFile } from '../../src/dashboard-data.ts';
import type { SourceFetch } from '../contracts.ts';
import { archivedSeriesZip, type ArchiveLoader, dashboardFileUrl, parseSeriesZip, sha256Hex } from '../dashboard-snapshot.ts';
import { DASHBOARD_AREAS, DASHBOARD_CATALOG } from '../data/dashboard-catalog.ts';
import { mapLimit } from '../concurrency.ts';
import { log } from '../log.ts';

/** Series downloaded, parsed and written at once: each file is a few megabytes, so only a few. */
const SERIES_AT_ONCE = 3;
import { chunks, type D1Database } from './d1-bucket.ts';

/** A series' number in the tables: its position in DASHBOARD_FILES, plus one. */
export const seriesId = (name: string) => DASHBOARD_FILES.indexOf(name) + 1;

// The areas the bundled archive lists keep the numbers the catalog gives them; areas StreetEasy adds later get
// the next free number when their first series is loaded.
const AREAS_JSON = JSON.stringify(DASHBOARD_AREAS.map(({ name, borough, type }, index) => [index + 1, name, borough, type]));
const SEED_AREAS = `INSERT OR IGNORE INTO market_areas (id, name, borough, area_type)
  SELECT row.value ->> '$[0]', row.value ->> '$[1]', row.value ->> '$[2]', row.value ->> '$[3]' FROM json_each(?1) AS row`;
const ADD_AREAS = `INSERT OR IGNORE INTO market_areas (name, borough, area_type)
  SELECT row.value ->> '$[0]', row.value ->> '$[1]', row.value ->> '$[2]' FROM json_each(?1) AS row`;
const WRITE_SERIES = 'INSERT OR IGNORE INTO market_series (id, metric, segment) VALUES (?1, ?2, ?3)';
const CLEAR_VALUES = 'DELETE FROM market_values WHERE series_id = ?1';
const WRITE_VALUES = `INSERT OR REPLACE INTO market_values (series_id, area_id, month, value)
  SELECT ?1, area.id, row.value ->> '$[3]', row.value ->> '$[4]' FROM json_each(?2) AS row
  JOIN market_areas AS area
    ON area.name = row.value ->> '$[0]' AND area.borough = row.value ->> '$[1]' AND area.area_type = row.value ->> '$[2]'`;
const WRITE_IMPORT = `INSERT OR REPLACE INTO market_imports (series_id, archive_sha256, imported_at, value_count, source, last_month)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;
const AREA_TYPES = new Set(['city', 'borough', 'neighborhood']);

/** The reported values of a parsed file as [name, borough, type, month, value] rows; blank months have none. */
export function valueRows(file: DashboardFile) {
  const rows: string[] = [];
  for (const area of file.areas) {
    if (!AREA_TYPES.has(area.type)) throw new Error(`StreetEasy listed an area of an unknown kind: ${area.type}.`);
    area.values.forEach((value, index) => {
      if (value !== null) rows.push(JSON.stringify([area.name, area.borough, area.type, file.months[index], value]));
    });
  }
  return rows;
}

/** Writes one series in a single transaction, replacing what the tables held for it. */
async function writeSeries(database: D1Database, file: DashboardFile, sha256: string, source: 'archive' | 'cdn', now: Date) {
  const id = seriesId(file.name);
  const rows = valueRows(file);
  const areas = JSON.stringify(file.areas.map(({ name, borough, type }) => [name, borough, type]));
  await database.batch([
    database.prepare(SEED_AREAS).bind(AREAS_JSON),
    database.prepare(ADD_AREAS).bind(areas),
    database.prepare(WRITE_SERIES).bind(id, file.metric, file.segment),
    database.prepare(CLEAR_VALUES).bind(id),
    ...chunks(rows).map(({ json }) => database.prepare(WRITE_VALUES).bind(id, json)),
    database.prepare(WRITE_IMPORT).bind(id, sha256, now.toISOString(), rows.length, source, file.months.at(-1) ?? null),
  ]);
  log.info('market_series_loaded', { series: file.name, values: rows.length, source });
  return rows.length;
}

type ImportRow = { series_id: number; archive_sha256: string; imported_at: string; source: string; last_month: string | null };
async function imports(database: D1Database) {
  const { results } = await database
    .prepare('SELECT series_id, archive_sha256, imported_at, source, last_month FROM market_imports')
    .all<ImportRow>();
  return new Map(results.map((row) => [row.series_id, row]));
}

/**
 * What this server instance has already confirmed in the tables: series once loaded stay loaded and the areas once
 * seeded stay seeded, so later requests skip asking the database again.
 */
const confirmed = new WeakMap<D1Database, Set<string>>();
const seeded = new WeakSet<D1Database>();

/** Loads, from the bundled archive, the named series the tables do not have yet. Returns how many it loaded. */
export async function ensureMarketSeries(database: D1Database, names: readonly string[], loadArchive: ArchiveLoader, now = new Date()) {
  const known = confirmed.get(database) ?? new Set<string>();
  confirmed.set(database, known);
  const unconfirmed = names.filter((name) => !known.has(name));
  if (!unconfirmed.length) return 0;
  const loaded = await imports(database);
  const missing = unconfirmed.filter((name) => !loaded.has(seriesId(name)));
  // A few series at once: each is read from the archive, parsed and written in its own batch.
  await mapLimit(missing, SERIES_AT_ONCE, async (name) => {
    const zip = await archivedSeriesZip(name, loadArchive);
    if (!zip) throw new Error('Unknown dashboard series.');
    await writeSeries(database, parseSeriesZip(name, zip), await sha256Hex(zip), 'archive', now);
  });
  for (const name of unconfirmed) known.add(name);
  return missing.length;
}

/**
 * Downloads every series from StreetEasy and replaces those whose file changed. A file that cannot be read is
 * reported and its saved series kept; the others are still checked.
 */
export async function refreshMarketHistory(database: D1Database, fetcher: SourceFetch, now = new Date()) {
  const loaded = await imports(database);
  let changed = 0;
  let values = 0;
  const failed: string[] = [];
  // One retry per file: a single dropped download should not mark the whole dashboard as failed.
  const download = async (name: string, attempt = 1): Promise<Uint8Array<ArrayBuffer>> => {
    try {
      const response = await fetcher(dashboardFileUrl(name), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (!response.ok)
        throw Object.assign(new Error(`StreetEasy returned HTTP ${response.status} for ${name}.`), { httpStatus: response.status });
      return new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      if (attempt > 1) throw cause;
      log.warn('market_series_download_retry', { series: name, error: cause instanceof Error ? cause.message : String(cause) });
      return download(name, attempt + 1);
    }
  };
  // A few files at once; each failure is noted and the others still checked.
  await mapLimit(DASHBOARD_CATALOG, SERIES_AT_ONCE, async ({ name }) => {
    try {
      const zip = await download(name);
      if (zip.byteLength > 8 * 1024 * 1024) throw new Error(`StreetEasy's ${name} download is larger than expected.`);
      const sha256 = await sha256Hex(zip);
      if (loaded.get(seriesId(name))?.archive_sha256 === sha256) return;
      values += await writeSeries(database, parseSeriesZip(name, zip), sha256, 'cdn', now);
      changed++;
    } catch (cause) {
      log.warn('market_series_refresh_failed', { series: name, error: cause instanceof Error ? cause.message : String(cause) });
      failed.push(name);
    }
  });
  if (failed.length)
    throw new Error(
      `StreetEasy Data Dashboard: ${failed.length} of ${DASHBOARD_CATALOG.length} files could not be read (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}); the saved figures were kept.`,
    );
  return { changed, values, files: DASHBOARD_CATALOG.length };
}

/** What the catalog needs from the tables: each series' last month and source, and every area. */
export async function marketHistoryState(database: D1Database) {
  if (!seeded.has(database)) {
    await database.prepare(SEED_AREAS).bind(AREAS_JSON).all();
    seeded.add(database);
  }
  const [loaded, { results: areas }] = await Promise.all([
    imports(database),
    database
      .prepare('SELECT id, name, borough, area_type FROM market_areas ORDER BY id')
      .all<{ id: number; name: string; borough: string; area_type: 'city' | 'borough' | 'neighborhood' }>(),
  ]);
  return {
    imports: loaded,
    areas: areas.map(({ id, name, borough, area_type }) => ({ id, name, borough, type: area_type })),
  };
}

type ValueRow = { series_id: number; area_id: number; month: string; value: number };

/** Months from `from` through `to`, inclusive. */
export function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let [year, month] = from.split('-').map(Number) as [number, number]; ; month++) {
    if (month > 12) [year, month] = [year + 1, 1];
    const label = `${year}-${String(month).padStart(2, '0')}`;
    if (label > to) return months;
    months.push(label);
  }
}

/** Each named series for each area, month by month from `from` to `to`; a month StreetEasy left blank is null. */
export async function marketValues(database: D1Database, names: readonly string[], areas: readonly number[], from: string, to: string) {
  const ids = names.map(seriesId);
  const seriesMarks = ids.map((_, index) => '?' + (index + 3)).join(', ');
  const areaMarks = areas.map((_, index) => '?' + (index + 3 + ids.length)).join(', ');
  const { results } = await database
    .prepare(
      `SELECT series_id, area_id, month, value FROM market_values
       WHERE month BETWEEN ?1 AND ?2 AND series_id IN (${seriesMarks}) AND area_id IN (${areaMarks})`,
    )
    .bind(from, to, ...ids, ...areas)
    .all<ValueRow>();
  const months = monthsBetween(from, to);
  const position = new Map(months.map((month, index) => [month, index]));
  const values: Record<string, Record<string, (number | null)[]>> = {};
  for (const name of names) {
    values[name] = {};
    for (const area of areas) values[name][area] = months.map(() => null);
  }
  for (const row of results) values[DASHBOARD_FILES[row.series_id - 1]!]![row.area_id]![position.get(row.month)!] = row.value;
  return { months, values };
}

/** Every area's value for one series in one month and the same month a year earlier. */
export async function marketMonth(database: D1Database, name: string, month: string, yearAgo: string) {
  const { results } = await database
    .prepare('SELECT area_id, month, value FROM market_values WHERE series_id = ?1 AND month IN (?2, ?3)')
    .bind(seriesId(name), month, yearAgo)
    .all<Omit<ValueRow, 'series_id'>>();
  const byArea = new Map<number, { area: number; value: number | null; yearAgo: number | null }>();
  for (const row of results) {
    const entry = byArea.get(row.area_id) ?? { area: row.area_id, value: null, yearAgo: null };
    if (row.month === month) entry.value = row.value;
    else entry.yearAgo = row.value;
    byArea.set(row.area_id, entry);
  }
  return [...byArea.values()].sort((a, b) => a.area - b.area);
}
