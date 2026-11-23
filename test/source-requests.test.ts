import { instanceOf, rejection, required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { requestForRefresh, retrySchedule, SourceResponseError } from '../server/source-requests.ts';

test('a transient response with exhausted quota is not immediately retried', async () => {
  let calls = 0;
  const reset = Math.floor(Date.now() / 1000) + 600;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response('limited', {
      status: 503,
      headers: {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(reset),
      },
    });
  }, new AbortController().signal);
  const failure = instanceOf(await rejection(request('https://example.test', {})), SourceResponseError);
  expect(failure.httpStatus).toBe(503);
  expect(Date.parse(required(retrySchedule(failure, undefined, Date.now()).retryAt))).toBe(reset * 1000);
  expect(calls).toBe(1);
});

test('exhausted quota without a reset still suppresses the immediate retry', async () => {
  let calls = 0;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response(null, { status: 503, headers: { 'X-RateLimit-Remaining': '0' } });
  }, new AbortController().signal);
  await expect(request('https://example.test', {})).rejects.toThrow(/HTTP 503/);
  expect(calls).toBe(1);
});

test('ordinary transient GET errors still retry once', async () => {
  let calls = 0;
  const request = requestForRefresh(
    async () => (++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ ok: true })),
    new AbortController().signal,
  );
  expect((await request('https://example.test', { method: 'get' })).status).toBe(200);
  expect(calls).toBe(2);
});

test('non-idempotent POST is never retried after a transient error', async () => {
  let calls = 0;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response(null, { status: 503 });
  }, new AbortController().signal);
  await expect(request('https://example.test', { method: 'POST' })).rejects.toThrow(/HTTP 503/);
  expect(calls).toBe(1);
});

test('provider auth/rate errors without request-wrapper metadata still get cooldowns', () => {
  const startedAt = Date.parse('2026-11-13T15:00:00Z');
  for (const [httpStatus, minutes] of [
    [401, 15],
    [403, 15],
    [429, 1],
  ]) {
    const result = retrySchedule({ httpStatus }, undefined, startedAt);
    expect(result.retryAttempts).toBe(1);
    expect(Date.parse(required(result.retryAt))).toBe(startedAt + minutes * 60_000);
  }
});

test('malformed optional timestamps do not break failure status persistence', () => {
  const startedAt = Date.parse('2026-11-13T15:00:00Z');
  for (const timestamp of [undefined, null, NaN, Infinity, 'invalid']) {
    const result = retrySchedule({ httpStatus: 403, receivedAt: timestamp, retryAfter: timestamp }, { retryAttempts: 1 }, startedAt);
    expect(Date.parse(required(result.retryAt))).toBe(startedAt + 30 * 60_000);
  }
});

test('classifies a verification page without returning upstream body text or retrying', async () => {
  let calls = 0;
  const request = requestForRefresh(async () => {
    calls++;
    return new Response('<div id="px-captcha">upstream-private-text</div>', { status: 403 });
  }, new AbortController().signal);
  const verifyDenial = (error: unknown) => {
    const failure = instanceOf(error, SourceResponseError);
    expect(failure.httpStatus).toBe(403);
    expect(failure.providerDenial).toBe('browser verification challenge');
    expect(JSON.stringify(failure)).not.toMatch(/upstream-private-text/);
  };
  verifyDenial(await rejection(request('https://api-v6.streeteasy.com/', { method: 'POST' })));
  expect(calls).toBe(1);
  verifyDenial(await rejection(request('https://streeteasy.com/for-rent/nyc')));
  expect(calls).toBe(2);
});

test('a refusal whose page names no known block is reported without a reason', async () => {
  const request = requestForRefresh(async () => new Response('<h1>Forbidden</h1>', { status: 403 }), new AbortController().signal);
  const failure = instanceOf(await rejection(request('https://streeteasy.com/for-rent/nyc')), SourceResponseError);
  expect(failure.httpStatus).toBe(403);
  expect(failure.providerDenial).toBeUndefined();
});

test('an explicit Cloudflare challenge fails the refresh regardless of status', async () => {
  for (const status of [200, 503]) {
    let calls = 0;
    const request = requestForRefresh(async () => {
      calls++;
      return new Response('<html>upstream-private-text</html>', { status, headers: { 'cf-mitigated': 'challenge' } });
    }, new AbortController().signal);
    const failure = instanceOf(await rejection(request('https://streeteasy.com/for-rent/nyc')), SourceResponseError);
    expect(failure.httpStatus).toBe(status);
    expect(failure.providerDenial).toBe('Cloudflare verification challenge');
    expect(Date.parse(required(retrySchedule(failure, undefined, failure.receivedAt).retryAt))).toBe(failure.receivedAt + 15 * 60_000);
    expect(JSON.stringify(failure)).not.toMatch(/upstream-private-text/);
    expect(calls).toBe(1);
  }
});
