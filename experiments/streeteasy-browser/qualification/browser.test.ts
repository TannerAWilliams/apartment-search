import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { BROWSER_VIEWPORT, browserLaunchOptions, performBrowserAction } from '../server/playwright-session.ts';
import { BrowserNetworkGuard } from '../server/browser-network.ts';

// Real Chromium, synthetic intercepted responses only. Never contact a provider.
let browser: Browser;
before(async () => { browser = await chromium.launch(browserLaunchOptions()); });
after(async () => { await browser?.close(); });

test('same browser context preserves HttpOnly cookies across cross-origin API fetch', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: BROWSER_VIEWPORT });
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
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 40, scale: 'css', timeout: 10000, clip: { x: 0, y: 0, ...BROWSER_VIEWPORT } });
    assert.ok(screenshot.byteLength > 0 && screenshot.byteLength < 1024 * 1024);
    console.log('fixture bounded screenshot passed');
    await page.evaluate(() => {
      document.addEventListener('mousedown', () => { document.body.dataset.hold = 'down'; });
      document.addEventListener('mouseup', () => { document.body.dataset.hold += '-up'; });
    });
    await performBrowserAction(page, {type:'hold',x:100,y:100,durationMs:100});
    assert.equal(await page.evaluate(() => document.body.dataset.hold), 'down-up');
    console.log('fixture bounded hold and release passed');
  } finally { guard.close(); await context.close(); }
});

test('real browser cannot follow redirect or navigate to unapproved target', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: BROWSER_VIEWPORT });
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
