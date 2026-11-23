import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { checkObservedChanges, parseChangeBaseline, MAX_BASELINE_UNITS } from '../src/observed-changes.ts';
import { testListing } from './fixtures/listing.ts';
const unit = (rent = 2000, day = 1, id = '1', includesFees = false, sourceId = 'feed') => {
  const date = new Date(Date.UTC(2026, 0, day)).toISOString();
  return testListing({ id, address: '12 Grove Street', unit: id, city: 'Jersey City', state: 'NJ', zip: '07302', rent, priceIncludesFees: includesFees,
    priceHistory: { sourceId, firstObservedAt: date, lastObservedAt: date, truncated: false, observations: [{ checkedAt: date, rent, priceIncludesFees: includesFees }] } });
};
test('first opted-in check seeds without alerts; subsequent newer same-basis observations produce changes', () => {
  const first = checkObservedChanges([unit()], null);
  assert.equal(first.changes.length, 0); assert.equal(first.eligible, 1);
  assert.deepEqual(parseChangeBaseline(JSON.stringify(first.baseline)), first.baseline);
  const next = checkObservedChanges([unit(1900, 2), unit(2100, 2, '2')], first.baseline);
  assert.deepEqual(next.changes.map(c => c.kind), ['price', 'newly_encountered']);
  assert.equal(next.changes[0].previous!.rent, 2000);
  assert.equal(first.baseline.observations[0].rent, 2000);
  assert.equal(checkObservedChanges([unit(1900, 3)], next.baseline).changes.length, 0);
});
test('absence, duplicate units and older/equal snapshots never imply delisted or roll back observations', () => {
  const first = checkObservedChanges([unit(1900, 3)], null);
  assert.equal(checkObservedChanges([], first.baseline).changes.length, 0);
  assert.deepEqual(checkObservedChanges([], first.baseline).baseline, first.baseline);
  for (const day of [1, 3]) assert.deepEqual(checkObservedChanges([unit(2500, day)], first.baseline).baseline, first.baseline);
  const next = checkObservedChanges([unit(1800, 4), unit(1800, 4)], first.baseline);
  assert.equal(next.changes.length, 1); assert.equal(next.eligible, 1);
});
test('fee-basis changes are not mislabeled price savings; source changes stay isolated', () => {
  const first = checkObservedChanges([unit()], null).baseline;
  const fees = checkObservedChanges([unit(1900, 2, '1', true)], first);
  assert.equal(fees.changes[0].kind, 'fee_basis');
  const source = checkObservedChanges([unit(1900, 2, '1', false, 'other')], first);
  assert.equal(source.changes[0].kind, 'newly_encountered');
  assert.equal(source.baseline.observations.length, 2);
});
test('unknown or mismatched price-history observations are excluded', () => {
  const invalid = [{ ...unit(), priceHistory: null }, { ...unit(), rent: 1 }, { ...unit(), priceIncludesFees: true }, unit(100001)];
  assert.equal(checkObservedChanges(invalid, null).eligible, 0);
});
test('bounded retention labels possible re-encounters rather than hiding eviction', () => {
  const result = checkObservedChanges(Array.from({ length: MAX_BASELINE_UNITS + 1 }, (_, i) => unit(2000, 1, String(i))), null);
  assert.equal(result.baseline.observations.length, MAX_BASELINE_UNITS); assert.equal(result.baseline.truncated, true);
});
test('malformed local data fails closed rather than replacing the baseline', () => {
  assert.equal(parseChangeBaseline(null), null);
  const good = checkObservedChanges([unit()], null).baseline;
  for (const raw of ['{', 'null', JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, truncated: 'no' }), JSON.stringify({ ...good, observations: {} }), JSON.stringify({ ...good, observations: [good.observations[0], good.observations[0]] }), 'x'.repeat(33554433)]) assert.throws(() => parseChangeBaseline(raw));
  for (const patch of [{ key: '' }, { key: 'x'.repeat(1001) }, { label: 1 }, { label: 'x'.repeat(501) }, { sourceId: '' }, { sourceId: 'x'.repeat(201) }, { checkedAt: 1 }, { checkedAt: 'bad' }, { rent: -1 }, { rent: 100001 }, { includesFees: 'yes' }]) {
    assert.throws(() => parseChangeBaseline(JSON.stringify({ ...good, observations: [{ ...good.observations[0], ...patch }] })));
  }
});

test('generated observations obey the read schema and oversized identities never poison the baseline', () => {
  const oversizedLabel = { ...unit(), address: 'x'.repeat(501) };
  const oversizedKey = { ...unit(), id: 'x'.repeat(1001), unit: '' };
  const first = checkObservedChanges([unit(), oversizedLabel, oversizedKey], null);
  assert.equal(first.eligible, 1);
  assert.deepEqual(parseChangeBaseline(JSON.stringify(first.baseline)), first.baseline);
  const escaped = { ...unit(), address: '\u0000'.repeat(100) };
  const next = checkObservedChanges([escaped], first.baseline);
  assert.deepEqual(parseChangeBaseline(JSON.stringify(next.baseline)), next.baseline);
});
