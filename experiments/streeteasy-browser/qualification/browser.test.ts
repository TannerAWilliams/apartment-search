import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { BrowserNetworkGuard } from '../server/browser-network.ts';

// Real Chromium, synthetic intercepted responses only. Never contact a provider.
let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined }); });
after(async () => { await browser?.close(); });

test('same browser context preserves HttpOnly cookies across cross-origin API fetch', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let observed = false;
  const guard = new BrowserNetworkGuard(async (url, init) => {
    if (url.startsWith('https://api-v6.streeteasy.com/')) {
      console.log('fixture API request', { method: init.method, cookiePresent: new Headers(init.headers).get('cookie')?.includes('fixture=only') === true });
      assert.equal(new Headers(init.headers).get('cookie')?.includes('fixture=only'), true);
      observed = true;
      return new Response('{"fixture":true}', { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://streeteasy.com', 'Access-Control-Allow-Credentials': 'true' } });
    }
    return new Response('<!doctype html><title>Fixture only</title>', { headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'fixture=only; Domain=.streeteasy.com; Path=/; Secure; HttpOnly; SameSite=None' } });
  });
  await context.route('**/*', route => guard.route(route));
  await context.routeWebSocket('**/*', socket => socket.close());
  try {
    const page = await context.newPage();
    page.on('console', message => console.log('fixture console', message.text()));
    await page.goto('https://streeteasy.com/for-rent/nyc');
    assert.equal((await context.cookies('https://streeteasy.com')).some(cookie => cookie.name === 'fixture' && cookie.value === 'only'), true, 'fixture cookie stored in browser');
    const result = await page.evaluate(async () => (await fetch('https://api-v6.streeteasy.com/fixture', { credentials: 'include' })).json());
    assert.deepEqual(result, { fixture: true }); assert.equal(observed, true);
  } finally { guard.close(); await context.close(); }
});

test('real browser cannot follow redirect or navigate to unapproved target', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const contacted: string[] = [];
  const guard = new BrowserNetworkGuard(async url => { contacted.push(url); return new Response(null, { status: 302, headers: { Location: 'https://not-allowed.invalid/private' } }); });
  await context.route('**/*', route => guard.route(route));
  try {
    const page = await context.newPage(); const response = await page.goto('https://streeteasy.com/redirect-fixture');
    assert.equal(response?.status(), 502); assert.deepEqual(contacted, ['https://streeteasy.com/redirect-fixture']);
    await assert.rejects(page.goto('https://not-allowed.invalid/private'));
    assert.deepEqual(contacted, ['https://streeteasy.com/redirect-fixture']);
  } finally { guard.close(); await context.close(); }
});
