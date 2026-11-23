/**
 * Cloudflare Access sign-in for apartments.5thof6.com. Access signs a JWT for each request it lets through
 * and sends it in Cf-Access-Jwt-Assertion. Workers with Static Assets do not receive ctx.access, so the
 * Worker verifies the token itself: RS256 signature against the team's published keys, issuer, audience,
 * expiry, and an allowlist of emails.
 */
export type AccessSettings = { issuer: string; audience: string; emails: string[] };
type Jwk = JsonWebKey & { kid?: string };
type KeyFetch = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_TOKEN_LENGTH = 12_000;
const KEY_LIFETIME = 60 * 60_000;
/** A token naming an unknown key refetches the keys at most this often, so forged tokens cannot flood Access. */
const REFETCH_INTERVAL = 60_000;
const LEEWAY_SECONDS = 60;

/** The configured Access application, or null when any part is missing, which turns Access sign-in off. */
export function accessSettings(env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; ACCESS_ALLOWED_EMAILS?: string }): AccessSettings | null {
  const emails = (env.ACCESS_ALLOWED_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  const issuer = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !env.ACCESS_AUD || !emails.length) return null;
  return { issuer, audience: env.ACCESS_AUD, emails };
}

const keyCache = new Map<string, { keys: Jwk[]; expires: number; fetchedAt: number }>();

async function signingKey(issuer: string, kid: string, fetcher: KeyFetch, now: number) {
  const cached = keyCache.get(issuer);
  const known = cached && cached.expires > now ? cached.keys.find((key) => key.kid === kid) : undefined;
  if (known || (cached && now - cached.fetchedAt < REFETCH_INTERVAL)) return known;
  // Workers reject redirect: 'error'. 'manual' leaves a redirect unfollowed, and its 3xx status fails the check below.
  const response = await fetcher(issuer + '/cdn-cgi/access/certs', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Cloudflare Access keys returned HTTP ' + response.status + '.');
  const { keys } = await response.json() as { keys?: Jwk[] };
  if (!Array.isArray(keys)) throw new Error('Cloudflare Access returned no signing keys.');
  keyCache.set(issuer, { keys, expires: now + KEY_LIFETIME, fetchedAt: now });
  return keys.find((key) => key.kid === kid);
}

const base64url = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
const json = (value: string) => JSON.parse(new TextDecoder().decode(base64url(value)));

/** The signed-in email when the token is valid for this application and allowed, otherwise null. */
export async function verifyAccessToken(token: string | null, settings: AccessSettings,
  { fetcher = (url, init) => fetch(url, init), now = Date.now() }: { fetcher?: KeyFetch; now?: number } = {}) {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  const [head, body, signature] = parts;
  let header, claims;
  try { header = json(head); claims = json(body); } catch { return null; }
  const seconds = now / 1000;
  const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  const email = typeof claims?.email === 'string' ? claims.email.toLowerCase() : '';
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== settings.issuer || !audiences.includes(settings.audience) ||
      typeof claims.exp !== 'number' || claims.exp + LEEWAY_SECONDS <= seconds ||
      (typeof claims.nbf === 'number' && claims.nbf - LEEWAY_SECONDS > seconds) || !settings.emails.includes(email)) return null;
  const jwk = await signingKey(settings.issuer, header.kid, fetcher, now);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  let valid = false;
  try { valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64url(signature), new TextEncoder().encode(head + '.' + body)); } catch {}
  return valid ? email : null;
}
