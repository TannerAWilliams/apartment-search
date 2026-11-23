import { afterEach, expect, test } from 'bun:test';
import { addDevice, addRule, checkAlerts, composeAlert, deleteRule, readDevices, readRecent, readRules, removeDevice, validateRule, MAX_RULES } from '../server/alerts.ts';
import { handleApi } from './fixtures/api.ts';
import { log } from '../server/log.ts';
import { toBase64Url } from '../src/base64url.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { logRecord, readJson } from './fixtures/json.ts';
import type { AlertState } from '../src/AlertsPage.tsx';
import { testListing } from './fixtures/listing.ts';
import { parseFilters } from '../src/search.ts';

const quiet = log.sink;
afterEach(() => { log.sink = quiet; });

/** A listing with a recorded price history, as refreshes save them. */
function unit(number: string, rent: number, checkedAt: string, previous?: number) {
  const observations = [...(previous ? [{ checkedAt: '2026-11-01T00:00:00Z', rent: previous, priceIncludesFees: false }] : []),
    { checkedAt, rent, priceIncludesFees: false }];
  return testListing({ id: 'zumper:' + number, address: number + ' Example Street', unit: '2A', city: 'Brooklyn', state: 'NY', zip: '11215', rent, bedrooms: 1,
    priceIncludesFees: false, priceHistory: { sourceId: 'zumper-live', firstObservedAt: observations[0].checkedAt, lastObservedAt: checkedAt, truncated: false, observations } });
}
const rule = { name: 'Brooklyn 1BR', filters: { region: 'brooklyn', bedrooms: 1, maxRent: 3500 } };
async function device() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  return { endpoint: 'https://web.push.apple.com/device-' + crypto.randomUUID(),
    keys: { p256dh: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)), auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))) } };
}

test('a rule needs a name and filters that a stored search can run without routing', () => {
  expect(validateRule(rule).name).toBe('Brooklyn 1BR');
  expect(() => validateRule({ ...rule, name: ' ' })).toThrow(/name/);
  expect(() => validateRule({ ...rule, name: 'x'.repeat(61) })).toThrow(/name/);
  expect(() => validateRule({ ...rule, filters: { ...rule.filters, maxTransitMinutes: 30 } })).toThrow(/commute/);
  expect(() => validateRule({ ...rule, filters: { ...rule.filters, workplace: 'custom', customWorkplace: '1 Main Street, New York' } })).toThrow(/workplace preset/);
});

test('alerts report new apartments and price drops since the last check, and nothing on the first', async () => {
  const bucket = createMemoryBucket();
  let inventory = [unit('10', 3000, '2026-11-20T00:00:00Z')];
  const load = async () => inventory;
  const sent: { to: string[]; subject: string; text: string; html: string }[] = [];
  const pushes: string[] = [];
  const phone = await device();
  await addDevice(bucket, phone, 'iPhone');
  const channels = { email: { send: async (message: (typeof sent)[number]) => { sent.push(message); } }, from: 'alerts@example.com', to: ['owner@example.com'],
    vapid: { publicKey: 'BAAA', privateKey: 'x', subject: 'https://example.com' },
    pushFetcher: async (url: string) => { pushes.push(url); return new Response(null, { status: 201 }); } };
  await addRule(bucket, rule, load);
  expect((await checkAlerts(bucket, load, channels, { origin: 'https://apartments.example' })).alerts.length, 'unchanged since the rule was saved').toBe(0);

  inventory = [unit('10', 2850, '2026-11-22T00:00:00Z', 3000), unit('12', 3100, '2026-11-22T00:00:00Z'), unit('14 <b>', 3200, '2026-11-22T00:00:00Z')];
  const { alerts } = await checkAlerts(bucket, load, { ...channels, vapid: null }, { origin: 'https://apartments.example' });
  expect(alerts.length).toBe(1);
  expect(alerts[0].title).toBe('Brooklyn 1BR: 2 new apartments, 1 price drop');
  expect(alerts[0].lines).toStrictEqual(['10 Example Street, Unit 2A, Brooklyn: $3,000 → $2,850', '12 Example Street, Unit 2A, Brooklyn: $3,100', '14 <b> Example Street, Unit 2A, Brooklyn: $3,200']);
  expect(sent.length).toBe(1);
  expect(sent[0].to).toStrictEqual(['owner@example.com']);
  expect(sent[0].text).toMatch(/Open Apartment Search: https:\/\/apartments\.example\//);
  expect(sent[0].html, 'listing text is escaped in the email').toMatch(/14 &#60;b&#62; Example/);
  expect((await readRecent(bucket))[0].title).toBe(alerts[0].title);
  expect((await checkAlerts(bucket, load, channels, { origin: '' })).alerts.length, 'the same changes are reported once').toBe(0);
});

test('a long alert lists four apartments and a count; price increases are not alerts', () => {
  const at = '2026-11-22T00:00:00Z';
  const added = Array.from({ length: 6 }, (_, index) => ({ kind: 'newly_encountered' as const, current: { key: String(index), label: `Unit ${index}`, sourceId: 's', checkedAt: at, rent: 3000, includesFees: false } }));
  const rising = { kind: 'price' as const, current: { ...added[0].current, rent: 3100 }, previous: added[0].current };
  const alert = composeAlert({ id: 'r', name: 'Search', filters: parseFilters({}), createdAt: at }, [...added, rising], new Date(at))!;
  expect(alert.title).toBe('Search: 6 new apartments');
  expect(alert.lines.slice(-1)).toStrictEqual(['and 2 more']);
  expect(composeAlert({ id: 'r', name: 'Search', filters: parseFilters({}), createdAt: at }, [rising], new Date(at))).toBeNull();
});

test('notifications go to each device, and a device that unsubscribed is removed', async () => {
  const bucket = createMemoryBucket();
  const { generateVapidKeys } = await import('../server/web-push.ts');
  const vapid = { ...await generateVapidKeys(), subject: 'https://apartments.example' };
  const [kept, gone, failing, unreachable] = [await device(), await device(), await device(), await device()];
  for (const phone of [kept, gone, failing, unreachable]) await addDevice(bucket, phone, 'Phone');
  let inventory = [unit('20', 3000, '2026-11-20T00:00:00Z')];
  await addRule(bucket, rule, async () => inventory);
  inventory = [...inventory, unit('22', 3000, '2026-11-22T00:00:00Z')];
  const lines: string[] = [];
  log.sink = (_level, line) => { lines.push(logRecord(line).event); };
  const result = await checkAlerts(bucket, async () => inventory, { vapid, pushFetcher: async (url) => {
    if (url === unreachable.endpoint) throw new Error('connection reset');
    return new Response(null, { status: url === gone.endpoint ? 410 : url === failing.endpoint ? 500 : 201 });
  } }, { origin: '' });
  expect(result.delivered.devices).toBe(1);
  expect((await readDevices(bucket)).map(({ endpoint }) => endpoint), 'a device that could not be reached is kept for the next alert').toStrictEqual([kept.endpoint, failing.endpoint, unreachable.endpoint]);
  expect(lines.includes('alert_push_failed')).toBeTruthy();
});

test('rules, devices and failures are bounded and reported', async () => {
  const bucket = createMemoryBucket();
  const none = async () => [];
  for (let index = 0; index < MAX_RULES; index++) await addRule(bucket, { ...rule, name: 'Rule ' + index }, none);
  await expect(addRule(bucket, rule, none)).rejects.toThrow(/up to 10 alerts/);
  await deleteRule(bucket, (await readRules(bucket))[0].id);
  await expect(addRule(bucket, rule, async () => Array.from({ length: 2001 }, () => testListing()))).rejects.toThrow(/Narrow it/);
  await expect(addDevice(bucket, { endpoint: 'https://example.com/push', keys: { p256dh: 'x', auth: 'y' } }, '')).rejects.toThrow(/subscription/);
  const phone = await device();
  await addDevice(bucket, phone, '');
  await addDevice(bucket, phone, 'Renamed');
  expect((await readDevices(bucket)).map(({ label }) => label), 'subscribing again replaces the device').toStrictEqual(['Renamed']);
  await removeDevice(bucket, phone.endpoint);
  expect((await readDevices(bucket)).length).toBe(0);

  const events: string[] = [];
  log.sink = (_level, line) => { events.push(logRecord(line).event); };
  const broken = await checkAlerts(bucket, async () => { throw new Error('storage down'); }, {}, { origin: '' });
  expect(broken.alerts.length).toBe(0);
  expect(events.includes('alert_check_failed')).toBeTruthy();
  events.length = 0;
  await checkAlerts(bucket, async () => Array.from({ length: 2001 }, () => testListing()), {}, { origin: '' });
  expect(events.includes('alert_rule_too_broad')).toBeTruthy();
});

test('a failed email is logged and push still goes out', async () => {
  const bucket = createMemoryBucket();
  let inventory = [unit('30', 3000, '2026-11-20T00:00:00Z')];
  await addRule(bucket, rule, async () => inventory);
  inventory = [...inventory, unit('32', 3000, '2026-11-22T00:00:00Z')];
  const events: string[] = [];
  log.sink = (_level, line) => { events.push(logRecord(line).event); };
  const result = await checkAlerts(bucket, async () => inventory, { email: { send: async () => { throw new Error('E_RECIPIENT_NOT_ALLOWED'); } }, from: 'a@example.com', to: ['b@example.com'] }, { origin: '' });
  expect(result.delivered.email).toBe(false);
  expect(events.includes('alert_email_failed')).toBeTruthy();
});

test('the alerts API lists, adds and removes rules and devices, and sends a test alert', async () => {
  const bucket = createMemoryBucket();
  const sent: unknown[] = [];
  const env = { BUCKET: bucket, ACCESS_ALLOWED_EMAILS: 'owner@example.com', ALERT_EMAIL_FROM: 'alerts@example.com', ALERT_EMAIL: { send: async (message: unknown) => { sent.push(message); } } };
  const call = (body?: unknown) => handleApi(new Request('https://app.test/api/alerts', body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), env);
  const empty = await readJson<AlertState>(call());
  expect(empty).toStrictEqual({ rules: [], recent: [], devices: [], channels: { email: true, push: null } });
  const added = await readJson<AlertState>(call({ action: 'add-rule', rule }));
  expect(added.rules[0].name).toBe('Brooklyn 1BR');
  const phone = await device();
  const withDevice = await readJson<AlertState>(call({ action: 'add-device', subscription: phone, label: 'iPhone' }));
  expect(withDevice.devices.map(({ label }) => label)).toStrictEqual(['iPhone']);
  expect(JSON.stringify(withDevice).includes(phone.endpoint), 'device addresses stay on the server').toBe(false);
  const tested = await readJson<AlertState>(call({ action: 'test' }));
  expect(tested.delivered).toStrictEqual({ email: true, devices: 0 });
  expect(sent.length).toBe(1);
  expect((await readJson<AlertState>(call({ action: 'remove-device', endpoint: phone.endpoint }))).devices.length).toBe(0);
  expect((await readJson<AlertState>(call({ action: 'delete-rule', id: added.rules[0].id }))).rules.length).toBe(0);
  expect((await call({ action: 'explode' })).status).toBe(422);
  expect((await call({ action: 'add-rule', rule: { name: '' } })).status).toBe(422);
  expect((await handleApi(new Request('https://app.test/api/alerts'), {})).status).toBe(400);
  expect((await handleApi(new Request('https://app.test/api/alerts', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }), {})).status).toBe(400);
  const broken = { get: async () => { throw new Error('down'); }, head: async () => null, put: async () => null };
  expect((await handleApi(new Request('https://app.test/api/alerts'), { BUCKET: broken })).status).toBe(503);
});

test('a resync that saved listings is followed by an alert check after the response', async () => {
  const bucket = createMemoryBucket();
  await addRule(bucket, rule, async () => []);
  const waits: Promise<unknown>[] = [];
  const events: string[] = [];
  log.sink = (_level, line) => { events.push(logRecord(line).event); };
  const response = await handleApi(new Request('https://app.test/api/refresh', { method: 'POST', body: JSON.stringify({ check: 'now', source: 'housingconnect' }), headers: { 'Content-Type': 'application/json' } }),
    { BUCKET: bucket }, { fetcher: async () => new Response('busy', { status: 503 }), waitUntil: (work) => { waits.push(work); } });
  expect(response.status).toBe(200);
  await Promise.all(waits);
  expect(waits.length, 'the refresh, then the alert check').toBe(2);
  expect(events.filter((event) => event.startsWith('alert'))).toStrictEqual([]);
});
