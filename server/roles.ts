/**
 * Who may run the platform. Everyone signed in can search, save listings and keep their own alerts; an admin
 * can also resync sources and turn the nightly resync on or off. Admins are the addresses in the ADMIN_EMAILS
 * secret (comma-separated), or, when it is not set, the first address allowed to sign in (ACCESS_ALLOWED_EMAILS).
 * Scripts that send the app access token act as an admin.
 */
import type { AppEnv } from './contracts.ts';

export const addresses = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);

export function adminEmails(env: Pick<AppEnv, 'ADMIN_EMAILS' | 'ACCESS_ALLOWED_EMAILS'>) {
  const admins = addresses(env.ADMIN_EMAILS);
  return admins.length ? admins : addresses(env.ACCESS_ALLOWED_EMAILS).slice(0, 1);
}

/** Whether this caller is an admin: the app access token, a local open app, or an admin's signed-in email. */
export function isAdmin(
  env: Pick<AppEnv, 'ADMIN_EMAILS' | 'ACCESS_ALLOWED_EMAILS' | 'PUBLIC_APP'>,
  { account, token }: { account: string | null | undefined; token: boolean },
) {
  if (token || env.PUBLIC_APP === 'true') return true;
  return Boolean(account) && adminEmails(env).includes(String(account).toLowerCase());
}
