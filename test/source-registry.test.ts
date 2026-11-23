import { expect, test } from 'bun:test';
import { required } from './test-values.ts';
import { COMPLETE_SYNCS, isCompleteCoverage, isCompleteSnapshot } from '../server/source-registry.ts';
import { refreshCatalog } from '../server/refresh.ts';

test('every complete sync is a resyncable catalog source with its own transport', () => {
  const catalog = refreshCatalog({});
  for (const sync of COMPLETE_SYNCS) {
    const entry = catalog.find(({ id }) => id === sync.id);
    expect(entry?.resyncable, `${sync.id} is in the refresh catalog`).toBeTruthy();
    expect(required(entry).coverage, `${sync.id} coverage matches`).toBe(sync.coverage);
  }
  expect(new Set(COMPLETE_SYNCS.map(({ transport }) => transport)).size).toBe(COMPLETE_SYNCS.length);
});

test('only the recorded transport marks a snapshot complete', () => {
  const [first] = COMPLETE_SYNCS;
  expect(isCompleteSnapshot(first.id, first.transport)).toBeTruthy();
  expect(!isCompleteSnapshot(first.id, undefined)).toBeTruthy();
  expect(!isCompleteSnapshot('trulia-live', first.transport)).toBeTruthy();
  expect(isCompleteCoverage(first.coverage)).toBeTruthy();
  expect(!isCompleteCoverage('first two pages')).toBeTruthy();
});

test('the app knows every background complete sync and checks on it at least as long as it can run', async () => {
  const { LONG_SYNC_LIMITS } = await import('../src/source-status.ts');
  expect(Object.keys(LONG_SYNC_LIMITS).sort()).toStrictEqual(COMPLETE_SYNCS.map(({ id }) => id).sort());
  for (const sync of COMPLETE_SYNCS) expect(LONG_SYNC_LIMITS[sync.id] >= sync.timeoutMs, `${sync.id} is checked long enough`).toBeTruthy();
});
