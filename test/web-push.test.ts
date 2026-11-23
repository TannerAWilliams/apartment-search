import { test } from 'bun:test';
import assert from 'node:assert/strict';
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
    assert.equal(plain.at(-1), 2, 'last-record delimiter');
    return new TextDecoder().decode(plain.slice(0, -1));
  }
  return { subscription, decrypt };
}

test('only HTTPS subscriptions on known push services with well-formed keys are accepted', async () => {
  const { subscription } = await device();
  assert.equal(validSubscription(subscription), true);
  assert.equal(validSubscription({ ...subscription, endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }), true);
  assert.equal(validSubscription({ ...subscription, endpoint: 'https://example.com/push' }), false);
  assert.equal(validSubscription({ ...subscription, endpoint: 'not a url' }), false);
  assert.equal(validSubscription({ ...subscription, endpoint: 'http://web.push.apple.com/x' }), false);
  assert.equal(validSubscription({ ...subscription, endpoint: 'https://evil-web.push.apple.com.example/x' }), false);
  assert.equal(validSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'AAAA' } }), false);
  assert.equal(validSubscription(null), false);
});

test('a message is encrypted so that only the subscribed device can read it', async () => {
  const { subscription, decrypt } = await device();
  const body = await encryptPayload(subscription, encoder.encode('{"title":"3 new apartments"}'));
  assert.equal(new DataView(body.buffer).getUint32(16), 4096, 'record size');
  assert.equal(await decrypt(body), '{"title":"3 new apartments"}');
  const other = await device();
  await assert.rejects(other.decrypt(body));
});

test('delivery is signed with the VAPID key for the push service, and an expired device is reported', async () => {
  const vapid = { ...await generateVapidKeys(), subject: 'https://apartments.example' };
  const { subscription, decrypt } = await device();
  const now = Date.parse('2026-11-23T12:00:00Z');
  let request: { url: string; init: RequestInit } | null = null;
  const result = await sendPush(subscription, { title: 'Hello' }, vapid, { now, fetcher: async (url, init) => { request = { url, init }; return new Response(null, { status: 201 }); } });
  assert.deepEqual(result, { ok: true, gone: false, status: 201 });
  const { url, init } = request!;
  assert.equal(url, subscription.endpoint);
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['Content-Encoding'], 'aes128gcm');
  assert.equal(sentJson<{ title: string }>(await decrypt(init.body as Uint8Array<ArrayBuffer>)).title, 'Hello');
  const [, jwt, key] = headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assert.equal(key, vapid.publicKey);
  const [head, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64Url(claims))), { aud: 'https://web.push.apple.com', exp: now / 1000 + 43200, sub: 'https://apartments.example' });
  const verifier = await crypto.subtle.importKey('raw', fromBase64Url(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, fromBase64Url(signature), encoder.encode(head + '.' + claims)), true);

  const gone = await sendPush(subscription, {}, vapid, { fetcher: async () => new Response(null, { status: 410 }) });
  assert.deepEqual(gone, { ok: false, gone: true, status: 410 });
});
