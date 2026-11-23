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
import { ensureMarketSeries, marketMonth, marketValues } from '../storage/market-history.ts';
import { factory, fail, refuse } from './context.ts';
import { HistoryMonthQuerySchema, HistoryValuesQuerySchema } from './inputs.ts';

const shiftYear = (month: string, years: number) => `${Number(month.slice(0, 4)) + years}${month.slice(4)}`;

/** The catalog: the same for every request, so it is built once. */
const CATALOG = {
  provenance: PROVENANCE,
  latestMonth: DASHBOARD_CATALOG.reduce((latest, file) => (file.lastMonth > latest ? file.lastMonth : latest), ''),
  series: DASHBOARD_FILES.flatMap((name) => {
    const file = DASHBOARD_CATALOG.find((entry) => entry.name === name);
    if (!file) return [];
    const [label, unit] = METRICS[file.metric];
    const { metric, segment, firstMonth, lastMonth } = file;
    return [{ name, metric, segment, label, unit, market: dashboardMarket(metric), firstMonth, lastMonth }];
  }),
  areas: DASHBOARD_AREAS.map((area, index) => ({ id: index + 1, ...area })),
};

/** The figures are licensed research data, so a private server serves them only to someone signed in. */
const signedIn = factory.createMiddleware(async (c, next) => {
  const { appEnv: env, services } = c.var;
  if (env.PUBLIC_APP !== 'true' && !services.privateAuthenticated)
    return fail(c, 403, 'Private authenticated access is required for this research snapshot.');
  return next();
});

export const historyRoutes = factory
  .createApp()
  .use('/history', signedIn)
  .use('/history/*', signedIn)
  .get('/history', (c) => c.json(CATALOG, 200))
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
