import test from 'node:test';
import assert from 'node:assert/strict';
import { connectRemoteBrowser, remoteBrowserEndpoint, REMOTE_BROWSER_TIMEOUT_MS } from '../server/remote-browser.ts';
const token = 'synthetic_test_token_000000000';
test('fixed native protocol endpoint stays within free session bound', () => {
  const url = new URL(remoteBrowserEndpoint(token));
  assert.equal(url.origin, 'wss://production-sfo.browserless.io');
  assert.equal(url.pathname, '/chromium/playwright');
  assert.equal(url.searchParams.get('token'), token);
  assert.equal(url.searchParams.get('timeout'), '110000');
  assert.ok(REMOTE_BROWSER_TIMEOUT_MS < 120000);
  assert.deepEqual([...url.searchParams.keys()], ['token', 'timeout']);
});
test('invalid tokens cannot inject endpoints or browser flags', () => {
  for (const invalid of ['', 'short', 'a'.repeat(257), token+'&stealth=true', 'https://evil.invalid', token+'\n']) {
    assert.throws(() => remoteBrowserEndpoint(invalid), /Invalid remote browser configuration/);
  }
});
test('connection errors redact vendor URLs and credentials', async () => {
  await assert.rejects(connectRemoteBrowser(token, async url => { throw new Error(url); }),
    error => error instanceof Error && error.message === 'Remote browser connection failed' && !error.stack?.includes(token));
});
test('connector receives bounded timeout and returns browser without fallback or retry', async () => {
  let calls = 0; const browser = {};
  assert.equal(await connectRemoteBrowser(token, async (url, options) => {
    calls++; assert.equal(new URL(url).hostname, 'production-sfo.browserless.io');
    assert.equal(options.timeout, 15000); return browser;
  }), browser);
  assert.equal(calls, 1);
});
