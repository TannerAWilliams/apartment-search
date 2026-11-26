/** Reference data: rent charts, affordable housing and official building records. */
import { offline, search } from '../search.ts';
import { parseFilters } from '../../src/search.ts';
import { vValidator } from '@hono/valibot-validator';
import { rentAreas } from '../../src/market.ts';
import { parentRegion } from '../../src/regions.ts';
import type { RentHistory } from '../../src/rent-history.ts';
import { retrieveBuildingRecords } from '../building-records.ts';
import { readEvictions } from '../open-data.ts';
import { recordBuildingReport } from '../building-facts.ts';
import { log } from '../log.ts';
import { storedJerseyAffordable } from '../sources/jersey-affordable.ts';
import { storedHomeSeeker } from '../sources/westchester-homeseeker.ts';
import { storedHdcRerentals, storedHousing } from '../refresh/snapshots.ts';
import { storedMarket, storedRentHistory } from '../refresh/market.ts';
import { afterResponse, apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { transitStops } from '../open-data.ts';
import { BuildingAddressSchema, MarketQuerySchema, NeighborhoodQuerySchema, StreetViewQuerySchema } from './inputs.ts';
import { neighborhoodReport } from '../neighborhoods.ts';
import { streetViewImage, streetViewLimit } from '../street-view.ts';

export const dataRoutes = factory
  .createApp()
  // The map's transit layer; the same for everyone and changed monthly, so browsers and Cloudflare keep it a day.
  .get('/transit', needsStorage('Transit stops need saved storage.'), async (c) =>
    c.json(await transitStops(c.var.bucket), 200, { 'Cache-Control': 'public, max-age=86400' }),
  )
  .get('/street-view', vValidator('query', StreetViewQuerySchema, refuse), async (c) => {
    const env = c.var.appEnv;
    const { database, fetcher } = c.var.services;
    if (!env.GOOGLE_MAPS_API_KEY || !database) return fail(c, 404, 'Street View images are not set up.');
    const { lat, lng } = c.req.valid('query');
    try {
      const result = await streetViewImage(
        { key: env.GOOGLE_MAPS_API_KEY, database, limit: streetViewLimit(env.STREET_VIEW_MONTHLY_LIMIT) },
        { latitude: lat, longitude: lng },
        fetcher,
      );
      if (result.status !== 200) return fail(c, result.status, result.error);
      // The browser may keep the image a day, so scrolling back does not count again; the server keeps nothing.
      return new Response(result.body, {
        headers: { 'Content-Type': result.contentType, 'Cache-Control': 'private, max-age=86400' },
      });
    } catch (cause) {
      log.warn('street_view_failed', { error: cause instanceof Error ? cause.message : String(cause) });
      return fail(c, 502, 'Street View could not be reached.');
    }
  })
  .get('/market', vValidator('query', MarketQuerySchema, refuse), async (c) => {
    const env = c.var.appEnv;
    const { region, grouping } = c.req.valid('query');
    try {
      // The snapshot covers New York City and nearby New Jersey; Connecticut's figures come from Walkup's own listings.
      if (parentRegion(region) === 'ct') {
        const { matches } = await search(parseFilters({ region, bedrooms: null, maxRent: null }), env, offline, true, { kept: true });
        return c.json({ month: new Date().toISOString().slice(0, 7), areas: rentAreas(matches, { region, grouping }), history: [] }, 200);
      }
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
  .get('/neighborhood', vValidator('query', NeighborhoodQuerySchema, refuse), async (c) => {
    const { fetcher } = c.var.services;
    return c.json(await neighborhoodReport(c.var.appEnv, c.req.valid('query').name, (url, options) => fetcher(url, options)), 200);
  })
  .post('/building-report', apiBodies, vValidator('json', BuildingAddressSchema, refuse), async (c) => {
    const { fetcher } = c.var.services;
    const address = c.req.valid('json');
    const bucket = c.var.appEnv.BUCKET;
    const report = await retrieveBuildingRecords(
      address,
      (url, options) => fetcher(url, options),
      new Date(),
      c.req.raw.signal,
      // Read from storage while the city's records are asked for, not before.
      bucket ? readEvictions(bucket) : null,
    );
    // Kept so the building's cards show its grade from now on; a failure to keep it does not fail the report.
    if (bucket)
      await afterResponse(c.var.services, 'building_facts_write', () =>
        recordBuildingReport(bucket, { address: address.address ?? '', state: address.state ?? 'NY', zip: address.zip ?? '' }, report),
      );
    return c.json(report, 200);
  });
