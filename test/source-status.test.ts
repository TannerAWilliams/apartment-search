import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRows } from '../src/source-status.ts';
test('source rows distinguish failed attempts, retained data and browse-only providers', () => {
  const rows = sourceRows([{ id: 'streeteasy-live', marketplace: 'streeteasy', name: 'StreetEasy', resyncable: true }], [{ id: 'streeteasy-live', status: 'failed', updatedAt: '2026-01-01', checkedAt: '2026-01-02', retryAt: '2026-01-03' }], { streeteasy: 'StreetEasy', zillow: 'Zillow' }, Date.parse('2026-01-02'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].state, 'Last attempt failed');
  assert.equal(rows[0].coolingDown, true);
  assert.equal(rows[0].status?.updatedAt, '2026-01-01');
  assert.equal(rows[1].resyncable, false);
  assert.equal(rows[1].state, 'Not connected');
});
test('a connected but never fetched provider remains actionable and is not labelled fresh', () => {
  const [row] = sourceRows([{ id: 'openigloo', name: 'Openigloo', resyncable: true }], [], {});
  assert.equal(row.state, 'Not fetched yet');
  assert.equal(row.coolingDown, false);
});
