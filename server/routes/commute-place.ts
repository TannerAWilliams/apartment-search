/** GET and POST /api/commute-place: the signed-in account's commute destination. Without an account it stays on the device. */
import { vValidator } from '@hono/valibot-validator';
import { readCommutePlace, writeCommutePlace } from '../commute-place.ts';
import { apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { CommutePlaceRequestSchema } from './inputs.ts';

const STORAGE = 'Your commute needs saved storage.';
const NO_ACCOUNT = 'Sign in to keep your commute on your account.';

export const commutePlaceRoutes = factory
  .createApp()
  .get('/commute-place', needsStorage(STORAGE), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json({ place: await readCommutePlace(c.var.bucket, account) }, 200);
  })
  .post('/commute-place', needsStorage(STORAGE), apiBodies, vValidator('json', CommutePlaceRequestSchema, refuse), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json({ place: await writeCommutePlace(c.var.bucket, account, c.req.valid('json').place) }, 200);
  });
