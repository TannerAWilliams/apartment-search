import { afterEach, expect, test } from 'bun:test';
import { log } from '../server/log.ts';
import { handleApi } from './fixtures/api.ts';
import type { Bucket } from '../server/contracts.ts';
import { logRecord } from './fixtures/json.ts';

const quiet = log.sink;
afterEach(() => {
  log.sink = quiet;
});
function capture() {
  const lines: { level: string; entry: Record<string, unknown> }[] = [];
  log.sink = (level, line) => {
    lines.push({ level, entry: logRecord(line) });
  };
  return lines;
}

test('log lines are single JSON objects with the event, fields and a short stack', () => {
  const lines = capture();
  log.error('request_failed', new TypeError('database down'), { path: '/api/config' });
  log.error('request_failed', 'not an error');
  log.warn('source_check_failed', { source: 'zillow-live', httpStatus: 403 });
  expect(lines[0].level).toBe('error');
  const { stack, ...entry } = lines[0].entry;
  expect(typeof stack).toBe('string');
  expect(entry).toStrictEqual({ level: 'error', event: 'request_failed', path: '/api/config', error: 'TypeError: database down' });
  expect(lines[1].entry.error).toBe('not an error');
  expect(lines[2]).toStrictEqual({
    level: 'warn',
    entry: { level: 'warn', event: 'source_check_failed', source: 'zillow-live', httpStatus: 403 },
  });
});

test('a storage failure is logged with its cause while the caller gets a plain message', async () => {
  const lines = capture();
  const broken: Bucket = {
    get: async () => {
      throw new Error('D1 unavailable');
    },
    head: async () => {
      throw new Error('D1 unavailable');
    },
    put: async () => null,
  };
  const response = await handleApi(new Request('https://app.test/api/config'), { BUCKET: broken });
  expect(response.status).toBe(503);
  expect(await response.text(), 'internal detail stays out of the response').not.toMatch(/D1 unavailable/);
  expect(lines.map(({ entry }) => [entry.event, entry.path, entry.error])).toStrictEqual([
    ['storage_read_failed', '/api/config', 'Error: D1 unavailable'],
  ]);
});
