/**
 * An account's own data: everything the app keeps for it, to download, and deleting all of it. Deleting removes
 * saved listings, alerts and notification devices, leaves any shared list, clears a manual paid mark and removes
 * the sign-in account with its sessions. A running subscription must be cancelled first, so nobody is charged for
 * an account that no longer exists. What stays on the device (the application kit, tours, notes) is cleared there.
 */
import { SearchInputError } from '../src/search.ts';
import { alertState, forgetAlerts } from './alerts.ts';
import { readBilling } from './billing.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { changeHousehold, findHousehold } from './households.ts';
import { planFor, readPaidList, setPaid } from './plans.ts';
import { readSaved, writeSaved } from './saved.ts';
import type { D1Database } from './storage/d1-bucket.ts';

/** Everything the app keeps for this account, as one JSON document. */
export async function exportAccount(env: AppEnv & { BUCKET: Bucket }, email: string, admin = false, now = new Date()) {
  const account = email.toLowerCase();
  const billing = (await readBilling(env.BUCKET)).accounts[account] ?? null;
  const { channels: _channels, ...alerts } = await alertState(env, account);
  return {
    exportedAt: now.toISOString(),
    account,
    plan: await planFor(env, env.BUCKET, account, admin),
    billing,
    savedListings: await readSaved(env.BUCKET, account),
    alerts,
    sharedList: await findHousehold(env.BUCKET, account),
  };
}

/** Deletes the account and what the server keeps for it. */
export async function deleteAccount(env: AppEnv & { BUCKET: Bucket }, database: D1Database | undefined, email: string, now = new Date()) {
  const account = email.toLowerCase();
  const billing = (await readBilling(env.BUCKET)).accounts[account];
  if (billing?.plan === 'monthly' && Date.parse(billing.until) > now.getTime())
    throw new SearchInputError('Cancel your subscription first (Profile → Manage billing), then delete your account.');
  await writeSaved(env.BUCKET, account, []);
  await forgetAlerts(env.BUCKET, account);
  if (await findHousehold(env.BUCKET, account)) await changeHousehold(env.BUCKET, account, { action: 'leave' });
  if ((await readPaidList(env.BUCKET)).includes(account)) await setPaid(env.BUCKET, account, false);
  if (database) {
    const user = 'SELECT "id" FROM "user" WHERE lower("email") = ?1';
    await database.batch([
      database.prepare(`DELETE FROM "session" WHERE "userId" IN (${user})`).bind(account),
      database.prepare(`DELETE FROM "account" WHERE "userId" IN (${user})`).bind(account),
      database.prepare('DELETE FROM "user" WHERE lower("email") = ?1').bind(account),
    ]);
  }
  return { deleted: true };
}
