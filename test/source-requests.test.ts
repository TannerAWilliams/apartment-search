import test from 'node:test';
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
    assert.equal(Date.parse(retrySchedule(error, undefined, Date.now()).retryAt), reset * 1000);
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
