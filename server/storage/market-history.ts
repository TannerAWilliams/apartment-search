/**
 * StreetEasy's monthly market data in D1 (deploy/cloudflare/migrations/0002_market_history.sql). Each series is
 * loaded from the verified archive the first time it is asked for, in one transaction, so a reader sees either
 * none of a series or all of it; when the archive changes, a series is replaced the next time it is read.
 */
import { DASHBOARD_FILES, type DashboardFile } from '../../src/dashboard-data.ts';
import { ARCHIVE_SHA256, type ArchiveLoader, dashboardFile } from '../dashboard-snapshot.ts';
import { DASHBOARD_AREAS } from '../data/dashboard-catalog.ts';
import { log } from '../log.ts';
import { chunks, type D1Database } from './d1-bucket.ts';

/** A series' number in the tables: its position in DASHBOARD_FILES, plus one. */
export const seriesId = (name: string) => DASHBOARD_FILES.indexOf(name) + 1;
const AREA_IDS = new Map(DASHBOARD_AREAS.map(({ name, borough, type }, index) => [JSON.stringify([name, borough, type]), index + 1]));

const AREAS_JSON = JSON.stringify(DASHBOARD_AREAS.map(({ name, borough, type }, index) => [index + 1, name, borough, type]));
const WRITE_AREAS = `INSERT OR IGNORE INTO market_areas (id, name, borough, area_type)
  SELECT row.value ->> '$[0]', row.value ->> '$[1]', row.value ->> '$[2]', row.value ->> '$[3]' FROM json_each(?1) AS row`;
const WRITE_SERIES = 'INSERT OR IGNORE INTO market_series (id, metric, segment) VALUES (?1, ?2, ?3)';
const CLEAR_VALUES = 'DELETE FROM market_values WHERE series_id = ?1';
const WRITE_VALUES = `INSERT OR REPLACE INTO market_values (series_id, area_id, month, value)
  SELECT ?1, row.value ->> '$[0]', row.value ->> '$[1]', row.value ->> '$[2]' FROM json_each(?2) AS row`;
const WRITE_IMPORT = `INSERT OR REPLACE INTO market_imports (series_id, archive_sha256, imported_at, value_count) VALUES (?1, ?2, ?3, ?4)`;

/** The reported values of a parsed file as [area id, month, value] rows; blank months have none. */
export function valueRows(file: DashboardFile) {
  const rows: string[] = [];
  for (const area of file.areas) {
    const id = AREA_IDS.get(JSON.stringify([area.name, area.borough, area.type]));
    if (!id) throw new Error('The dashboard archive has an area the catalog does not list: rebuild it with scripts/dashboard-catalog.ts.');
    area.values.forEach((value, index) => {
      if (value !== null) rows.push(JSON.stringify([id, file.months[index], value]));
    });
  }
  return rows;
}

/** Loads the named series that are not yet loaded from this archive. Returns how many were loaded. */
export async function ensureMarketSeries(database: D1Database, names: readonly string[], loadArchive: ArchiveLoader, now = new Date()) {
  const ids = names.map(seriesId);
  const placeholders = ids.map((_, index) => '?' + (index + 2)).join(', ');
  const { results } = await database
    .prepare(`SELECT series_id FROM market_imports WHERE archive_sha256 = ?1 AND series_id IN (${placeholders})`)
    .bind(ARCHIVE_SHA256, ...ids)
    .all<{ series_id: number }>();
  const loaded = new Set(results.map(({ series_id }) => series_id));
  const missing = names.filter((name) => !loaded.has(seriesId(name)));
  for (const name of missing) {
    const file = await dashboardFile(name, loadArchive);
    if (!file) throw new Error('Unknown dashboard series.');
    const id = seriesId(name);
    const rows = valueRows(file);
    await database.batch([
      database.prepare(WRITE_AREAS).bind(AREAS_JSON),
      database.prepare(WRITE_SERIES).bind(id, file.metric, file.segment),
      database.prepare(CLEAR_VALUES).bind(id),
      ...chunks(rows).map(({ json }) => database.prepare(WRITE_VALUES).bind(id, json)),
      database.prepare(WRITE_IMPORT).bind(id, ARCHIVE_SHA256, now.toISOString(), rows.length),
    ]);
    log.info('market_series_loaded', { series: name, values: rows.length });
  }
  return missing.length;
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
