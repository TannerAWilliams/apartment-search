import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { browserPush, deviceLabel, pushSupport, subscribePush, type PushBrowser } from '../src/push.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
function browser(overrides: Partial<PushBrowser> = {}, { permission = 'granted', existing = false } = {}) {
  const calls: string[] = [];
  const registration = { pushManager: {
    getSubscription: async () => existing ? { unsubscribe: async () => { calls.push('unsubscribe'); return true; } } : null,
    subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      calls.push('subscribe:' + applicationServerKey.length);
      return { toJSON: () => ({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'p', auth: 'a' } }) };
    },
  } };
  const value: PushBrowser = { userAgent: IPHONE, standalone: true, permission: 'default', register: () => Promise.resolve(registration),
    requestPermission: async () => { calls.push('ask'); return permission; }, ...overrides };
  return { value, calls };
}

test('notification support depends on the browser, permission, and Home Screen install on iPhone', () => {
  assert.equal(pushSupport(null), 'unsupported');
  assert.equal(pushSupport(browser().value), 'available');
  assert.equal(pushSupport(browser({ permission: 'denied' }).value), 'blocked');
  assert.equal(pushSupport(browser({ permission: null, standalone: false }).value), 'install-first');
  assert.equal(pushSupport(browser({ permission: null, userAgent: ANDROID }).value), 'unsupported');
  assert.equal(browserPush(), null, 'no browser under Bun');
});

test('devices are labelled by type and browser', () => {
  assert.equal(deviceLabel(IPHONE), 'iPhone · Safari');
  assert.equal(deviceLabel(ANDROID), 'Android · Chrome');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/140.0'), 'Windows · Firefox');
  assert.equal(deviceLabel('Mozilla/5.0 (Macintosh) AppleWebKit Chrome/141 Safari/537.36 Edg/141'), 'Mac · Edge');
  assert.equal(deviceLabel('curl/8'), 'Computer');
  assert.equal(deviceLabel('Mozilla/5.0 (iPad; CPU OS 18_0)'), 'iPad');
});

test('subscribing asks permission, replaces an old subscription, and uses the server key', async () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(65).fill(4))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const fresh = browser({}, { existing: true });
  assert.deepEqual(await subscribePush(key, fresh.value), { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'p', auth: 'a' } });
  assert.deepEqual(fresh.calls, ['ask', 'unsubscribe', 'subscribe:65']);
  await assert.rejects(subscribePush(key, browser({}, { permission: 'denied' }).value), /not allowed/);
  await assert.rejects(subscribePush(key, browser({ register: () => null }).value), /cannot show notifications/);
  await assert.rejects(subscribePush(key, null), /cannot show notifications/);
});

test('in a browser, support and registration come from the real APIs', async () => {
  const globals = globalThis as Record<string, unknown>;
  const saved = { window: globals.window, Notification: globals.Notification, serviceWorker: navigator.serviceWorker, standalone: (navigator as { standalone?: boolean }).standalone };
  const registered: string[] = [];
  try {
    globals.Notification = { permission: 'default', requestPermission: async () => 'granted' };
    globals.window = { PushManager: {}, Notification: globals.Notification, matchMedia: () => ({ matches: false }) };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: async (url: string) => { registered.push(url); return {}; } } });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const real = browserPush()!;
    assert.equal(real.permission, 'default');
    assert.equal(real.standalone, true);
    await real.register();
    assert.deepEqual(registered, ['/sw.js']);
    assert.equal(await real.requestPermission(), 'granted');
    globals.window = { matchMedia: () => ({ matches: true }) };
    assert.equal(browserPush()!.register(), null, 'no push support, nothing registered');
  } finally {
    globals.window = saved.window; globals.Notification = saved.Notification;
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: saved.serviceWorker });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: saved.standalone });
  }
});
