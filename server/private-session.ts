import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-apartment-session';
export function secretsEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function issueSession(secret: string, now = Date.now()) {
  const expires = String(now + 24 * 60 * 60_000);
  return expires + '.' + createHmac('sha256', secret).update('apartment-session:' + expires).digest('base64url');
}
export function validSession(cookie: string, secret: string, now = Date.now()) {
  const value = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
  if (!value || !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [expires, signature] = value.split('.');
  if (Number(expires) <= now || Number(expires) > now + 24 * 60 * 60_000) return false;
  return secretsEqual(signature, createHmac('sha256', secret).update('apartment-session:' + expires).digest('base64url'));
}
