import { expect, test } from 'bun:test';
import { accessSettings, verifyAccessToken } from '../server/access.ts';
import { encode, team } from './fixtures/access-team.ts';

test('settings need a Cloudflare Access team domain, an audience and at least one allowed email', () => {
  expect(accessSettings({})).toBeNull();
  expect(accessSettings({ ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'aud' }), 'no allowed emails').toBeNull();
  expect(
    accessSettings({ ACCESS_TEAM_DOMAIN: 'https://evil.example', ACCESS_AUD: 'aud', ACCESS_ALLOWED_EMAILS: 'a@example.com' }),
  ).toBeNull();
  expect(
    accessSettings({
      ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/',
      ACCESS_AUD: 'aud',
      ACCESS_ALLOWED_EMAILS: ' A@example.com ,',
    }),
  ).toStrictEqual({ issuer: 'https://team.cloudflareaccess.com', audience: 'aud', emails: ['a@example.com'] });
});

test('a token signed by the team, for this application and an allowed email, signs in', async () => {
  const { settings, now, claims, sign, fetcher, keyRequests } = await team('team-valid');
  expect(await verifyAccessToken(await sign(claims), settings, { fetcher, now })).toBe('owner@example.com');
  expect(
    await verifyAccessToken(await sign({ ...claims, aud: 'app-audience', email: 'SECOND@example.com' }), settings, { fetcher, now }),
  ).toBe('second@example.com');
  expect(keyRequests(), 'signing keys are cached').toBe(1);
});

test('tokens for another app, issuer, person or time, or with a bad signature, are refused', async () => {
  const { settings, now, claims, sign, fetcher } = await team('team-refused');
  const refused = async (token: string | null) =>
    expect(await verifyAccessToken(token, settings, { fetcher, now }), String(token).slice(0, 40)).toBeNull();
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
  expect(await verifyAccessToken(unknown, settings, { fetcher, now })).toBeNull();
  expect(await verifyAccessToken(unknown, settings, { fetcher, now: now + 30_000 })).toBeNull();
  expect(keyRequests(), 'a forged key ID cannot make every request fetch keys').toBe(1);
  expect(await verifyAccessToken(unknown, settings, { fetcher, now: now + 61_000 })).toBeNull();
  expect(keyRequests()).toBe(2);
  expect(await verifyAccessToken(await sign(claims), settings, { fetcher, now: now + 62_000 })).toBe('owner@example.com');

  const down = await team('team-down');
  await expect(
    verifyAccessToken(await down.sign(down.claims), down.settings, {
      fetcher: async () => new Response('busy', { status: 503 }),
      now: down.now,
    }),
  ).rejects.toThrow(/HTTP 503/);
  await expect(
    verifyAccessToken(await down.sign(down.claims), down.settings, { fetcher: async () => Response.json({}), now: down.now }),
  ).rejects.toThrow(/no signing keys/);
});
