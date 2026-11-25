/** GET /api/listing?id=: one listing from saved inventory, with its insights, for its own page and shared links. */
import { vValidator } from '@hono/valibot-validator';
import * as v from 'valibot';
import { parseFilters } from '../../src/search.ts';
import { offline, search, withTransitEstimate } from '../search.ts';
import { factory, fail, refuse } from './context.ts';

const ID = 'Name a listing.';
const ListingQuerySchema = v.object({
  id: v.pipe(v.string(ID), v.minLength(1, ID), v.maxLength(300, ID)),
  /** The person's commute destination, so the page shows the estimated transit time to it. */
  workplace: v.optional(v.pipe(v.string(), v.maxLength(40))),
  customWorkplace: v.optional(v.pipe(v.string(), v.maxLength(160)), ''),
});

/** The listing with this ID in saved inventory, or null. */
export async function findListing(env: Parameters<typeof search>[1], id: string) {
  const { matches } = await search(parseFilters({ region: 'all', bedrooms: null, maxRent: null, includeCached: true }), env, offline, true);
  return matches.find((listing) => listing.id === id) ?? null;
}

export const listingRoutes = factory.createApp().get('/listing', vValidator('query', ListingQuerySchema, refuse), async (c) => {
  const { id, workplace, customWorkplace } = c.req.valid('query');
  const listing = await findListing(c.var.appEnv, id);
  if (!listing) return fail(c, 404, 'This apartment is no longer listed.');
  const place = workplace ? { workplace, customWorkplace } : null;
  return c.json({ listing: place ? await withTransitEstimate(listing, c.var.appEnv, place, c.var.services.fetcher) : listing }, 200);
});
