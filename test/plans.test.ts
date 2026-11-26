import { expect, test } from 'bun:test';
import { addRule, checkAlerts, forgetAlerts, readRecent, readRules } from '../server/alerts.ts';
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

test('a free account keeps one alert, by email, and an admin upgrades it', async () => {
  const bucket = createMemoryBucket();
  const appEnv = { ...env, BUCKET: bucket };
  const renter = { account: 'renter@example.test', admin: false };
  const admin = { account: 'owner@example.test', admin: true };
  const state = await readJson<{ plan: string }>(handleApi(new Request('https://app.test/api/alerts'), appEnv, renter));
  expect(state.plan).toBe('free');
  // One alert, and a test of it; a second, and notifications on a phone, are the paid plan's.
  const first = await handleApi(post('alerts', { action: 'add-rule', rule }), appEnv, renter);
  expect(first.status).toBe(200);
  expect((await readJson<{ rules: unknown[]; plan: string }>(first)).rules).toHaveLength(1);
  const second = await handleApi(post('alerts', { action: 'add-rule', rule: { ...rule, name: 'Another' } }), appEnv, renter);
  expect(second.status).toBe(402);
  expect((await readJson<{ error: string }>(second)).error).toMatch(/free account keeps one alert/);
  const phone = await handleApi(post('alerts', { action: 'add-device', subscription: {}, label: 'Phone' }), appEnv, renter);
  expect(phone.status).toBe(402);
  expect((await readJson<{ error: string }>(phone)).error).toMatch(/Notifications on your phone are part of the paid plan/);
  expect((await handleApi(post('alerts', { action: 'test' }), appEnv, renter)).status).toBe(200);
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
  const added = await handleApi(post('alerts', { action: 'add-rule', rule: { ...rule, name: 'Another' } }), appEnv, renter);
  expect(added.status).toBe(200);
  expect(await readJson<{ plan: string; rules: unknown[] }>(added)).toMatchObject({ plan: 'paid', rules: [{}, {}] });

  // The config tells the app its plan.
  const config = await readJson<{ plan: string }>(handleApi(new Request('https://app.test/api/config'), appEnv, renter));
  expect(config.plan).toBe('paid');
});

test('a free account’s alert waits three hours and stops at three a day; a paid account’s goes at once', async () => {
  const bucket = createMemoryBucket();
  /** A listing with a recorded rent, as refreshes save them. */
  const unit = (number: number) =>
    testListing({
      id: 'zumper:' + number,
      address: number + ' Example Street',
      unit: '2A',
      city: 'Brooklyn',
      state: 'NY',
      zip: '11215',
      rent: 2100,
      bedrooms: 1,
      priceIncludesFees: false,
      priceHistory: {
        sourceId: 'zumper-live',
        firstObservedAt: '2026-11-16T00:00:00Z',
        lastObservedAt: '2026-11-16T00:00:00Z',
        truncated: false,
        observations: [{ checkedAt: '2026-11-16T00:00:00Z', rent: 2100, priceIncludesFees: false }],
      },
    });
  const inventory = [unit(1)];
  const load = async () => inventory;
  const start = new Date('2026-11-17T05:10:00Z'); // ten past midnight in New York
  const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000);
  await addRule(bucket, rule, load, start, 'renter@example.test');
  await addRule(bucket, rule, load, start, 'friend@example.test');
  await addRule(bucket, rule, load, start);
  const mail: { to: string[]; text: string; html: string }[] = [];
  const channels = {
    email: { send: async (message: { to: string[]; text: string; html: string }) => void mail.push(message) },
    from: 'alerts@walkup.test',
    to: ['owner@example.test'],
  };
  const paid = new Set(['friend@example.test']);
  let listed = 1;
  /** A new apartment appears, and the alerts are checked. */
  const check = (hours: number, plans = paid, add = true) => {
    if (add) inventory.push(unit(++listed));
    mail.length = 0;
    return checkAlerts(bucket, load, channels, { origin: 'https://walkup.test', now: at(hours), paid: plans });
  };
  const sentTo = () => mail.map(({ to }) => to[0]).toSorted();
  const held = async () => (await (await bucket.get('alerts/held.json'))!.json()) as { waiting: { owner: string }[]; sent: object };

  // Found at 00:10: the paid account and the older shared alert hear at once; the free account's waits.
  const found = await check(0);
  expect(found.alerts.map(({ owner }) => owner)).toEqual(['friend@example.test', undefined]);
  expect(sentTo()).toEqual(['friend@example.test', 'owner@example.test']);
  expect(mail.every(({ text }) => !text.includes('pricing'))).toBe(true);
  expect((await held()).waiting).toHaveLength(1);
  expect(
    (await readRecent(bucket)).some(({ owner }) => owner === 'renter@example.test'),
    'not shown before it is sent',
  ).toBe(false);
  // Two hours on, nothing new: still waiting.
  expect((await check(2, paid, false)).alerts).toEqual([]);
  expect(mail).toEqual([]);
  // Three hours on it is sent, saying what the paid plan changes.
  const released = await check(3, paid, false);
  expect(released.alerts.map(({ owner }) => owner)).toEqual(['renter@example.test']);
  expect(sentTo()).toEqual(['renter@example.test']);
  expect(mail[0]!.text).toContain('Free alerts are sent 3 hours after a match is found, up to 3 a day.');
  expect(mail[0]!.text).toContain('https://walkup.test/pricing');
  expect(mail[0]!.html).toContain('<a href="https://walkup.test/pricing">See pricing</a>');
  expect((await readRecent(bucket)).some(({ owner }) => owner === 'renter@example.test')).toBe(true);

  // Three a day: found at 03:10, 06:10, 09:10 and 12:10, each due three hours later; the fourth of the day is dropped.
  await check(3.1);
  await check(6.2);
  expect(sentTo(), 'the second, with the paid account’s own').toEqual(['friend@example.test', 'owner@example.test', 'renter@example.test']);
  await check(9.3);
  expect(sentTo()).toContain('renter@example.test');
  await check(12.4);
  expect(sentTo(), 'the day’s limit is reached').toEqual(['friend@example.test', 'owner@example.test']);
  expect(await held()).toMatchObject({ sent: { 'renter@example.test': { day: '2026-11-17', count: 3 } } });
  // The next day counts afresh: what was found at 12:10 and still waiting goes out then.
  await check(27, paid, false);
  expect(sentTo()).toEqual(['renter@example.test']);
  expect(await held()).toMatchObject({ waiting: [], sent: { 'renter@example.test': { day: '2026-11-18', count: 1 } } });

  // An account that upgrades gets what was waiting at once, as a paid account does from then on.
  await check(28);
  expect((await held()).waiting).toHaveLength(1);
  const upgraded = new Set([...paid, 'renter@example.test']);
  await check(28.1, upgraded, false);
  expect(sentTo()).toEqual(['renter@example.test']);
  expect(mail[0]!.text).not.toContain('pricing');
  await check(28.2, upgraded);
  expect(sentTo()).toEqual(['friend@example.test', 'owner@example.test', 'renter@example.test']);

  // Deleting an account removes what was waiting for it.
  await check(29);
  expect((await held()).waiting).toHaveLength(1);
  await forgetAlerts(bucket, 'renter@example.test');
  expect(await held()).toEqual({ waiting: [], sent: {} });
  // Where no plans are given (a public app), nothing waits.
  expect((await readRules(bucket)).length).toBe(2);
});
