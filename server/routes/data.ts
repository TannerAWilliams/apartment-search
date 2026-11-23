/** Reference data: rent charts, affordable housing, the StreetEasy dashboard and official building records. */
import { vValidator } from '@hono/valibot-validator';
import { rentAreas } from '../../src/market.ts';
import { parentRegion } from '../../src/regions.ts';
import type { RentHistory } from '../../src/rent-history.ts';
import { retrieveBuildingRecords } from '../building-records.ts';
import { dashboardSnapshot } from '../dashboard-snapshot.ts';
import { log } from '../log.ts';
import { storedJerseyAffordable } from '../jersey-affordable.ts';
import { storedHdcRerentals, storedHousing, storedMarket, storedRentHistory } from '../refresh.ts';
import { apiBodies, factory, fail, refuse } from './context.ts';
import { BuildingAddressSchema, DashboardQuerySchema, MarketQuerySchema } from './inputs.ts';

export const dataRoutes = factory.createApp()
  .get('/market', vValidator('query', MarketQuerySchema, refuse), async (c) => {
    const env = c.var.appEnv;
    const { region, grouping } = c.req.valid('query');
    try {
      const market = await storedMarket(env.BUCKET);
      const areas = rentAreas(market.listings, { region, grouping });
      const scoped = parentRegion(region) !== region;
      const history = await storedRentHistory(env.BUCKET, market.month, parentRegion(region), grouping);
      const areaIds = new Set(areas.filter(({ id }) => id !== 'overall').map(({ id }) => id));
      return c.json({ month: market.month, areas, history: scoped ?
        history.map(([month, rows]): RentHistory[number] => [month, rows.filter(([id]) => areaIds.has(id))]) : history }, 200);
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The refreshed rent data could not be read.');
    }
  })
  .get('/housing', async (c) => {
    const env = c.var.appEnv;
    try {
      const [housing, rerentals, jersey] = await Promise.all([storedHousing(env.BUCKET), storedHdcRerentals(env.BUCKET).catch(() => null),
        storedJerseyAffordable(env.BUCKET).catch(() => null)]);
      return c.json({ ...housing, rerentals, jersey }, 200);
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The Housing Connect data could not be read.');
    }
  })
  .get('/dashboard', vValidator('query', DashboardQuerySchema, refuse), async (c) => {
    const { appEnv: env, services } = c.var;
    if (env.PUBLIC_APP !== 'true' && !services.privateAuthenticated) return fail(c, 403, 'Private authenticated access is required for this research snapshot.');
    try {
      const result = await dashboardSnapshot(c.req.valid('query').file, services.dashboardArchive);
      return result ? c.json(result, 200) : fail(c, 404, 'Unknown dashboard file.');
    } catch (cause) {
      log.error('dashboard_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The historical dashboard data could not be read.');
    }
  })
  .post('/building-report', apiBodies, vValidator('json', BuildingAddressSchema, refuse), async (c) => {
    const { fetcher } = c.var.services;
    return c.json(await retrieveBuildingRecords(c.req.valid('json'), (url, options) => fetcher(url, options), new Date(), c.req.raw.signal), 200);
  });
