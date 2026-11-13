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


test('partial refresh summary names blocked providers without claiming complete coverage', async () => {
  const { refreshSummary } = await import('../src/source-status.ts');
  const message = refreshSummary([
    { id: 'hotpads', status: 'updated', listingCount: 67 },
    { id: 'streeteasy-live', name: 'StreetEasy', status: 'failed' },
    { id: 'zillow', status: 'feed_required' },
  ]);
  assert.match(message, /1 sources have saved data/);
  assert.match(message, /StreetEasy could not refresh/);
  assert.match(message, /not complete coverage/);
  assert.doesNotMatch(message, /Zillow/);
});

test('empty source check is not described as success', async () => {
  const { refreshSummary } = await import('../src/source-status.ts');
  assert.match(refreshSummary([]), /No sources refreshed/);
  assert.match(refreshSummary([{ id: 'hotpads', status: 'updated' }]), /limited samples/);
});

test('source coverage identifies sample caps without promising complete inventory', async () => {
  const { sourceCoverage } = await import('../src/source-status.ts');
  const text = sourceCoverage({ id: 'openigloo', listingCount: 40, total: 3324, sampleLimit: 40 });
  assert.match(text, /Provider reported 3,324 records/);
  assert.match(text, /sample capped at 40/);
  assert.match(text, /counts do not prove complete coverage/);
});
test('failed attempts label retained coverage as the last saved snapshot', async () => {
  const { sourceCoverage } = await import('../src/source-status.ts');
  assert.match(sourceCoverage({ id: 'hotpads', status: 'failed', pages: 3 }), /^Last saved snapshot: 3 pages fetched/);
  assert.match(sourceCoverage({ id: 'empty', total: 0 }), /Provider reported 0 records/);
  assert.equal(sourceCoverage({ id: 'unknown', total: NaN, pages: -1, sampleLimit: Infinity }), '');
  assert.equal(sourceCoverage(), '');
});
