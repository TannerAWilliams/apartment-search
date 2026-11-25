/** Searching saved inventory, checking a whole saved search, and finding a typed workplace address. */
import { recordEvent } from '../ops.ts';
import { vValidator } from '@hono/valibot-validator';
import { SearchFiltersSchema } from '../../src/search.ts';
import { geocodeAddress, suggestPlaces } from '../commute.ts';
import { cachedSearch, offline, search } from '../search.ts';
import { log } from '../log.ts';
import { createTimings } from '../timing.ts';
import { wholeSearchCheck } from '../whole-search-check.ts';
import { afterResponse, apiBodies, factory, refuse } from './context.ts';
import { GeocodeRequestSchema, PlacesRequestSchema } from './inputs.ts';

/** A search slower than this is logged with where its time went. */
const SLOW_MS = 1000;

export const searchRoutes = factory
  .createApp()
  .post('/search', apiBodies, vValidator('json', SearchFiltersSchema, refuse), async (c) => {
    const timings = createTimings();
    const result = await cachedSearch(c.req.valid('json'), c.var.appEnv, c.var.services.fetcher, undefined, {
      timings,
      waitUntil: c.var.services.waitUntil,
    });
    // Where the time went, for the browser's developer tools; a slow search is logged with its phases.
    c.header('Server-Timing', timings.header());
    if (timings.total() > SLOW_MS) log.warn('slow_search', { ms: Math.round(timings.total()), ...timings.fields() });
    await afterResponse(c.var.services, 'search_event', () => recordEvent(c.var.appEnv.BUCKET, 'search'));
    return c.json(result, 200);
  })
  .post('/search-check', apiBodies, vValidator('json', SearchFiltersSchema, refuse), async (c) => {
    const env = c.var.appEnv;
    return c.json(await wholeSearchCheck(c.req.valid('json'), env, (filters) => search(filters, env, offline, true)), 200);
  })
  .post('/geocode', apiBodies, vValidator('json', GeocodeRequestSchema, refuse), async (c) =>
    c.json(await geocodeAddress(c.req.valid('json').address, c.var.services.fetcher), 200),
  )
  // Suggestions as a destination is typed; a failure is an empty list, so typing never shows an error.
  .post('/places', apiBodies, vValidator('json', PlacesRequestSchema, refuse), async (c) =>
    c.json({ places: await suggestPlaces(c.req.valid('json').query, c.var.services.fetcher).catch(() => []) }, 200),
  );
