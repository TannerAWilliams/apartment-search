import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { log } from '../server/log.ts';
import { handleApi } from '../server/api.ts';
import type { Bucket } from '../server/contracts.ts';
import { logRecord } from './fixtures/json.ts';

const quiet = log.sink;
afterEach(() => { log.sink = quiet; });
function capture() {
  const lines: { level: string; entry: Record<string, unknown> }[] = [];
  log.sink = (level, line) => { lines.push({ level, entry: logRecord(line) }); };
  return lines;
}

test('log lines are single JSON objects with the event, fields and a short stack', () => {
  const lines = capture();
  log.error('request_failed', new TypeError('database down'), { path: '/api/config' });
  log.error('request_failed', 'not an error');
  log.warn('source_check_failed', { source: 'zillow-live', httpStatus: 403 });
  assert.equal(lines[0].level, 'error');
  assert.deepEqual({ ...lines[0].entry, stack: typeof lines[0].entry.stack }, {
    level: 'error', event: 'request_failed', path: '/api/config', error: 'TypeError: database down', stack: 'string' });
  assert.equal(lines[1].entry.error, 'not an error');
  assert.deepEqual(lines[2], { level: 'warn', entry: { level: 'warn', event: 'source_check_failed', source: 'zillow-live', httpStatus: 403 } });
});

test('a storage failure is logged with its cause while the caller gets a plain message', async () => {
  const lines = capture();
  const broken: Bucket = { get: async () => { throw new Error('D1 unavailable'); }, head: async () => { throw new Error('D1 unavailable'); }, put: async () => null };
  const response = await handleApi(new Request('https://app.test/api/config'), { BUCKET: broken });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /D1 unavailable/, 'internal detail stays out of the response');
  assert.deepEqual(lines.map(({ entry }) => [entry.event, entry.path, entry.error]), [['storage_read_failed', '/api/config', 'Error: D1 unavailable']]);
});
