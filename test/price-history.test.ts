import test from 'node:test';
import assert from 'node:assert/strict';
import { displayPriceHistory } from '../src/price-history.ts';
const history = () => ({ sourceId: 'feed', firstObservedAt: '2026-01-01T00:00:00Z', lastObservedAt: '2026-01-03T00:00:00Z', truncated: false,
  observations: [{ checkedAt: '2026-01-01T00:00:00Z', rent: 2000, priceIncludesFees: false }, { checkedAt: '2026-01-02T00:00:00Z', rent: 1900, priceIncludesFees: true }] });
test('display history preserves actual observations and fee bases without mutating stored data', () => {
  const input = history(); const result = displayPriceHistory(input)!;
  assert.deepEqual(result, input); result.observations[0].rent = 1; assert.equal(input.observations[0].rent, 2000);
  assert.equal(displayPriceHistory({ ...input, truncated: true })?.truncated, true);
});
test('malformed or misleading histories show no recorded history rather than invented observations', () => {
  const input = history();
  for (const value of [null, 3, {}, { ...input, sourceId: '' }, { ...input, sourceId: 'x'.repeat(201) }, { ...input, sourceId: 2 },
    { ...input, firstObservedAt: 1 }, { ...input, lastObservedAt: 2 }, { ...input, firstObservedAt: 'bad' }, { ...input, lastObservedAt: 'bad' }, { ...input, firstObservedAt: '2027-01-01' },
    { ...input, truncated: 'no' }, { ...input, observations: null }, { ...input, observations: [] },
    { ...input, observations: Array(25).fill(input.observations[0]) }, { ...input, observations: [null] },
    ...[{ rent: NaN }, { rent: 0 }, { priceIncludesFees: 1 }, { checkedAt: 1 }, { checkedAt: 'bad' }, { checkedAt: '2025-01-01' }, { checkedAt: '2027-01-01' }].map(patch => ({ ...input, observations: [{ ...input.observations[0], ...patch }] })),
    { ...input, observations: [input.observations[1]] }, { ...input, observations: [...input.observations].reverse() }]) assert.equal(displayPriceHistory(value), null);
});
