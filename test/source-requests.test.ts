import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { requestForRefresh, retrySchedule } from '../server/source-requests.ts';

test('a transient response with exhausted quota is not immediately retried', async () => {
  let calls = 0;
  const reset = Math.floor(Date.now() / 1000) + 600;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response('limited', { status: 503, headers: {
      'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reset),
    } });
  }, new AbortController().signal);
  await assert.rejects(request('https://example.test', {}), (error: any) => {
    assert.equal(error.httpStatus, 503);
    assert.equal(Date.parse(required(retrySchedule(error, undefined, Date.now()).retryAt)), reset * 1000);
    return true;
  });
  assert.equal(calls, 1);
});

test('exhausted quota without a reset still suppresses the immediate retry', async () => {
  let calls = 0;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response(null, { status: 503, headers: { 'X-RateLimit-Remaining': '0' } });
  }, new AbortController().signal);
  await assert.rejects(request('https://example.test', {}), /HTTP 503/);
  assert.equal(calls, 1);
});

test('ordinary transient GET errors still retry once', async () => {
  let calls = 0;
  const request = requestForRefresh(async () => ++calls === 1
    ? new Response(null, { status: 503 }) : Response.json({ ok: true }), new AbortController().signal);
  assert.equal((await request('https://example.test', { method: 'get' })).status, 200);
  assert.equal(calls, 2);
});

test('non-idempotent POST is never retried after a transient error', async () => {
  let calls = 0;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response(null, { status: 503 });
  }, new AbortController().signal);
  await assert.rejects(request('https://example.test', { method: 'POST' }), /HTTP 503/);
  assert.equal(calls, 1);
});

test('provider auth/rate errors without request-wrapper metadata still get cooldowns', () => {
  const startedAt = Date.parse('2026-11-13T15:00:00Z');
  for (const [httpStatus, minutes] of [[401, 15], [403, 15], [429, 1]]) {
    const result = retrySchedule({ httpStatus }, undefined, startedAt);
    assert.equal(result.retryAttempts, 1);
    assert.equal(Date.parse(result.retryAt), startedAt + minutes * 60_000);
  }
});

test('malformed optional timestamps do not break failure status persistence', () => {
  const startedAt = Date.parse('2026-11-13T15:00:00Z');
  for (const timestamp of [undefined, null, NaN, Infinity, 'invalid']) {
    const result = retrySchedule({ httpStatus: 403, receivedAt: timestamp, retryAfter: timestamp },
      { retryAttempts: 1 }, startedAt);
    assert.equal(Date.parse(required(result.retryAt)), startedAt + 30 * 60_000);
  }
});

test('classifies a verification page without returning upstream body text or retrying', async () => {
  let calls = 0;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response('<div id="px-captcha">upstream-private-text</div>', { status: 403 });
  }, new AbortController().signal);
  await assert.rejects(request('https://api-v6.streeteasy.com/', { method: 'POST' }), (error: any) => {
    assert.equal(error.httpStatus, 403);
    assert.equal(error.providerDenial, 'browser verification challenge');
    assert.doesNotMatch(JSON.stringify(error), /upstream-private-text/);
    return true;
  });
  assert.equal(calls, 1);
});

test('a StreetEasy public search challenge on HTTP 503 skips the immediate GET retry', async () => {
  let calls = 0;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response(null, { status: 503, headers: { 'CF-Mitigated': 'challenge' } });
  }, new AbortController().signal);
  await assert.rejects(request('https://streeteasy.com/for-rent/nyc'), (error: any) => {
    assert.equal(error.httpStatus, 503);
    assert.equal(error.providerDenial, 'Cloudflare verification challenge');
    assert.equal(Date.parse(required(retrySchedule(error, undefined, error.receivedAt).retryAt)), error.receivedAt + 15 * 60_000);
    return true;
  });
  assert.equal(calls, 1);
});

test('a StreetEasy public rental page can contain verification script references without being a challenge', async () => {
  const html = '<title>NYC rentals</title><script src="px-captcha.js"></script>' + 'listings '.repeat(3000);
  const request = requestForRefresh(async () => new Response(html, { headers: { 'Content-Type': 'text/html' } }),
    new AbortController().signal);
  assert.equal(await (await request('https://streeteasy.com/for-rent/nyc')).text(), html);
});
