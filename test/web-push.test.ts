import { expect, test } from 'bun:test';
import { fromBase64Url, toBase64Url } from '../src/base64url.ts';
import { encryptPayload, generateVapidKeys, sendPush, validSubscription } from '../server/web-push.ts';
import { sentJson } from './fixtures/json.ts';

const encoder = new TextEncoder();
/** A browser's side of a subscription: its key pair and auth secret, plus RFC 8291 decryption. */
async function device(endpoint = 'https://web.push.apple.com/QGf9example') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const subscription = { endpoint, keys: { p256dh: toBase64Url(publicKey), auth: toBase64Url(auth) } };
  const hkdf = async (salt: Uint8Array<ArrayBuffer>, secret: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']), bytes * 8));
  async function decrypt(body: Uint8Array<ArrayBuffer>) {
    const salt = body.slice(0, 16);
    const keyLength = body[20];
    const serverPublic = body.slice(21, 21 + keyLength);
    const serverKey = await crypto.subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, pair.privateKey, 256));
    const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...publicKey, ...serverPublic]);
    const ikm = await hkdf(auth, shared, info, 32);
    const key = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
    const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + keyLength)));
    expect(plain.at(-1), 'last-record delimiter').toBe(2);
    return new TextDecoder().decode(plain.slice(0, -1));
  }
  return { subscription, decrypt };
}

test('only HTTPS subscriptions on known push services with well-formed keys are accepted', async () => {
  const { subscription } = await device();
  expect(validSubscription(subscription)).toBe(true);
  expect(validSubscription({ ...subscription, endpoint: 'https://fcm.googleapis.com/fcm/send/abc' })).toBe(true);
  expect(validSubscription({ ...subscription, endpoint: 'https://example.com/push' })).toBe(false);
  expect(validSubscription({ ...subscription, endpoint: 'not a url' })).toBe(false);
  expect(validSubscription({ ...subscription, endpoint: 'http://web.push.apple.com/x' })).toBe(false);
  expect(validSubscription({ ...subscription, endpoint: 'https://evil-web.push.apple.com.example/x' })).toBe(false);
  expect(validSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'AAAA' } })).toBe(false);
  expect(validSubscription(null)).toBe(false);
});

test('a message is encrypted so that only the subscribed device can read it', async () => {
  const { subscription, decrypt } = await device();
  const body = await encryptPayload(subscription, encoder.encode('{"title":"3 new apartments"}'));
  expect(new DataView(body.buffer).getUint32(16), 'record size').toBe(4096);
  expect(await decrypt(body)).toBe('{"title":"3 new apartments"}');
  const other = await device();
  await expect(other.decrypt(body)).rejects.toThrow();
});

test('delivery is signed with the VAPID key for the push service, and an expired device is reported', async () => {
  const vapid = { ...await generateVapidKeys(), subject: 'https://apartments.example' };
  const { subscription, decrypt } = await device();
  const now = Date.parse('2026-11-23T12:00:00Z');
  let request: { url: string; init: RequestInit } | null = null;
  const result = await sendPush(subscription, { title: 'Hello' }, vapid, { now, fetcher: async (url, init) => { request = { url, init }; return new Response(null, { status: 201 }); } });
  expect(result).toStrictEqual({ ok: true, gone: false, status: 201 });
  const { url, init } = request!;
  expect(url).toBe(subscription.endpoint);
  const headers = init.headers as Record<string, string>;
  expect(headers['Content-Encoding']).toBe('aes128gcm');
  expect(sentJson<{ title: string }>(await decrypt(init.body as Uint8Array<ArrayBuffer>)).title).toBe('Hello');
  const [, jwt, key] = headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/)!;
  expect(key).toBe(vapid.publicKey);
  const [head, claims, signature] = jwt.split('.');
  expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toStrictEqual({ aud: 'https://web.push.apple.com', exp: now / 1000 + 43200, sub: 'https://apartments.example' });
  const verifier = await crypto.subtle.importKey('raw', fromBase64Url(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, fromBase64Url(signature), encoder.encode(head + '.' + claims))).toBe(true);

  const gone = await sendPush(subscription, {}, vapid, { fetcher: async () => new Response(null, { status: 410 }) });
  expect(gone).toStrictEqual({ ok: false, gone: true, status: 410 });
});
