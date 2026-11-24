import { expect, test } from 'bun:test';
import { isDaytimeHour, isNightlyHour, readSettings, runDaytime, runNightly, runScheduled, setNightlyResync } from '../server/nightly.ts';
import { adminEmails, isAdmin } from '../server/roles.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const missing = async () => new Response(null, { status: 404 });
// 1 AM in New York: 05:00 UTC in daylight time, 06:00 UTC in standard time.
const SUMMER_1AM = new Date('2026-07-01T05:00:00Z');
const WINTER_1AM = new Date('2026-01-15T06:00:00Z');

test('only the wake-up at 1 AM New York time counts, in daylight and standard time', () => {
  expect(isNightlyHour(SUMMER_1AM)).toBe(true);
  expect(isNightlyHour(new Date('2026-07-01T06:00:00Z'))).toBe(false);
  expect(isNightlyHour(WINTER_1AM)).toBe(true);
  expect(isNightlyHour(new Date('2026-01-15T05:00:00Z'))).toBe(false);
});

test('the nightly resync runs every source when on, and does nothing when off or at another hour', async () => {
  const env = { BUCKET: createMemoryBucket() };
  expect((await readSettings(env.BUCKET)).nightlyResync).toBe(true);
  expect(await runNightly(env, { fetcher: missing, now: new Date('2026-07-01T12:00:00Z') })).toBe('not-1am');

  const started: boolean[] = [];
  const syncJob = { start: async (delay: boolean) => void started.push(delay), pending: async () => null };
  expect(await runNightly(env, { fetcher: missing, syncJob, now: SUMMER_1AM })).toBe('ran');
  expect(started).toEqual([true]);
  const after = await readSettings(env.BUCKET);
  expect(after.lastNightly).toMatchObject({ at: SUMMER_1AM.toISOString(), background: true });
  expect(after.lastNightly!.updated + after.lastNightly!.failed).toBeGreaterThan(0);

  // Turned off: nothing is fetched, and the last run is kept.
  await setNightlyResync(env.BUCKET, false);
  let fetched = 0;
  const counting = async () => {
    fetched++;
    return new Response(null, { status: 404 });
  };
  expect(await runNightly(env, { fetcher: counting, syncJob, now: WINTER_1AM })).toBe('off');
  expect(fetched).toBe(0);
  expect((await readSettings(env.BUCKET)).lastNightly?.at).toBe(SUMMER_1AM.toISOString());
});

test('without the Workflow, or when it cannot start, the nightly run still checks alerts itself', async () => {
  const env = { BUCKET: createMemoryBucket() };
  expect(await runNightly(env, { fetcher: missing, now: WINTER_1AM })).toBe('ran');
  expect((await readSettings(env.BUCKET)).lastNightly?.background).toBe(false);
  const failing = {
    start: async () => {
      throw new Error('Workflow unavailable');
    },
    pending: async () => null,
  };
  expect(await runNightly(env, { fetcher: missing, syncJob: failing, now: new Date('2026-01-16T06:00:00Z') })).toBe('ran');
  expect((await readSettings(env.BUCKET)).lastNightly?.background).toBe(false);
});

test('admins are the ADMIN_EMAILS addresses, or else the first address allowed to sign in', () => {
  expect(adminEmails({ ACCESS_ALLOWED_EMAILS: ' First@Example.test , second@example.test' })).toEqual(['first@example.test']);
  expect(adminEmails({ ADMIN_EMAILS: 'boss@example.test,Ops@example.test', ACCESS_ALLOWED_EMAILS: 'first@example.test' })).toEqual([
    'boss@example.test',
    'ops@example.test',
  ]);
  expect(adminEmails({})).toEqual([]);
  const env = { ACCESS_ALLOWED_EMAILS: 'first@example.test,second@example.test' };
  expect(isAdmin(env, { account: 'FIRST@example.test', token: false })).toBe(true);
  expect(isAdmin(env, { account: 'second@example.test', token: false })).toBe(false);
  expect(isAdmin(env, { account: null, token: false })).toBe(false);
  expect(isAdmin(env, { account: null, token: true })).toBe(true);
  expect(isAdmin({ PUBLIC_APP: 'true' }, { account: null, token: false })).toBe(true);
});

const post = (path: string, body: unknown) =>
  new Request('https://app.test/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('anyone signed in can read the settings; only an admin can turn the nightly resync off', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const user = { account: 'renter@example.test', admin: false, privateAuthenticated: true };
  const admin = { account: 'owner@example.test', admin: true, privateAuthenticated: true };
  expect(await readJson(handleApi(new Request('https://app.test/api/settings'), env, user))).toEqual({
    nightlyResync: true,
    daytimeChecks: true,
    admin: false,
  });
  expect((await handleApi(post('settings', { nightlyResync: false }), env, user)).status).toBe(403);
  expect((await handleApi(post('settings', { nightlyResync: 'no' }), env, admin)).status).toBe(422);
  expect(await readJson(handleApi(post('settings', { nightlyResync: false }), env, admin))).toEqual({
    nightlyResync: false,
    daytimeChecks: true,
    admin: true,
  });
  expect((await readSettings(env.BUCKET)).nightlyResync).toBe(false);
  expect((await handleApi(new Request('https://app.test/api/settings'), {}, admin)).status).toBe(400);
});

test('signed-in people who are not admins cannot resync sources, and config says who is an admin', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const refused = await handleApi(post('refresh', { check: 'now' }), env, { account: 'renter@example.test', admin: false });
  expect(refused.status).toBe(403);
  expect(await readJson<{ error: string }>(refused)).toEqual({ error: 'Only an admin can resync sources.' });
  const config = (services: object) =>
    readJson<{ account?: string; admin?: boolean }>(handleApi(new Request('https://app.test/api/config'), env, services));
  expect(await config({ account: 'renter@example.test', admin: false })).toMatchObject({ account: 'renter@example.test', admin: false });
  expect(await config({ account: 'owner@example.test', admin: true })).toMatchObject({ admin: true });
});

test('daytime checks run the quick sources and alerts every two hours from 8 AM to 10 PM New York time', async () => {
  const env = { BUCKET: createMemoryBucket() };
  // 8 AM in New York is 12:00 UTC in daylight time and 13:00 UTC in standard time.
  expect(isDaytimeHour(new Date('2026-07-01T12:00:00Z'))).toBe(true);
  expect(isDaytimeHour(new Date('2026-01-15T13:00:00Z'))).toBe(true);
  expect(isDaytimeHour(new Date('2026-07-01T13:00:00Z')), '9 AM').toBe(false);
  expect(isDaytimeHour(new Date('2026-07-01T07:00:00Z')), '3 AM').toBe(false);
  expect(await runDaytime(env, { fetcher: missing, now: new Date('2026-07-01T07:00:00Z') })).toBe('not-daytime');

  const started: boolean[] = [];
  const syncJob = { start: async (delay: boolean) => void started.push(delay), pending: async () => null };
  const noon = new Date('2026-07-01T16:00:00Z');
  expect(await runScheduled(env, { fetcher: missing, syncJob, now: noon })).toBe('ran');
  expect(started, 'the Workflow sources wait for the nightly resync').toEqual([]);
  expect((await readSettings(env.BUCKET)).lastDaytime).toMatchObject({ at: noon.toISOString() });
  expect(await runScheduled(env, { fetcher: missing, syncJob, now: new Date('2026-07-01T07:00:00Z') })).toBe('idle');
  expect(await runScheduled(env, { fetcher: missing, syncJob, now: SUMMER_1AM })).toBe('ran');
  expect(started).toEqual([true]);
  expect(await runScheduled(env, { fetcher: missing })).toBeString();

  // An admin turns the daytime checks off; the nightly setting is left alone.
  const admin = { account: 'owner@example.test', admin: true, privateAuthenticated: true };
  const changed = await readJson<{ daytimeChecks: boolean; nightlyResync: boolean }>(
    handleApi(post('settings', { daytimeChecks: false }), env, admin),
  );
  expect(changed).toMatchObject({ daytimeChecks: false, nightlyResync: true });
  expect((await handleApi(post('settings', {}), env, admin)).status).toBe(422);
  let fetched = 0;
  const counting = async () => {
    fetched++;
    return new Response(null, { status: 404 });
  };
  expect(await runDaytime(env, { fetcher: counting, now: noon })).toBe('off');
  expect(fetched).toBe(0);
});
