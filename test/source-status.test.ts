import { expect, test } from 'bun:test';
import { sourceRows } from '../src/source-status.ts';
test('source rows distinguish failed attempts, retained data and browse-only providers', () => {
  const rows = sourceRows(
    [{ id: 'streeteasy-live', marketplace: 'streeteasy', name: 'StreetEasy', resyncable: true }],
    [{ id: 'streeteasy-live', status: 'failed', updatedAt: '2026-01-01', checkedAt: '2026-01-02', retryAt: '2026-01-03' }],
    { streeteasy: 'StreetEasy', zillow: 'Zillow' },
    Date.parse('2026-01-02'),
  );
  expect(rows.length).toBe(2);
  expect(rows[0].state).toBe('Last attempt failed');
  expect(rows[0].coolingDown).toBe(true);
  expect(rows[0].status?.updatedAt).toBe('2026-01-01');
  expect(rows[1].resyncable).toBe(false);
  expect(rows[1].state).toBe('Not connected');
});
test('a connected but never fetched provider remains actionable and is not labelled fresh', () => {
  const [row] = sourceRows([{ id: 'openigloo', name: 'Openigloo', resyncable: true }], [], {});
  expect(row.state).toBe('Not fetched yet');
  expect(row.coolingDown).toBe(false);
});

test('partial refresh summary names blocked providers without claiming complete coverage', async () => {
  const { refreshSummary } = await import('../src/source-status.ts');
  const message = refreshSummary([
    { id: 'hotpads', status: 'updated', listingCount: 67 },
    { id: 'streeteasy-live', name: 'StreetEasy', status: 'failed' },
    { id: 'zillow', status: 'feed_required' },
  ]);
  expect(message).toMatch(/1 source updated/);
  expect(message).toMatch(/StreetEasy could not refresh/);
  expect(message).toMatch(/not complete coverage/);
  expect(message).not.toMatch(/Zillow/);
});

test('unchanged refresh checks never claim inventory was updated', async () => {
  const { refreshSummary } = await import('../src/source-status.ts');
  const message = refreshSummary([{ id: 'market', status: 'current' }]);
  expect(message).toMatch(/1 source checked with no changes/);
  expect(message).not.toMatch(/updated|No sources refreshed/);
});

test('mixed refresh distinguishes changed and unchanged sources', async () => {
  const { refreshSummary } = await import('../src/source-status.ts');
  const message = refreshSummary([
    { id: 'hotpads', status: 'updated' },
    { id: 'market', status: 'current' },
    { id: 'history', status: 'current' },
  ]);
  expect(message).toMatch(/1 source updated; 2 sources checked with no changes/);
});

test('failed refresh does not turn unchanged checks into updates', async () => {
  const { refreshSummary } = await import('../src/source-status.ts');
  const message = refreshSummary([
    { id: 'market', status: 'current' },
    { id: 'streeteasy-live', name: 'StreetEasy', status: 'failed' },
  ]);
  expect(message).toMatch(/1 source checked with no changes; StreetEasy could not refresh/);
  expect(message).toMatch(/cached listings are retained where available/);
  expect(message).not.toMatch(/updated/);
});

test('a running resync counts only the sources it reached and names the ones still syncing', async () => {
  const { refreshSummary } = await import('../src/source-status.ts');
  const run = { lastCheckedAt: '2026-11-23T23:54:23.077Z', checking: true };
  const earlier = '2026-11-18T18:20:40.683Z';
  const message = refreshSummary(
    [
      { id: 'trulia-live', name: 'Trulia', status: 'updated', checkedAt: run.lastCheckedAt },
      { id: 'zillow-live', name: 'Zillow', status: 'failed', checkedAt: run.lastCheckedAt },
      { id: 'cityrealty-live', name: 'CityRealty', status: 'updated', checkedAt: earlier },
      { id: 'streeteasy-live', name: 'StreetEasy', status: 'failed', checkedAt: earlier },
    ],
    run,
  );
  expect(message).toMatch(/^1 source updated; Zillow could not refresh/);
  expect(message).toMatch(/Still syncing in the background: CityRealty, StreetEasy\.$/);
  expect(
    refreshSummary([{ id: 'streeteasy-live', name: 'StreetEasy', status: 'failed', checkedAt: earlier }], {
      ...run,
      paused: ['streeteasy-live'],
    }),
  ).toMatch(/No sources refreshed/);
  const success = refreshSummary(
    [
      { id: 'trulia-live', status: 'updated', checkedAt: run.lastCheckedAt },
      { id: 'zumper', name: 'Zumper', checkedAt: earlier },
    ],
    run,
  );
  expect(success).toMatch(/limited samples\. Still syncing in the background: Zumper\.$/);
  expect(refreshSummary([{ id: 'zumper', name: 'Zumper', checkedAt: earlier }], run)).toBe('Still syncing in the background: Zumper.');
  expect(refreshSummary([{ id: 'zumper', checkedAt: earlier }], { lastCheckedAt: run.lastCheckedAt })).toMatch(/No sources refreshed/);
});

test('empty source check is not described as success', async () => {
  const { refreshSummary } = await import('../src/source-status.ts');
  expect(refreshSummary([])).toMatch(/No sources refreshed/);
  expect(refreshSummary([{ id: 'hotpads', status: 'updated' }])).toMatch(/limited samples/);
});

test('source coverage identifies sample caps without promising complete inventory', async () => {
  const { sourceCoverage } = await import('../src/source-status.ts');
  const text = sourceCoverage({ id: 'openigloo', listingCount: 40, total: 3324, sampleLimit: 40 });
  expect(text).toMatch(/Provider reported 3,324 records/);
  expect(text).toMatch(/sample capped at 40/);
  expect(text).toMatch(/counts do not prove complete coverage/);
});
test('failed attempts label retained coverage as the last saved snapshot', async () => {
  const { sourceCoverage } = await import('../src/source-status.ts');
  expect(sourceCoverage({ id: 'hotpads', status: 'failed', pages: 3 })).toMatch(/^Last saved snapshot: 3 pages fetched/);
  expect(sourceCoverage({ id: 'empty', total: 0 })).toMatch(/Provider reported 0 records/);
  expect(sourceCoverage({ id: 'unknown', total: NaN, pages: -1, sampleLimit: Infinity })).toBe('');
  expect(sourceCoverage()).toBe('');
});
