import { expect, test } from 'bun:test';
import { readDevices, readRecent, readRules, checkAlerts } from '../server/alerts.ts';
import { log } from '../server/log.ts';
import { refreshStatus, storedHdcRerentals, storedHousing } from '../server/refresh.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';

/** Runs `body` and returns the log lines it wrote. */
async function logged(body: () => Promise<unknown>) {
  const lines: string[] = [];
  const sink = log.sink;
  log.sink = (_level, line) => lines.push(line);
  try {
    await body();
  } finally {
    log.sink = sink;
  }
  return lines;
}

test('saved documents that do not match their schema are reported and read as absent', async () => {
  const bucket = createMemoryBucket();
  for (const key of [
    'rentals/refresh.json',
    'rentals/housing-connect.json',
    'rentals/hdc-rerentals.json',
    'alerts/rules.json',
    'alerts/devices.json',
    'alerts/recent.json',
  ])
    await bucket.put(key, JSON.stringify({ unexpected: [1, 2, 3], sources: 'not a list' }));
  const lines = await logged(async () => {
    expect((await refreshStatus(bucket)).sources).toEqual([]);
    expect((await storedHousing(bucket)).opportunities).toEqual([]);
    expect(await storedHdcRerentals(bucket)).toBeNull();
    expect(await readRules(bucket)).toEqual([]);
    expect(await readDevices(bucket)).toEqual([]);
    expect(await readRecent(bucket)).toEqual([]);
  });
  expect(lines.filter((line) => line.includes('stored_document_invalid'))).toHaveLength(6);
});

test('a damaged alert baseline is replaced by a new one, so the rule keeps working without a flood', async () => {
  const bucket = createMemoryBucket();
  const rule = { id: 'r1', name: 'Rule', filters: {}, createdAt: '2026-11-01T00:00:00Z' };
  await bucket.put('alerts/rules.json', JSON.stringify([rule]));
  await bucket.put('alerts/baselines/r1.json', '{"version":2}');
  let result: { alerts: unknown[] } | undefined;
  const lines = await logged(async () => {
    result = await checkAlerts(bucket, async () => [], {}, { origin: 'https://app.test' });
  });
  expect(lines.some((line) => line.includes('stored_document_invalid'))).toBe(true);
  expect(result?.alerts).toEqual([]);
  expect(await (await bucket.get('alerts/baselines/r1.json'))?.json()).toMatchObject({ version: 1 });
});
