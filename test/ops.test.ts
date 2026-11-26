import { expect, test } from 'bun:test';
import { addRule } from '../server/alerts.ts';
import { isDigestHour, runDigest } from '../server/digest.ts';
import { funnel, recordEvent, warnAboutFailures } from '../server/ops.ts';
import { runScheduled } from '../server/nightly.ts';
import { setPaid } from '../server/plans.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { testListing } from './fixtures/listing.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const now = new Date('2026-11-23T14:00:00Z'); // Monday, 9 AM in New York.

function mailbox() {
  const sent: { to: string[]; subject: string; text: string; html: string }[] = [];
  return {
    sent,
    email: {
      send: async (message: (typeof sent)[number]) => {
        sent.push(message);
      },
    },
  };
}

test('each day counts searches, saves, alerts, checkouts and payments; the funnel adds up the last 30 days', async () => {
  const bucket = createMemoryBucket();
  await recordEvent(bucket, 'search', now);
  await recordEvent(bucket, 'search', now);
  await recordEvent(bucket, 'paid', now);
  await recordEvent(bucket, 'search', new Date('2026-09-01T00:00:00Z'));
  await recordEvent(undefined, 'search', now);
  expect(await funnel(bucket, 30, now, 4)).toEqual({ days: 30, signups: 4, search: 2, save: 0, alert: 0, checkout: 0, paid: 1 });
  // Only 90 days are kept.
  for (let day = 0; day < 95; day++) await recordEvent(bucket, 'save', new Date(now.getTime() - day * 86_400_000));
  const stored = JSON.parse(await (await bucket.get('analytics/daily.json'))!.text()) as { days: object };
  expect(Object.keys(stored.days).length).toBe(90);
  // A storage failure is logged, never thrown.
  const broken = { ...createMemoryBucket(), get: async () => Promise.reject(new Error('down')) };
  await recordEvent(broken, 'search', now);
});

test('the API counts what people do', async () => {
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket };
  const post = (path: string, body: unknown) =>
    new Request('https://app.test/api/' + path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  await handleApi(post('search', { region: 'all', bedrooms: null, maxRent: null }), env);
  await handleApi(post('saved', { listings: [testListing({ id: 'a' })] }), env, { account: 'a@example.test' });
  await handleApi(post('saved', { listings: [testListing({ id: 'a' })] }), env, { account: 'a@example.test' });
  const stats = await readJson<{ funnel: Record<string, number> }>(
    handleApi(new Request('https://app.test/api/admin/stats'), env, { admin: true }),
  );
  expect(stats.funnel).toMatchObject({ search: 1, save: 1, signups: 0 });
});

test('admins hear after every resync in which a source failed', async () => {
  const bucket = createMemoryBucket();
  const mail = mailbox();
  const env = { BUCKET: bucket, ALERT_EMAIL: mail.email, ALERT_EMAIL_FROM: 'alerts@example.test', ADMIN_EMAILS: 'owner@example.test' };
  expect(await warnAboutFailures(env, [{ name: 'Zillow', error: 'Zillow returned HTTP 403.' }, { name: 'Redfin' }], now)).toEqual([
    'Zillow',
    'Redfin',
  ]);
  expect(mail.sent[0]).toMatchObject({ to: ['owner@example.test'], subject: 'Walkup: 2 sources stopped working' });
  expect(
    await warnAboutFailures(
      env,
      [
        { name: 'Zillow', error: 'Zillow returned HTTP 403.' },
        { name: 'Compass', error: 'A <challenge>.' },
      ],
      now,
    ),
    'still failing is not news',
  ).toEqual(['Compass']);
  expect(mail.sent[1]?.subject).toBe('Walkup: 1 source stopped working, 1 still failing');
  // Each source's reason is in the email, and the ones still failing are listed after the new ones.
  expect(mail.sent[0]?.text).toContain('• Zillow: Zillow returned HTTP 403.\n• Redfin');
  expect(mail.sent[0]?.text).not.toContain('Still failing');
  expect(mail.sent[1]?.text).toContain('• Compass: A <challenge>.\n\nStill failing from before:\n• Zillow: Zillow returned HTTP 403.');
  expect(mail.sent[1]?.html).toContain('<li>Compass: A challenge.</li>');
  // Nothing new the next day: the email still comes, every day something is failing.
  expect(await warnAboutFailures(env, [{ name: 'Zillow' }, { name: 'Compass' }], now)).toEqual([]);
  expect(mail.sent[2]?.subject).toBe('Walkup: 2 sources are still failing');
  expect(mail.sent[2]?.text).toStartWith('Still failing from before:\n• Zillow\n• Compass');
  expect(await warnAboutFailures(env, [{ name: 'Zillow' }], now)).toEqual([]);
  expect(mail.sent[3]?.subject).toBe('Walkup: 1 source is still failing');
  expect(await warnAboutFailures(env, [], now), 'a night when everything worked sends nothing').toEqual([]);
  expect(mail.sent.length).toBe(4);
  const failing = { ...env, ALERT_EMAIL: { send: async () => Promise.reject(new Error('quota')) } };
  expect(await warnAboutFailures(failing, [{ name: 'TF Cornerstone' }], now)).toEqual(['TF Cornerstone']);
  expect(await warnAboutFailures({ BUCKET: createMemoryBucket() }, [{ name: 'A' }], now), 'no email set up').toEqual(['A']);
});

test('the Monday digest tells each paid account what is new for its alerts', async () => {
  expect(isDigestHour(now)).toBe(true);
  expect(isDigestHour(new Date('2026-11-24T14:00:00Z')), 'Tuesday').toBe(false);
  expect(isDigestHour(new Date('2026-11-23T15:00:00Z')), '10 AM').toBe(false);
  const bucket = createMemoryBucket();
  const mail = mailbox();
  const env = { BUCKET: bucket, ALERT_EMAIL: mail.email, ALERT_EMAIL_FROM: 'alerts@example.test', APP_ORIGIN: 'https://walkup.test' };
  const fresh = (id: string) =>
    testListing({ id, listedAt: new Date(now.getTime() - 86_400_000).toISOString(), insights: { warnings: [] } });
  const old = (id: string) => testListing({ id, listedAt: '2026-01-01T00:00:00Z', insights: { warnings: [] } });
  const rule = { name: 'Brooklyn 1BR', filters: { region: 'brooklyn', bedrooms: 1, maxRent: 3500 } };
  await addRule(bucket, rule, async () => [], now, 'paid@example.test');
  await addRule(bucket, { ...rule, name: 'Quiet' }, async () => [], now, 'quiet@example.test');
  await addRule(bucket, rule, async () => [], now, 'free@example.test');
  await addRule(bucket, rule, async () => [], now);
  await setPaid(bucket, 'paid@example.test', true);
  await setPaid(bucket, 'quiet@example.test', true);
  const loadMatches = async (filters: { region: string }) => (filters.region === 'brooklyn' ? [fresh('a'), fresh('b'), old('c')] : []);
  // Quiet's alert matches nothing new.
  await addRule(bucket, { name: 'Nothing', filters: { region: 'queens' } }, async () => [], now, 'quiet@example.test');
  const sent = await runDigest(env, { now, loadMatches: loadMatches as never });
  expect(sent).toBe(2);
  const paid = mail.sent.find(({ to }) => to[0] === 'paid@example.test')!;
  expect(paid.subject).toBe('Your week on Walkup: 2 new apartments');
  expect(paid.text).toContain('Brooklyn 1BR: 3 match now, 2 new this week');
  expect(
    mail.sent.some(({ to }) => to[0] === 'free@example.test'),
    'free accounts get no digest',
  ).toBe(false);
  expect(await runDigest({ BUCKET: bucket }, { now })).toBe(0);
  const failing = { ...env, ALERT_EMAIL: { send: async () => Promise.reject(new Error('quota')) } };
  expect(await runDigest(failing, { now, loadMatches: loadMatches as never })).toBe(0);
  // The hourly wake-up sends it on Monday at 9 AM.
  expect(await runScheduled({ BUCKET: createMemoryBucket() }, { fetcher: async () => new Response(null, { status: 404 }), now })).toBe(
    'digest:0',
  );
});
