import { expect, test } from 'bun:test';
import { addRule, checkAlerts, readRules } from '../server/alerts.ts';
import { members, planFor, readPaidList, setPaid } from '../server/plans.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { testListing } from './fixtures/listing.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const env = { ACCESS_ALLOWED_EMAILS: 'owner@example.test, renter@example.test, friend@example.test', PAID_EMAILS: 'friend@example.test' };
const rule = { name: 'Brooklyn 1BR', filters: { region: 'brooklyn', bedrooms: 1, maxRent: 3500 } };
const post = (path: string, body: unknown) =>
  new Request('https://app.test/api/' + path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

test('admins, PAID_EMAILS and accounts an admin marks paid are on the paid plan; everyone else is free', async () => {
  const bucket = createMemoryBucket();
  expect(await planFor(env, bucket, 'owner@example.test')).toBe('paid');
  expect(await planFor(env, bucket, 'Friend@example.test')).toBe('paid');
  expect(await planFor(env, bucket, 'renter@example.test')).toBe('free');
  expect(await planFor(env, bucket, 'renter@example.test', true), 'an admin').toBe('paid');
  expect(await planFor(env, bucket, null), 'the app token').toBe('paid');
  expect(await planFor({ ...env, PUBLIC_APP: 'true' }, bucket, 'renter@example.test')).toBe('paid');
  await setPaid(bucket, ' Renter@example.test ', true);
  await setPaid(bucket, 'renter@example.test', true);
  expect(await readPaidList(bucket)).toStrictEqual(['renter@example.test']);
  expect(await planFor(env, bucket, 'renter@example.test')).toBe('paid');
  await setPaid(bucket, 'renter@example.test', false);
  expect(await planFor(env, bucket, 'renter@example.test')).toBe('free');
  await bucket.put('settings/plans.json', '{"paid":"nope"}');
  expect(await readPaidList(bucket), 'an unreadable list reads as nobody').toStrictEqual([]);
  expect(await members(env, bucket)).toStrictEqual([
    { email: 'friend@example.test', admin: false, paid: true },
    { email: 'owner@example.test', admin: true, paid: true },
    { email: 'renter@example.test', admin: false, paid: false },
  ]);
});

test('a free account cannot set alerts, and an admin upgrades it', async () => {
  const bucket = createMemoryBucket();
  const appEnv = { ...env, BUCKET: bucket };
  const renter = { account: 'renter@example.test', admin: false };
  const admin = { account: 'owner@example.test', admin: true };
  const state = await readJson<{ plan: string }>(handleApi(new Request('https://app.test/api/alerts'), appEnv, renter));
  expect(state.plan).toBe('free');
  const refused = await handleApi(post('alerts', { action: 'add-rule', rule }), appEnv, renter);
  expect(refused.status).toBe(402);
  expect((await readJson<{ error: string }>(refused)).error).toMatch(/paid plan/);
  expect((await handleApi(post('alerts', { action: 'test' }), appEnv, renter)).status).toBe(402);
  // Removing what it set up before is still allowed.
  expect((await handleApi(post('alerts', { action: 'delete-rule', id: 'x' }), appEnv, renter)).status).toBe(200);

  // Only an admin sees accounts and changes plans.
  expect((await handleApi(new Request('https://app.test/api/members'), appEnv, renter)).status).toBe(403);
  expect((await handleApi(post('members', { email: 'renter@example.test', paid: true }), appEnv, renter)).status).toBe(403);
  expect((await handleApi(post('members', { email: 'not an email', paid: true }), appEnv, admin)).status).toBe(422);
  const listed = await readJson<{ members: { email: string }[] }>(handleApi(new Request('https://app.test/api/members'), appEnv, admin));
  expect(listed.members.length).toBe(3);
  const upgraded = await readJson<{ members: { email: string; paid: boolean }[] }>(
    handleApi(post('members', { email: 'renter@example.test', paid: true }), appEnv, admin),
  );
  expect(upgraded.members.find(({ email }) => email === 'renter@example.test')?.paid).toBe(true);
  const added = await handleApi(post('alerts', { action: 'add-rule', rule }), appEnv, renter);
  expect(added.status).toBe(200);
  expect((await readJson<{ plan: string }>(added)).plan).toBe('paid');

  // The config tells the app its plan.
  const config = await readJson<{ plan: string }>(handleApi(new Request('https://app.test/api/config'), appEnv, renter));
  expect(config.plan).toBe('paid');
});

test('alerts of an account that went back to free are skipped', async () => {
  const bucket = createMemoryBucket();
  const inventory = [testListing({ id: 'a', rent: 2000 })];
  const load = async () => inventory;
  await addRule(bucket, rule, load, new Date(), 'renter@example.test');
  await addRule(bucket, rule, load, new Date(), 'friend@example.test');
  await addRule(bucket, rule, load);
  expect((await readRules(bucket)).length).toBe(3);
  let checked = 0;
  await checkAlerts(
    bucket,
    async () => {
      checked++;
      return inventory;
    },
    {},
    { origin: '', paid: new Set(['friend@example.test']) },
  );
  expect(checked, 'the paid account’s alert and the older shared one').toBe(2);
});
