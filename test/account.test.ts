import { expect, test } from 'bun:test';
import { addRule, addDevice, readDevices, readRules } from '../server/alerts.ts';
import { applyStripeEvent } from '../server/billing.ts';
import { changeHousehold, findHousehold } from '../server/households.ts';
import { readPaidList, setPaid } from '../server/plans.ts';
import { readSaved, writeSaved } from '../server/saved.ts';
import { handleApi } from './fixtures/api.ts';
import { fakeD1 } from './fixtures/fake-d1.ts';
import { readJson } from './fixtures/json.ts';
import { testListing } from './fixtures/listing.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const ME = 'renter@example.test';
const rule = { name: 'Brooklyn 1BR', filters: { region: 'brooklyn', bedrooms: 1, maxRent: 3500 } };
const request = (path: string, body?: unknown) =>
  new Request(
    'https://app.test/api/' + path,
    body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
  );

async function phone() {
  const { toBase64Url } = await import('../src/base64url.ts');
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return {
    endpoint: 'https://web.push.apple.com/device-' + crypto.randomUUID(),
    keys: {
      p256dh: toBase64Url(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)),
      auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

async function setUp() {
  const bucket = createMemoryBucket();
  const { d1 } = await fakeD1();
  const at = new Date().toISOString();
  const user = 'INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES (?1,?2,?2,1,?3,?3)';
  await d1.batch([
    d1.prepare(user).bind('u1', ME, at),
    d1.prepare(user).bind('u2', 'other@example.test', at),
    d1
      .prepare('INSERT INTO "session" ("id","expiresAt","token","createdAt","updatedAt","userId") VALUES (?1,?2,?3,?2,?2,?4)')
      .bind('s1', at, 't1', 'u1'),
  ]);
  await writeSaved(bucket, ME, [testListing({ id: 'a' })]);
  await addRule(bucket, rule, async () => [], new Date(), ME);
  await addRule(bucket, rule, async () => [], new Date(), 'other@example.test');
  await addDevice(bucket, await phone(), 'Phone', new Date(), ME);
  await changeHousehold(bucket, 'other@example.test', { action: 'invite', email: ME });
  await changeHousehold(bucket, ME, { action: 'accept' });
  await setPaid(bucket, ME, true);
  return { bucket, d1, env: { BUCKET: bucket } };
}

test('an account downloads everything kept for it', async () => {
  const { env } = await setUp();
  const response = await handleApi(request('account'), env, { account: ME });
  expect(response.headers.get('content-disposition')).toContain('walkup-account.json');
  const data = await readJson<{
    account: string;
    plan: string;
    savedListings: unknown[];
    alerts: { rules: unknown[] };
    sharedList: object;
  }>(response);
  expect(data).toMatchObject({ account: ME, plan: 'paid', billing: null });
  expect(data.savedListings.length).toBe(1);
  expect(data.alerts.rules.length).toBe(1);
  expect(data.sharedList).toMatchObject({ members: ['other@example.test', ME] });
  expect((await handleApi(request('account'), env)).status).toBe(404);
});

test('deleting an account removes its data and its sign-in, and leaves everyone else’s', async () => {
  const { bucket, d1, env } = await setUp();
  expect((await handleApi(request('account', { action: 'delete' }), env, { account: ME, database: d1 })).status, 'no confirmation').toBe(
    422,
  );
  const deleted = await handleApi(request('account', { action: 'delete', confirm: 'DELETE' }), env, { account: ME, database: d1 });
  expect(await readJson(deleted)).toEqual({ deleted: true });
  expect(await readSaved(bucket, ME)).toEqual([]);
  expect((await readRules(bucket)).map(({ owner }) => owner)).toEqual(['other@example.test']);
  expect(await readDevices(bucket)).toEqual([]);
  expect(await findHousehold(bucket, ME)).toBeNull();
  expect((await findHousehold(bucket, 'other@example.test'))?.members).toEqual(['other@example.test']);
  expect(await readPaidList(bucket)).toEqual([]);
  const users = await d1.prepare('SELECT "email" FROM "user"').all<{ email: string }>();
  expect(users.results.map(({ email }) => email)).toEqual(['other@example.test']);
  expect((await d1.prepare('SELECT * FROM "session"').all()).results).toEqual([]);
  // Without a database, a second delete has nothing left to remove.
  expect((await handleApi(request('account', { action: 'delete', confirm: 'DELETE' }), env, { account: ME })).status).toBe(200);
  expect((await handleApi(request('account', { action: 'delete', confirm: 'DELETE' }), env)).status).toBe(404);
});

test('a running subscription must be cancelled before deleting the account', async () => {
  const bucket = createMemoryBucket();
  await applyStripeEvent(bucket, {
    id: 'evt',
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', client_reference_id: ME, metadata: { plan: 'monthly' }, customer: 'cus' } },
  });
  const refused = await handleApi(request('account', { action: 'delete', confirm: 'DELETE' }), { BUCKET: bucket }, { account: ME });
  expect(refused.status).toBe(422);
  expect((await readJson<{ error: string }>(refused)).error).toMatch(/Cancel your subscription first/);
});

test('the admin dashboard counts members, payments, alerts, data and runs', async () => {
  const { bucket, d1, env } = await setUp();
  await applyStripeEvent(bucket, {
    id: 'e1',
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', client_reference_id: 'sub@example.test', metadata: { plan: 'monthly' } } },
  });
  await applyStripeEvent(bucket, {
    id: 'e2',
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', client_reference_id: 'pass@example.test', metadata: { plan: 'pass' } } },
  });
  await bucket.put('buildings/stabilized.json', JSON.stringify({ checkedAt: '2026-11-01T00:00:00Z', buildings: { a: 1, b: 2 } }));
  await bucket.put('transit/stations.json', 'not json');
  const stats = await readJson<Record<string, Record<string, unknown>>>(
    handleApi(
      request('admin/stats'),
      { ...env, ACCESS_ALLOWED_EMAILS: `owner@example.test,${ME},free@example.test` },
      { admin: true, database: d1 },
    ),
  );
  expect(stats.members).toEqual({ total: 5, paid: 4, free: 1 });
  expect(stats.payments).toEqual({ monthly: 1, passes: 1, estimatedMonthlyRevenue: 27 });
  expect(stats.alerts).toEqual({ rules: 2, accounts: 2, devices: 1, sentThisWeek: 0 });
  expect(stats.data).toEqual({
    stabilizedBuildings: { checkedAt: '2026-11-01T00:00:00Z', count: 2 },
    subwayStations: { checkedAt: null, count: 0 },
    buildingsChecked: 0,
  });
  expect(stats.sources).toMatchObject({ total: 0, failed: [] });
  expect(stats.runs).toEqual({ nightly: null, daytime: null });
  expect(stats.funnel).toMatchObject({ days: 30, signups: 2 });
  expect((await handleApi(request('admin/stats'), env, { admin: false })).status).toBe(403);
});

test('the dashboard names failing sources and counts this week’s alerts', async () => {
  const bucket = createMemoryBucket();
  await bucket.put(
    'rentals/refresh.json',
    JSON.stringify({
      lastCheckedAt: '2026-11-24T00:00:00Z',
      sources: [
        { id: 'zillow-live', name: 'Zillow', status: 'failed', checkedAt: '2026-11-24T00:00:00Z', updatedAt: null },
        { id: 'tfc-live', name: 'TF Cornerstone', status: 'updated', checkedAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z' },
      ],
    }),
  );
  await bucket.put(
    'alerts/recent.json',
    JSON.stringify([
      { id: 'a', at: new Date().toISOString(), ruleId: 'r', title: 't', lines: [], newCount: 1, dropCount: 0 },
      { id: 'b', at: '2020-01-01T00:00:00Z', ruleId: 'r', title: 't', lines: [], newCount: 1, dropCount: 0 },
    ]),
  );
  const stats = await readJson<{ sources: { failed: string[] }; alerts: { sentThisWeek: number } }>(
    handleApi(request('admin/stats'), { BUCKET: bucket }, { admin: true }),
  );
  expect(stats.sources.failed).toEqual(['Zillow']);
  expect(stats.alerts.sentThisWeek).toBe(1);
});
