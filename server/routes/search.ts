/** Searching saved inventory, checking a whole saved search, and finding a typed workplace address. */
import { vValidator } from '@hono/valibot-validator';
import { SearchFiltersSchema } from '../../src/search.ts';
import { geocodeAddress } from '../commute.ts';
import { offline, search } from '../search.ts';
import { wholeSearchCheck } from '../whole-search-check.ts';
import { apiBodies, factory, refuse } from './context.ts';
import { GeocodeRequestSchema } from './inputs.ts';

export const searchRoutes = factory.createApp()
  .post('/search', apiBodies, vValidator('json', SearchFiltersSchema, refuse), async (c) =>
    c.json(await search(c.req.valid('json'), c.var.appEnv, c.var.services.fetcher), 200))
  .post('/search-check', apiBodies, vValidator('json', SearchFiltersSchema, refuse), async (c) => {
    const env = c.var.appEnv;
    return c.json(await wholeSearchCheck(c.req.valid('json'), env, (filters) => search(filters, env, offline, true)), 200);
  })
  .post('/geocode', apiBodies, vValidator('json', GeocodeRequestSchema, refuse), async (c) =>
    c.json(await geocodeAddress(c.req.valid('json').address, c.var.services.fetcher), 200));
