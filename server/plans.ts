/**
 * Free and paid accounts. Everyone signed in can search and save listings; email alerts are for paid accounts.
 * Admins are always paid, and so is the app's own token or a public app. An admin marks other accounts paid on
 * the Profile page; the list is kept in storage. The PAID_EMAILS secret (comma-separated) can list more.
 */
import * as v from 'valibot';
import type { AppEnv, Bucket } from './contracts.ts';
import { addresses, adminEmails } from './roles.ts';
import { checkedDocument } from './storage/stored-documents.ts';
import { billedEmails } from './billing.ts';

export type Plan = 'free' | 'paid';
const PLANS_KEY = 'settings/plans.json';
const PlansSchema = v.object({ paid: v.array(v.string()) });

export async function readPaidList(bucket: Bucket): Promise<string[]> {
  const object = await bucket.get(PLANS_KEY);
  return (object && checkedDocument(PlansSchema, await object.json().catch(() => null), PLANS_KEY)?.paid) ?? [];
}

/** Every address on the paid plan: admins, PAID_EMAILS, accounts an admin marked paid, and paid-up subscribers. */
export async function paidEmails(env: AppEnv, bucket: Bucket, now = new Date()) {
  return new Set([
    ...adminEmails(env),
    ...addresses(env.PAID_EMAILS),
    ...(await readPaidList(bucket)),
    ...(await billedEmails(bucket, now)),
  ]);
}

/** The caller's plan. No account means the app's own token or a public app, which have every feature. */
export async function planFor(env: AppEnv, bucket: Bucket, account: string | null | undefined, admin?: boolean): Promise<Plan> {
  if (!account || admin || env.PUBLIC_APP === 'true') return 'paid';
  return (await paidEmails(env, bucket)).has(account.toLowerCase()) ? 'paid' : 'free';
}

/** Puts an account on the paid plan or back on the free one. */
export async function setPaid(bucket: Bucket, email: string, paid: boolean) {
  const address = email.trim().toLowerCase();
  const list = (await readPaidList(bucket)).filter((item) => item !== address);
  const next = paid ? [...list, address].sort() : list;
  await bucket.put(PLANS_KEY, JSON.stringify({ paid: next }));
  return next;
}

/** The accounts an admin can see on the Profile page: everyone allowed to sign in, and anyone marked paid. */
export async function members(env: AppEnv, bucket: Bucket) {
  const admins = new Set(adminEmails(env));
  const paid = await paidEmails(env, bucket);
  const everyone = [...new Set([...addresses(env.ACCESS_ALLOWED_EMAILS), ...paid])].sort();
  return everyone.map((email) => ({ email, admin: admins.has(email), paid: paid.has(email) }));
}
