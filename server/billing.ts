/**
 * Payments with Stripe Checkout: $15 a month (a subscription) or $35 for three months (one payment). Stripe tells
 * the app about payments with signed webhooks, and each paid account is kept with the date it is paid until; the
 * plan check (server/plans.ts) counts it as paid until then. A subscriber manages or cancels in Stripe's billing
 * portal. Nothing here sees card details; Stripe's pages collect them.
 *
 * Settings: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (secrets), STRIPE_PRICE_MONTHLY and STRIPE_PRICE_PASS (the
 * two Stripe price IDs). Without them, payments are off and an admin upgrades accounts by hand.
 */
import * as v from 'valibot';
import { isRecord } from '../src/domain.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { SearchInputError } from '../src/search.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { checkedDocument } from './storage/stored-documents.ts';

const STRIPE = 'https://api.stripe.com/v1/';
const BILLING_KEY = 'settings/billing.json';
export const PASS_DAYS = 90;
/** Days of grace after a subscription period ends, while Stripe retries a failed renewal. */
const GRACE_DAYS = 3;
/** How old a webhook may be, in seconds. */
const TOLERANCE = 300;
export const PLAN_LABELS = { monthly: '$15 a month', pass: '$35 for 3 months' } as const;
export type BillingPlan = keyof typeof PLAN_LABELS;

const AccountSchema = v.object({
  until: v.string(),
  plan: v.picklist(['monthly', 'pass']),
  customer: v.optional(v.string()),
  subscription: v.optional(v.string()),
});
const BillingSchema = v.object({ accounts: v.record(v.string(), AccountSchema), events: v.optional(v.array(v.string()), []) });
type Billing = v.InferOutput<typeof BillingSchema>;

export const billingAvailable = (env: AppEnv) =>
  Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_PASS);

export async function readBilling(bucket: Bucket): Promise<Billing> {
  const object = await bucket.get(BILLING_KEY);
  return (object && checkedDocument(BillingSchema, await object.json().catch(() => null), BILLING_KEY)) ?? { accounts: {}, events: [] };
}
const writeBilling = (bucket: Bucket, billing: Billing) => bucket.put(BILLING_KEY, JSON.stringify(billing));

/** Accounts paid for through Stripe and still within their paid time. */
export async function billedEmails(bucket: Bucket, now = new Date()) {
  const { accounts } = await readBilling(bucket);
  return Object.entries(accounts)
    .filter(([, account]) => Date.parse(account.until) > now.getTime())
    .map(([email]) => email);
}

/** One account's billing, for its Profile page. */
export async function billingFor(env: AppEnv, bucket: Bucket, email: string, now = new Date()) {
  const account = (await readBilling(bucket)).accounts[email.toLowerCase()];
  const active = account && Date.parse(account.until) > now.getTime();
  return {
    available: billingAvailable(env),
    plans: PLAN_LABELS,
    ...(active ? { plan: account.plan, until: account.until, manage: Boolean(account.customer) } : {}),
  };
}

async function stripe(env: AppEnv, fetcher: FetchTransport, path: string, form: Record<string, string>) {
  const response = await fetcher(STRIPE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(data) || typeof data.url !== 'string') {
    log.error('stripe_request_failed', new Error(`Stripe ${path} returned HTTP ${response.status}`));
    throw new Error('Payments are unavailable right now. Try again shortly.');
  }
  return data.url;
}

/** A Stripe Checkout page for one plan; the account is identified by its email. */
export async function checkoutUrl(env: AppEnv, email: string, plan: BillingPlan, origin: string, fetcher: FetchTransport) {
  if (!billingAvailable(env)) throw new SearchInputError('Payments are not set up yet. Ask an admin to upgrade your account.');
  const account = email.toLowerCase();
  return stripe(env, fetcher, 'checkout/sessions', {
    mode: plan === 'monthly' ? 'subscription' : 'payment',
    'line_items[0][price]': (plan === 'monthly' ? env.STRIPE_PRICE_MONTHLY : env.STRIPE_PRICE_PASS)!,
    'line_items[0][quantity]': '1',
    customer_email: account,
    client_reference_id: account,
    'metadata[plan]': plan,
    allow_promotion_codes: 'true',
    success_url: `${origin}/#more`,
    cancel_url: `${origin}/#more`,
  });
}

/** Stripe's billing portal for a subscriber: change the card, see invoices, cancel. */
export async function portalUrl(env: AppEnv, bucket: Bucket, email: string, origin: string, fetcher: FetchTransport) {
  const customer = (await readBilling(bucket)).accounts[email.toLowerCase()]?.customer;
  if (!billingAvailable(env) || !customer) throw new SearchInputError('There is no subscription to manage.');
  return stripe(env, fetcher, 'billing_portal/sessions', { customer, return_url: `${origin}/#more` });
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Whether a webhook's Stripe-Signature header is Stripe's, for this body, and recent. */
export async function verifyStripeSignature(secret: string, body: string, header: string | null, now = new Date()) {
  const parts = (header ?? '').split(',').map((part) => part.split('=', 2) as [string, string]);
  const timestamp = Number(parts.find(([name]) => name === 't')?.[1]);
  const signatures = parts.filter(([name]) => name === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || !signatures.length || Math.abs(now.getTime() / 1000 - timestamp) > TOLERANCE) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
  // Compared in full so the time taken does not reveal how much matched.
  return signatures.some((signature) => {
    if (signature.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index++) difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
    return difference === 0;
  });
}

const days = (count: number) => count * 86_400_000;
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** Records what a verified Stripe event means for an account. Returns what it did. */
export async function applyStripeEvent(bucket: Bucket, event: unknown, now = new Date()) {
  if (!isRecord(event) || !isRecord(event.data) || !isRecord(event.data.object) || typeof event.type !== 'string') return 'ignored';
  const billing = await readBilling(bucket);
  const id = text(event.id);
  if (id && billing.events.includes(id)) return 'duplicate';
  const object = event.data.object;
  const byCustomer = (customer: unknown) => Object.entries(billing.accounts).find(([, account]) => account.customer === customer);
  let result = 'ignored';
  if (event.type === 'checkout.session.completed' && object.payment_status === 'paid') {
    const email = text(object.client_reference_id)?.toLowerCase();
    const plan = isRecord(object.metadata) && object.metadata.plan === 'monthly' ? 'monthly' : 'pass';
    if (email) {
      const current = billing.accounts[email];
      const from = Math.max(now.getTime(), current ? Date.parse(current.until) : 0);
      billing.accounts[email] = {
        plan,
        until: new Date(plan === 'pass' ? from + days(PASS_DAYS) : now.getTime() + days(31 + GRACE_DAYS)).toISOString(),
        ...((text(object.customer) ?? current?.customer) ? { customer: text(object.customer) ?? current?.customer } : {}),
        ...(text(object.subscription) ? { subscription: text(object.subscription) } : {}),
      };
      result = 'paid';
    }
  } else if (event.type === 'invoice.paid') {
    const found = byCustomer(object.customer);
    const lines = isRecord(object.lines) && Array.isArray(object.lines.data) ? object.lines.data : [];
    const end = lines.map((line) => (isRecord(line) && isRecord(line.period) ? Number(line.period.end) : NaN)).find(Number.isFinite);
    if (found && end) {
      found[1].until = new Date(end * 1000 + days(GRACE_DAYS)).toISOString();
      result = 'renewed';
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const found = byCustomer(object.customer);
    if (found) {
      found[1].until = now.toISOString();
      result = 'ended';
    }
  }
  if (id) billing.events = [...billing.events, id].slice(-200);
  await writeBilling(bucket, billing);
  return result;
}

/** The webhook Stripe calls: a verified event is recorded; anything else is refused. */
export async function stripeWebhook(env: AppEnv, bucket: Bucket, request: Request, now = new Date()) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Payments are not set up.', { status: 404 });
  const body = await request.text();
  if (
    body.length > 256 * 1024 ||
    !(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, body, request.headers.get('Stripe-Signature'), now))
  )
    return new Response('Invalid signature.', { status: 400 });
  const result = await applyStripeEvent(bucket, JSON.parse(body), now);
  log.info('stripe_event', { result });
  return Response.json({ received: true, result });
}
