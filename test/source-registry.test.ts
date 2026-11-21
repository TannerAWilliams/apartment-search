import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { COMPLETE_SYNCS, isCompleteCoverage, isCompleteSnapshot } from '../server/source-registry.ts';
import { refreshCatalog } from '../server/refresh.ts';

test('every complete sync is a resyncable catalog source with its own transport', () => {
  const catalog = refreshCatalog({});
  for (const sync of COMPLETE_SYNCS) {
    const entry = catalog.find(({ id }) => id === sync.id);
    assert.ok(entry?.resyncable, `${sync.id} is in the refresh catalog`);
    assert.equal(entry.coverage, sync.coverage, `${sync.id} coverage matches`);
  }
  assert.equal(new Set(COMPLETE_SYNCS.map(({ transport }) => transport)).size, COMPLETE_SYNCS.length);
});

test('only the recorded transport marks a snapshot complete', () => {
  const [first] = COMPLETE_SYNCS;
  assert.ok(isCompleteSnapshot(first.id, first.transport));
  assert.ok(!isCompleteSnapshot(first.id, undefined));
  assert.ok(!isCompleteSnapshot('trulia-live', first.transport));
  assert.ok(isCompleteCoverage(first.coverage));
  assert.ok(!isCompleteCoverage('first two pages'));
});
