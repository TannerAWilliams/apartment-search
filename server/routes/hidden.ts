/** GET and POST /api/hidden: the apartments the signed-in account has hidden. Without an account they stay on the device. */
import { vValidator } from '@hono/valibot-validator';
import { readHidden, writeHidden } from '../hidden.ts';
import { factory, fail, IMPORT_BODIES, needsStorage, refuse } from './context.ts';
import { HiddenRequestSchema } from './inputs.ts';

const STORAGE = 'Hidden apartments need saved storage.';
const NO_ACCOUNT = 'Sign in to keep hidden apartments on your account.';

export const hiddenRoutes = factory
  .createApp()
  .get('/hidden', needsStorage(STORAGE), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json({ keys: await readHidden(c.var.bucket, account) }, 200);
  })
  .post('/hidden', needsStorage(STORAGE), IMPORT_BODIES, vValidator('json', HiddenRequestSchema, refuse), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json({ keys: await writeHidden(c.var.bucket, account, c.req.valid('json').keys) }, 200);
  });
