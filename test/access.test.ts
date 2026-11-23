import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { accessSettings, verifyAccessToken } from '../server/access.ts';
import { encode, team } from './fixtures/access-team.ts';

test('settings need a Cloudflare Access team domain, an audience and at least one allowed email', () => {
  assert.equal(accessSettings({}), null);
  assert.equal(accessSettings({ ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'aud' }), null, 'no allowed emails');
  assert.equal(accessSettings({ ACCESS_TEAM_DOMAIN: 'https://evil.example', ACCESS_AUD: 'aud', ACCESS_ALLOWED_EMAILS: 'a@example.com' }), null);
  assert.deepEqual(accessSettings({ ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/', ACCESS_AUD: 'aud', ACCESS_ALLOWED_EMAILS: ' A@example.com ,' }),
    { issuer: 'https://team.cloudflareaccess.com', audience: 'aud', emails: ['a@example.com'] });
});

test('a token signed by the team, for this application and an allowed email, signs in', async () => {
  const { settings, now, claims, sign, fetcher, keyRequests } = await team('team-valid');
  assert.equal(await verifyAccessToken(await sign(claims), settings, { fetcher, now }), 'owner@example.com');
  assert.equal(await verifyAccessToken(await sign({ ...claims, aud: 'app-audience', email: 'SECOND@example.com' }), settings, { fetcher, now }), 'second@example.com');
  assert.equal(keyRequests(), 1, 'signing keys are cached');
});

test('tokens for another app, issuer, person or time, or with a bad signature, are refused', async () => {
  const { settings, now, claims, sign, fetcher } = await team('team-refused');
  const refused = async (token: string | null) => assert.equal(await verifyAccessToken(token, settings, { fetcher, now }), null, String(token).slice(0, 40));
  await refused(null);
  await refused('not-a-token');
  await refused('a.b.c.d');
  await refused('x'.repeat(13_000));
  await refused('!!!.###.$$$');
  await refused(await sign({ ...claims, aud: ['another-app'] }));
  await refused(await sign({ ...claims, iss: 'https://other.cloudflareaccess.com' }));
  await refused(await sign({ ...claims, email: 'stranger@example.com' }));
  await refused(await sign({ ...claims, email: undefined, common_name: 'service-token' }));
  await refused(await sign({ ...claims, exp: now / 1000 - 120 }));
  await refused(await sign({ ...claims, exp: undefined }));
  await refused(await sign({ ...claims, nbf: now / 1000 + 600 }));
  await refused(await sign(claims, { alg: 'none', kid: 'key-1' }));
  await refused(await sign(claims, { alg: 'RS256' }));
  const [head, , signature] = (await sign(claims)).split('.');
  await refused([head, encode(JSON.stringify({ ...claims, email: 'second@example.com' })), signature].join('.'));
  await refused([head, encode(JSON.stringify(claims)), 'AAAA'].join('.'));
});

test('an unknown signing key refetches the keys at most once a minute, and a key outage signs no one in', async () => {
  const { settings, now, claims, sign, fetcher, keyRequests } = await team('team-rotation');
  const unknown = await sign(claims, { alg: 'RS256', kid: 'rotated-away' });
  assert.equal(await verifyAccessToken(unknown, settings, { fetcher, now }), null);
  assert.equal(await verifyAccessToken(unknown, settings, { fetcher, now: now + 30_000 }), null);
  assert.equal(keyRequests(), 1, 'a forged key ID cannot make every request fetch keys');
  assert.equal(await verifyAccessToken(unknown, settings, { fetcher, now: now + 61_000 }), null);
  assert.equal(keyRequests(), 2);
  assert.equal(await verifyAccessToken(await sign(claims), settings, { fetcher, now: now + 62_000 }), 'owner@example.com');

  const down = await team('team-down');
  await assert.rejects(verifyAccessToken(await down.sign(down.claims), down.settings, { fetcher: async () => new Response('busy', { status: 503 }), now: down.now }), /HTTP 503/);
  await assert.rejects(verifyAccessToken(await down.sign(down.claims), down.settings, { fetcher: async () => Response.json({}), now: down.now }), /no signing keys/);
});
