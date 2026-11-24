import { expect, test } from 'bun:test';
import {
  applyStripeEvent,
  billedEmails,
  billingFor,
  checkoutUrl,
  PASS_DAYS,
  readBilling,
  stripeWebhook,
  verifyStripeSignature,
} from '../server/billing.ts';
import { planFor } from '../server/plans.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const SECRET = 'whsec_test_secret';
const now = new Date('2026-11-24T12:00:00Z');
const env = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_PRICE_MONTHLY: 'price_monthly',
  STRIPE_PRICE_PASS: 'price_pass',
  ACCESS_ALLOWED_EMAILS: 'owner@example.test,renter@example.test',
};

async function sign(body: string, at = now, secret = SECRET) {
  const t = Math.floor(at.getTime() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `t=${t},v1=${signature}`;
}
const event = (type: string, object: Record<string, unknown>, id: string = crypto.randomUUID()) => ({ id, type, data: { object } });
const paid = (email: string, plan: string, extra: Record<string, unknown> = {}) =>
  event('checkout.session.completed', { payment_status: 'paid', client_reference_id: email, metadata: { plan }, ...extra });

test('only a recent webhook signed with the secret is accepted', async () => {
  const body = '{"id":"evt_1"}';
  expect(await verifyStripeSignature(SECRET, body, await sign(body), now)).toBe(true);
  expect(await verifyStripeSignature(SECRET, body + ' ', await sign(body), now), 'another body').toBe(false);
  expect(await verifyStripeSignature(SECRET, body, await sign(body, now, 'whsec_other'), now), 'another secret').toBe(false);
  expect(await verifyStripeSignature(SECRET, body, await sign(body, new Date(now.getTime() - 600_000)), now), 'too old').toBe(false);
  expect(await verifyStripeSignature(SECRET, body, 't=1', now)).toBe(false);
  expect(await verifyStripeSignature(SECRET, body, null, now)).toBe(false);
  expect(await verifyStripeSignature(SECRET, body, `t=${Math.floor(now.getTime() / 1000)},v1=abc`, now), 'short signature').toBe(false);
});

test('a three-month pass, a subscription, its renewals and its end move the account’s paid date', async () => {
  const bucket = createMemoryBucket();
  expect(await applyStripeEvent(bucket, paid('Renter@example.test', 'pass'), now)).toBe('paid');
  const pass = (await readBilling(bucket)).accounts['renter@example.test'];
  expect(pass).toEqual({ plan: 'pass', until: new Date(now.getTime() + PASS_DAYS * 86_400_000).toISOString() });
  expect(await planFor(env, bucket, 'renter@example.test')).toBe('paid');
  // A second pass adds to the first.
  await applyStripeEvent(bucket, paid('renter@example.test', 'pass'), now);
  expect((await readBilling(bucket)).accounts['renter@example.test'].until).toBe(
    new Date(now.getTime() + 2 * PASS_DAYS * 86_400_000).toISOString(),
  );

  await applyStripeEvent(bucket, paid('sub@example.test', 'monthly', { customer: 'cus_1', subscription: 'sub_1' }), now);
  expect((await readBilling(bucket)).accounts['sub@example.test']).toMatchObject({
    plan: 'monthly',
    customer: 'cus_1',
    subscription: 'sub_1',
  });
  const periodEnd = Math.floor(now.getTime() / 1000) + 60 * 86_400;
  expect(
    await applyStripeEvent(bucket, event('invoice.paid', { customer: 'cus_1', lines: { data: [{ period: { end: periodEnd } }] } }), now),
  ).toBe('renewed');
  expect((await readBilling(bucket)).accounts['sub@example.test'].until).toBe(new Date((periodEnd + 3 * 86_400) * 1000).toISOString());
  const ended = event('customer.subscription.deleted', { customer: 'cus_1' }, 'evt_end');
  expect(await applyStripeEvent(bucket, ended, now)).toBe('ended');
  expect(await applyStripeEvent(bucket, ended, now), 'the same event twice').toBe('duplicate');
  expect(await billedEmails(bucket, new Date(now.getTime() + 1000))).toEqual(['renter@example.test']);

  // Events that change nothing.
  expect(await applyStripeEvent(bucket, event('invoice.paid', { customer: 'cus_unknown', lines: { data: [] } }), now)).toBe('ignored');
  expect(await applyStripeEvent(bucket, event('invoice.paid', { customer: 'cus_1', lines: { data: ['x'] } }), now)).toBe('ignored');
  expect(await applyStripeEvent(bucket, event('invoice.paid', { customer: 'cus_1', lines: null }), now)).toBe('ignored');
  expect(await applyStripeEvent(bucket, event('customer.subscription.deleted', { customer: 'nobody' }), now)).toBe('ignored');
  expect(await applyStripeEvent(bucket, paid('', 'pass'), now)).toBe('ignored');
  expect(await applyStripeEvent(bucket, event('checkout.session.completed', { payment_status: 'unpaid' }), now)).toBe('ignored');
  expect(await applyStripeEvent(bucket, { type: 'x' }, now)).toBe('ignored');
  expect(await applyStripeEvent(bucket, { type: 'x', data: { object: {} } }, now)).toBe('ignored');
  // An unreadable billing document reads as nobody.
  const garbled = createMemoryBucket();
  await garbled.put('settings/billing.json', 'not json');
  expect(await readBilling(garbled)).toEqual({ accounts: {}, events: [] });
});

test('checkout and the billing portal open Stripe’s pages; without settings payments are off', async () => {
  const bucket = createMemoryBucket();
  const sent: { url: string; body: URLSearchParams; auth: string | null }[] = [];
  const stripeApi = async (url: string, init?: RequestInit) => {
    sent.push({ url, body: new URLSearchParams(String(init?.body)), auth: new Headers(init?.headers).get('Authorization') });
    return Response.json({ url: 'https://checkout.stripe.test/session' });
  };
  const services = { account: 'renter@example.test', fetcher: stripeApi };
  const call = (body?: unknown, environment: Record<string, unknown> = { ...env, BUCKET: bucket }, extra: object = services) =>
    handleApi(
      new Request(
        'https://app.test/api/billing',
        body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      ),
      environment,
      extra,
    );
  expect(await readJson(call())).toEqual({ available: true, plans: { monthly: '$15 a month', pass: '$35 for 3 months' } });
  expect(await readJson(call({ action: 'checkout', plan: 'monthly' }))).toEqual({ url: 'https://checkout.stripe.test/session' });
  expect(sent[0]?.url).toBe('https://api.stripe.com/v1/checkout/sessions');
  expect(sent[0]?.auth).toBe('Bearer sk_test_x');
  expect(Object.fromEntries(sent[0]!.body)).toMatchObject({
    mode: 'subscription',
    'line_items[0][price]': 'price_monthly',
    client_reference_id: 'renter@example.test',
    success_url: 'https://app.test/profile',
  });
  await call({ action: 'checkout', plan: 'pass' });
  expect(sent[1]?.body.get('mode')).toBe('payment');
  expect(sent[1]?.body.get('line_items[0][price]')).toBe('price_pass');
  expect((await call({ action: 'portal' })).status, 'no subscription yet').toBe(422);
  await applyStripeEvent(bucket, paid('renter@example.test', 'monthly', { customer: 'cus_9' }), new Date());
  expect(await readJson(call())).toMatchObject({ plan: 'monthly', manage: true });
  expect(await readJson(call({ action: 'portal' }))).toEqual({ url: 'https://checkout.stripe.test/session' });
  expect(sent[2]?.url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
  expect(sent[2]?.body.get('customer')).toBe('cus_9');

  expect((await call({ action: 'checkout', plan: 'monthly' }, { BUCKET: bucket })).status, 'not set up').toBe(422);
  expect((await call(undefined, { ...env, BUCKET: bucket }, { account: null })).status).toBe(404);
  expect((await call({ action: 'portal' }, { ...env, BUCKET: bucket }, { account: null })).status).toBe(404);
  expect((await call({ action: 'refund' })).status).toBe(422);
  const failing = async () => Response.json({ error: { message: 'No such price' } }, { status: 400 });
  await expect(checkoutUrl(env, 'a@example.test', 'pass', 'https://app.test', failing)).rejects.toThrow(/unavailable right now/);
  expect((await billingFor({}, bucket, 'nobody@example.test')).available).toBe(false);
});

test('the webhook records signed events and refuses everything else', async () => {
  const bucket = createMemoryBucket();
  const body = JSON.stringify(paid('renter@example.test', 'pass'));
  const request = async (signature: string | null, text = body) =>
    new Request('https://app.test/api/billing/webhook', {
      method: 'POST',
      body: text,
      headers: signature ? { 'Stripe-Signature': signature } : {},
    });
  const ok = await stripeWebhook(env, bucket, await request(await sign(body, new Date())));
  expect(await ok.json()).toEqual({ received: true, result: 'paid' });
  expect((await stripeWebhook(env, bucket, await request('t=1,v1=00'))).status).toBe(400);
  expect((await stripeWebhook(env, bucket, await request(null, 'x'.repeat(300 * 1024)))).status).toBe(400);
  expect((await stripeWebhook({}, bucket, await request(null))).status).toBe(404);
});
