/** GET and POST /api/saved: the signed-in account's saved listings. Without an account they stay on the device. */
import { recordEvent } from '../ops.ts';
import { vValidator } from '@hono/valibot-validator';
import { readSaved, writeSaved } from '../saved.ts';
import { afterResponse, apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { SavedRequestSchema } from './inputs.ts';

const STORAGE = 'Saved listings need saved storage.';
const NO_ACCOUNT = 'Sign in to keep saved listings on your account.';

export const savedRoutes = factory
  .createApp()
  .get('/saved', needsStorage(STORAGE), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json({ listings: await readSaved(c.var.bucket, account) }, 200);
  })
  .post('/saved', needsStorage(STORAGE), apiBodies, vValidator('json', SavedRequestSchema, refuse), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    const before = (await readSaved(c.var.bucket, account)).length;
    const listings = await writeSaved(c.var.bucket, account, c.req.valid('json').listings);
    if (listings.length > before) await afterResponse(c.var.services, 'save_event', () => recordEvent(c.var.bucket, 'save'));
    return c.json({ listings }, 200);
  });
