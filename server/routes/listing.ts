/** GET /api/listing?id=: one listing from saved inventory, with its insights, for its own page and shared links. */
import { vValidator } from '@hono/valibot-validator';
import * as v from 'valibot';
import { parseFilters } from '../../src/search.ts';
import { offline, search } from '../search.ts';
import { factory, fail, refuse } from './context.ts';

const ID = 'Name a listing.';
const ListingQuerySchema = v.object({ id: v.pipe(v.string(ID), v.minLength(1, ID), v.maxLength(300, ID)) });

/** The listing with this ID in saved inventory, or null. */
export async function findListing(env: Parameters<typeof search>[1], id: string) {
  const { matches } = await search(parseFilters({ region: 'all', bedrooms: null, maxRent: null, includeCached: true }), env, offline, true);
  return matches.find((listing) => listing.id === id) ?? null;
}

export const listingRoutes = factory.createApp().get('/listing', vValidator('query', ListingQuerySchema, refuse), async (c) => {
  const listing = await findListing(c.var.appEnv, c.req.valid('query').id);
  return listing ? c.json({ listing }, 200) : fail(c, 404, 'This apartment is no longer listed.');
});
