/** GET and POST /api/direct: owners' no-fee listings (server/direct-listings.ts): submit, review, renew, remove. */
import { vValidator } from '@hono/valibot-validator';
import * as v from 'valibot';
import { decideDirect, DirectListingInputSchema, readDirect, submitDirect } from '../direct-listings.ts';
import { apiBodies, factory, fail, needsStorage, refuse } from './context.ts';

const STORAGE = 'Listings need saved storage.';
const NO_ACCOUNT = 'Sign in to list an apartment.';
const DirectRequestSchema = v.variant(
  'action',
  [
    v.object({ action: v.literal('submit'), listing: DirectListingInputSchema }),
    v.object({ action: v.picklist(['approve', 'reject', 'remove', 'renew']), id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)) }),
  ],
  'Choose submit, approve, reject, remove or renew.',
);

export const directRoutes = factory
  .createApp()
  .get('/direct', needsStorage(STORAGE), async (c) => {
    const account = c.var.services.account?.toLowerCase();
    if (!account) return fail(c, 404, NO_ACCOUNT);
    const entries = await readDirect(c.var.bucket);
    return c.json(
      {
        mine: entries.filter(({ owner }) => owner === account),
        // Admins review what is waiting.
        pending: c.var.services.admin ? entries.filter(({ status }) => status === 'pending') : [],
      },
      200,
    );
  })
  .post('/direct', needsStorage(STORAGE), apiBodies, vValidator('json', DirectRequestSchema, refuse), async (c) => {
    const account = c.var.services.account?.toLowerCase();
    if (!account) return fail(c, 404, NO_ACCOUNT);
    const body = c.req.valid('json');
    const entry =
      body.action === 'submit'
        ? await submitDirect(c.var.bucket, account, body.listing, c.var.services.fetcher)
        : await decideDirect(c.var.bucket, body.id, body.action, { admin: c.var.services.admin === true, account });
    return c.json({ entry }, 200);
  });
