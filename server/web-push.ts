/**
 * Web Push (the standard behind notifications on iPhone Home Screen apps, Android and desktop browsers),
 * with WebCrypto only: VAPID identifies this server to the push service (RFC 8292), and the message is
 * encrypted for the device (RFC 8291, aes128gcm), so the push service cannot read it.
 */
import * as v from 'valibot';
import { fromBase64Url, toBase64Url } from '../src/base64url.ts';

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };
type Bytes = Uint8Array<ArrayBuffer>;
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Bytes {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Push services this server will deliver to; a subscription naming any other host is refused. */
const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'notify.windows.com'];

const pushService = (endpoint: string) => {
  if (!URL.canParse(endpoint)) return false;
  const { protocol, hostname } = new URL(endpoint);
  return protocol === 'https:' && PUSH_HOSTS.some((host) => hostname === host || hostname.endsWith('.' + host));
};
/** A base64url key that decodes to this many bytes. */
const key = (bytes: number) => v.pipe(v.string(), v.check((value) => {
  try { return fromBase64Url(value).length === bytes; } catch { return false; }
}));

/** A browser's push subscription (PushSubscription.toJSON()), for a known push service. */
const PushSubscriptionInput = v.object({
  endpoint: v.pipe(v.string(), v.maxLength(1024), v.url(), v.check(pushService)),
  keys: v.object({ p256dh: key(65), auth: key(16) }),
});

export const validSubscription = (value: unknown): value is PushSubscriptionJson => v.is(PushSubscriptionInput, value);

/** A new VAPID key pair: the public key for clients and the private scalar for the server's secret. */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  return { publicKey: toBase64Url(publicKey), privateKey: d! };
}

async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now: number) {
  const publicKey = fromBase64Url(vapid.publicKey);
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: vapid.privateKey, ext: true,
    x: toBase64Url(publicKey.slice(1, 33)), y: toBase64Url(publicKey.slice(33, 65)),
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: vapid.subject,
  })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(header + '.' + claims)));
  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${vapid.publicKey}`;
}

async function hkdf(salt: Bytes, secret: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** The aes128gcm body for one device: a single record holding the payload. */
export async function encryptPayload(subscription: PushSubscriptionJson, payload: Bytes,
  { salt = crypto.getRandomValues(new Uint8Array(16)), serverKeys }: { salt?: Bytes; serverKeys?: CryptoKeyPair } = {}) {
  const clientPublic = fromBase64Url(subscription.keys.p256dh);
  const auth = fromBase64Url(subscription.keys.auth);
  const local = serverKeys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey) as ArrayBuffer);
  const clientKey = await crypto.subtle.importKey('raw', clientPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(encoder.encode('WebPush: info\0'), clientPublic, localPublic), 32);
  const contentKey = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (and only) record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([localPublic.length]), localPublic, sealed);
}

/** Sends one notification. `gone` means the device unsubscribed, so the subscription should be dropped. */
export async function sendPush(subscription: PushSubscriptionJson, message: unknown, vapid: VapidKeys,
  { fetcher = (url: string, init: RequestInit) => fetch(url, init), now = Date.now() }: { fetcher?: (url: string, init: RequestInit) => Promise<Response>; now?: number } = {}) {
  const body = await encryptPayload(subscription, encoder.encode(JSON.stringify(message)));
  const response = await fetcher(subscription.endpoint, {
    method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: await vapidAuthorization(subscription.endpoint, vapid, now), 'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream', TTL: String(24 * 60 * 60), Urgency: 'normal' },
  });
  return { ok: response.ok, gone: response.status === 404 || response.status === 410, status: response.status };
}
