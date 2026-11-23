/** Reference data: rent charts, affordable housing and official building records. */
import { vValidator } from '@hono/valibot-validator';
import { rentAreas } from '../../src/market.ts';
import { parentRegion } from '../../src/regions.ts';
import type { RentHistory } from '../../src/rent-history.ts';
import { retrieveBuildingRecords } from '../building-records.ts';
import { log } from '../log.ts';
import { storedJerseyAffordable } from '../sources/jersey-affordable.ts';
import { storedHomeSeeker } from '../sources/westchester-homeseeker.ts';
import { storedHdcRerentals, storedHousing } from '../refresh/snapshots.ts';
import { storedMarket, storedRentHistory } from '../refresh/market.ts';
import { apiBodies, factory, fail, refuse } from './context.ts';
import { BuildingAddressSchema, MarketQuerySchema } from './inputs.ts';

export const dataRoutes = factory
  .createApp()
  .get('/market', vValidator('query', MarketQuerySchema, refuse), async (c) => {
    const env = c.var.appEnv;
    const { region, grouping } = c.req.valid('query');
    try {
      const market = await storedMarket(env.BUCKET);
      const areas = rentAreas(market.listings, { region, grouping });
      const scoped = parentRegion(region) !== region;
      const history = await storedRentHistory(env.BUCKET, market.month, parentRegion(region), grouping);
      const areaIds = new Set(areas.filter(({ id }) => id !== 'overall').map(({ id }) => id));
      return c.json(
        {
          month: market.month,
          areas,
          history: scoped ? history.map(([month, rows]): RentHistory[number] => [month, rows.filter(([id]) => areaIds.has(id))]) : history,
        },
        200,
      );
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The refreshed rent data could not be read.');
    }
  })
  .get('/housing', async (c) => {
    const env = c.var.appEnv;
    try {
      const [housing, rerentals, jersey, westchester] = await Promise.all([
        storedHousing(env.BUCKET),
        storedHdcRerentals(env.BUCKET).catch(() => null),
        storedJerseyAffordable(env.BUCKET).catch(() => null),
        storedHomeSeeker(env.BUCKET).catch(() => null),
      ]);
      return c.json({ ...housing, rerentals, jersey, westchester }, 200);
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The Housing Connect data could not be read.');
    }
  })
  .post('/building-report', apiBodies, vValidator('json', BuildingAddressSchema, refuse), async (c) => {
    const { fetcher } = c.var.services;
    return c.json(
      await retrieveBuildingRecords(c.req.valid('json'), (url, options) => fetcher(url, options), new Date(), c.req.raw.signal),
      200,
    );
  });
