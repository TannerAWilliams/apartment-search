/** GET and POST /api/members: an admin lists accounts and puts them on the paid plan or the free one. */
import { vValidator } from '@hono/valibot-validator';
import { members, setPaid } from '../plans.ts';
import type { D1Database } from '../storage/d1-bucket.ts';
import { apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { PlanRequestSchema } from './inputs.ts';

const STORAGE = 'Plans need saved storage.';
const ADMINS_ONLY = 'Only an admin can see and change plans.';

/** Everyone with a sign-in account, newest first, up to 500. */
async function accountEmails(database: D1Database | undefined) {
  if (!database) return [];
  const rows = await database.prepare('SELECT "email" FROM "user" ORDER BY "createdAt" DESC LIMIT 500').all<{ email: string }>();
  return rows.results.map(({ email }) => email);
}

export const planRoutes = factory
  .createApp()
  .get('/members', needsStorage(STORAGE), async (c) => {
    if (!c.var.services.admin) return fail(c, 403, ADMINS_ONLY);
    return c.json({ members: await members(c.var.appEnv, c.var.bucket, await accountEmails(c.var.services.database)) }, 200);
  })
  .post('/members', needsStorage(STORAGE), apiBodies, vValidator('json', PlanRequestSchema, refuse), async (c) => {
    if (!c.var.services.admin) return fail(c, 403, ADMINS_ONLY);
    const { email, paid } = c.req.valid('json');
    await setPaid(c.var.bucket, email, paid);
    return c.json({ members: await members(c.var.appEnv, c.var.bucket, await accountEmails(c.var.services.database)) }, 200);
  });
