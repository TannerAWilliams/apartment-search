import assert from 'node:assert/strict';
import { accessSettings } from '../../server/access.ts';
import { checkWorkersFetchInit } from './workers-fetch.ts';

const encoder = new TextEncoder();
export const encode = (value: Uint8Array | string) =>
  btoa(String.fromCharCode(...(typeof value === 'string' ? encoder.encode(value) : value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** A synthetic Access team: its own RSA key, published keys, and a token signer. */
export async function team(name: string) {
  const issuer = `https://${name}.cloudflareaccess.com`;
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'key-1' };
  let keyRequests = 0;
  const fetcher = async (url: string, init?: RequestInit) => {
    checkWorkersFetchInit(init);
    assert.equal(url, issuer + '/cdn-cgi/access/certs');
    keyRequests++;
    return Response.json({ keys: [jwk] });
  };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'key-1' }) => {
    const unsigned = encode(JSON.stringify(header)) + '.' + encode(JSON.stringify(claims));
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(unsigned)));
    return unsigned + '.' + encode(signature);
  };
  const settings = accessSettings({ ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'app-audience', ACCESS_ALLOWED_EMAILS: 'Owner@Example.com, second@example.com' })!;
  const now = Date.parse('2026-11-23T12:00:00Z');
  const claims = { iss: issuer, aud: ['app-audience'], email: 'owner@example.com', exp: now / 1000 + 600, nbf: now / 1000 - 10 };
  return { issuer, settings, now, claims, sign, fetcher, keyRequests: () => keyRequests };
}
