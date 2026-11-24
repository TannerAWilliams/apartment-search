/** GET and POST /api/household: the signed-in account's shared list (server/households.ts). */
import { vValidator } from '@hono/valibot-validator';
import { changeHousehold, findHousehold } from '../households.ts';
import { IMPORT_BODIES, factory, fail, needsStorage, refuse } from './context.ts';
import { HouseholdRequestSchema } from './inputs.ts';

const STORAGE = 'Shared lists need saved storage.';
const NO_ACCOUNT = 'Sign in to share a list.';

export const householdRoutes = factory
  .createApp()
  .get('/household', needsStorage(STORAGE), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json({ household: await findHousehold(c.var.bucket, account.toLowerCase()), me: account.toLowerCase() }, 200);
  })
  .post('/household', needsStorage(STORAGE), IMPORT_BODIES, vValidator('json', HouseholdRequestSchema, refuse), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    // A refused change (SearchInputError) becomes a 422 with its message in the API's error handler.
    const household = await changeHousehold(c.var.bucket, account, c.req.valid('json'));
    return c.json({ household, me: account.toLowerCase() }, 200);
  });
