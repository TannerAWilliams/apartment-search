/**
 * The signed-in account's own data: GET /api/account downloads it, POST /api/account deletes the account.
 * GET /api/admin/stats is the admin dashboard.
 */
import { vValidator } from '@hono/valibot-validator';
import { deleteAccount, exportAccount } from '../account.ts';
import { adminStats } from '../admin.ts';
import { apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { AccountRequestSchema } from './inputs.ts';

const STORAGE = 'Accounts need saved storage.';
const NO_ACCOUNT = 'Sign in to manage your account.';

export const accountRoutes = factory
  .createApp()
  .get('/account', needsStorage(STORAGE), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    const data = await exportAccount({ ...c.var.appEnv, BUCKET: c.var.bucket }, account, c.var.services.admin);
    return c.json(data, 200, { 'Content-Disposition': 'attachment; filename="walkup-account.json"' });
  })
  .post('/account', needsStorage(STORAGE), apiBodies, vValidator('json', AccountRequestSchema, refuse), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json(await deleteAccount({ ...c.var.appEnv, BUCKET: c.var.bucket }, c.var.services.database, account), 200);
  })
  .get('/admin/stats', needsStorage(STORAGE), async (c) => {
    if (!c.var.services.admin) return fail(c, 403, 'Only an admin can see the dashboard.');
    return c.json(await adminStats({ ...c.var.appEnv, BUCKET: c.var.bucket }), 200);
  });
