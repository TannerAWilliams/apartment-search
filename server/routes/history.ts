/**
 * Market history: StreetEasy's monthly Data Dashboard figures since 2010, from the D1 market history tables.
 * GET /api/history is the catalog (series, areas, provenance); /api/history/values and /api/history/month read
 * the tables, loading a series from the verified archive the first time it is asked for.
 */
import { vValidator } from '@hono/valibot-validator';
import { DASHBOARD_FILES, dashboardMarket, METRICS } from '../../src/dashboard-data.ts';
import { PROVENANCE } from '../dashboard-snapshot.ts';
import { DASHBOARD_AREAS, DASHBOARD_CATALOG } from '../data/dashboard-catalog.ts';
import { log } from '../log.ts';
import type { D1Database } from '../storage/d1-bucket.ts';
import { ensureMarketSeries, marketHistoryState, marketMonth, marketValues, seriesId } from '../storage/market-history.ts';
import { factory, fail, refuse } from './context.ts';
import { HistoryMonthQuerySchema, HistoryValuesQuerySchema } from './inputs.ts';

const shiftYear = (month: string, years: number) => `${Number(month.slice(0, 4)) + years}${month.slice(4)}`;

/** The series the archive holds, as the catalog lists them before the tables say otherwise. */
const SERIES = DASHBOARD_FILES.flatMap((name) => {
  const file = DASHBOARD_CATALOG.find((entry) => entry.name === name);
  if (!file) return [];
  const [label, unit] = METRICS[file.metric];
  const { metric, segment, firstMonth, lastMonth } = file;
  return [{ name, metric, segment, label, unit, market: dashboardMarket(metric), firstMonth, lastMonth }];
});
const ARCHIVE_AREAS = DASHBOARD_AREAS.map((area, index) => ({ id: index + 1, ...area }));
const latestOf = (series: { lastMonth: string }[]) =>
  series.reduce((latest, item) => (item.lastMonth > latest ? item.lastMonth : latest), '');

/** The catalog: each series' months, every area, and when the figures last came from StreetEasy. */
async function catalog(database: D1Database | undefined) {
  if (!database) return { provenance: PROVENANCE, latestMonth: latestOf(SERIES), refreshedAt: null, series: SERIES, areas: ARCHIVE_AREAS };
  const state = await marketHistoryState(database);
  const series = SERIES.map((item) => ({ ...item, lastMonth: state.imports.get(seriesId(item.name))?.last_month ?? item.lastMonth }));
  const downloads = [...state.imports.values()].filter(({ source }) => source === 'cdn').map(({ imported_at }) => imported_at);
  return {
    provenance: PROVENANCE,
    latestMonth: latestOf(series),
    refreshedAt: downloads.sort().at(-1) ?? null,
    series,
    areas: state.areas.length ? state.areas : ARCHIVE_AREAS,
  };
}

export const historyRoutes = factory
  .createApp()
  .get('/history', async (c) => {
    try {
      return c.json(await catalog(c.var.services.database), 200);
    } catch (cause) {
      log.error('market_history_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The market history could not be read.');
    }
  })
  .get('/history/values', vValidator('query', HistoryValuesQuerySchema, refuse), async (c) => {
    const { database, dashboardArchive } = c.var.services;
    if (!database) return fail(c, 503, 'Market history needs the database, which this server does not have.');
    const { series, areas, from, to } = c.req.valid('query');
    try {
      await ensureMarketSeries(database, series, dashboardArchive);
      return c.json(await marketValues(database, series, areas, from, to), 200);
    } catch (cause) {
      log.error('market_history_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The market history could not be read.');
    }
  })
  .get('/history/month', vValidator('query', HistoryMonthQuerySchema, refuse), async (c) => {
    const { database, dashboardArchive } = c.var.services;
    if (!database) return fail(c, 503, 'Market history needs the database, which this server does not have.');
    const { series, month } = c.req.valid('query');
    const yearAgo = shiftYear(month, -1);
    try {
      await ensureMarketSeries(database, [series], dashboardArchive);
      return c.json({ series, month, yearAgo, rows: await marketMonth(database, series, month, yearAgo) }, 200);
    } catch (cause) {
      log.error('market_history_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The market history could not be read.');
    }
  });
