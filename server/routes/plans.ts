/** GET and POST /api/members: an admin lists accounts and puts them on the paid plan or the free one. */
import { vValidator } from '@hono/valibot-validator';
import { members, setPaid } from '../plans.ts';
import { apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { PlanRequestSchema } from './inputs.ts';

const STORAGE = 'Plans need saved storage.';
const ADMINS_ONLY = 'Only an admin can see and change plans.';

export const planRoutes = factory
  .createApp()
  .get('/members', needsStorage(STORAGE), async (c) => {
    if (!c.var.services.admin) return fail(c, 403, ADMINS_ONLY);
    return c.json({ members: await members(c.var.appEnv, c.var.bucket) }, 200);
  })
  .post('/members', needsStorage(STORAGE), apiBodies, vValidator('json', PlanRequestSchema, refuse), async (c) => {
    if (!c.var.services.admin) return fail(c, 403, ADMINS_ONLY);
    const { email, paid } = c.req.valid('json');
    await setPaid(c.var.bucket, email, paid);
    return c.json({ members: await members(c.var.appEnv, c.var.bucket) }, 200);
  });
