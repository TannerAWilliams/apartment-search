/** GET and POST /api/billing: the account's plan and payments, Stripe Checkout and the billing portal (server/billing.ts). */
import { recordEvent } from '../ops.ts';
import { vValidator } from '@hono/valibot-validator';
import { billingFor, checkoutUrl, portalUrl } from '../billing.ts';
import { apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { BillingRequestSchema } from './inputs.ts';

const STORAGE = 'Payments need saved storage.';
const NO_ACCOUNT = 'Sign in to upgrade.';

export const billingRoutes = factory
  .createApp()
  .get('/billing', needsStorage(STORAGE), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json(await billingFor(c.var.appEnv, c.var.bucket, account), 200);
  })
  .post('/billing', needsStorage(STORAGE), apiBodies, vValidator('json', BillingRequestSchema, refuse), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    const env = c.var.appEnv;
    const origin = env.APP_ORIGIN ?? new URL(c.req.url).origin;
    const body = c.req.valid('json');
    if (body.action === 'checkout') await recordEvent(c.var.bucket, 'checkout');
    const url =
      body.action === 'checkout'
        ? await checkoutUrl(env, account, body.plan, origin, c.var.services.fetcher)
        : await portalUrl(env, c.var.bucket, account, origin, c.var.services.fetcher);
    return c.json({ url }, 200);
  });
