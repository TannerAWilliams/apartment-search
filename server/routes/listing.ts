/** GET /api/listing?id=: one listing from saved inventory, with its insights, for its own page and shared links. */
import { vValidator } from '@hono/valibot-validator';
import * as v from 'valibot';
import { isRecord } from '../../src/domain.ts';
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
  const { matches } = await search(
    parseFilters({ region: 'all', bedrooms: null, maxRent: null, includeCached: true }),
    env,
    offline,
    true,
    { kept: true },
  );
  return matches.find((listing) => listing.id === id) ?? null;
}

export const listingRoutes = factory
  .createApp()
  // The listing as its source saved it, by one indexed lookup with no other listing read. An apartment's page
  // shows it at once (from a shared link, before the inventory file has arrived) and takes its recorded rents
  // from it, which the file leaves out. It has no comparisons with other listings; those come with the file.
  .get('/listing/stored', vValidator('query', v.object({ id: ListingQuerySchema.entries.id }), refuse), async (c) => {
    const stored = await c.var.appEnv.BUCKET?.snapshots.find(c.req.valid('query').id);
    return c.json({ listing: isRecord(stored) ? stored : null }, 200);
  })
  .get('/listing', vValidator('query', ListingQuerySchema, refuse), async (c) => {
    const { id, workplace, customWorkplace } = c.req.valid('query');
    const listing = await findListing(c.var.appEnv, id);
    if (!listing) return fail(c, 404, 'This apartment is no longer listed.');
    const place = workplace ? { workplace, customWorkplace } : null;
    return c.json({ listing: place ? await withTransitEstimate(listing, c.var.appEnv, place, c.var.services.fetcher) : listing }, 200);
  });
