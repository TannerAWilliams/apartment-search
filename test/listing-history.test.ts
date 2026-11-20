import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { recordListingHistory, MAX_HISTORY_UNITS } from '../server/listing-history.ts';
const unit = (rent = 2000, id = 'feed:1') => ({ id, address: '12 Grove Street', unit: '2', city: 'Jersey City', state: 'NJ', zip: '07302', rent });
const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
test('records only successful observations and price/basis changes, with first/last check timestamps', () => {
  const first = recordListingHistory([unit()], undefined, 'feed', at(1));
  const next = recordListingHistory([unit()], first.observationHistory, 'feed', at(2));
  assert.equal(next.listings[0].priceHistory.observations.length, 1);
  assert.equal(next.listings[0].priceHistory.firstObservedAt, at(1));
  assert.equal(next.listings[0].priceHistory.lastObservedAt, at(2));
  const cut = recordListingHistory([unit(1900)], next.observationHistory, 'feed', at(3));
  assert.deepEqual(cut.listings[0].priceHistory.observations.map((o: { rent: number }) => o.rent), [2000, 1900]);
  const fees = recordListingHistory([{ ...unit(1900), priceIncludesFees: true }], cut.observationHistory, 'feed', at(4));
  assert.equal(fees.listings[0].priceHistory.observations.length, 3);
  assert.equal(first.listings[0].priceHistory.lastObservedAt, at(1));
});
test('only current listings keep price history; a partial observation carries earlier ones forward', () => {
  const first = recordListingHistory([unit()], undefined, 'feed', at(1));
  const carried = recordListingHistory([], first.observationHistory, 'feed', at(2), { keepUnseen: true });
  assert.deepEqual(carried.observationHistory.entries, first.observationHistory.entries);
  const back = recordListingHistory([unit(2100)], carried.observationHistory, 'feed', at(3));
  assert.equal(back.listings[0].priceHistory.observations.length, 2);
  assert.equal('status' in back.listings[0].priceHistory, false);
  const missing = recordListingHistory([], back.observationHistory, 'feed', at(4));
  assert.equal(missing.listings.length, 0);
  assert.deepEqual(missing.observationHistory.entries, [], 'a listing gone from a complete observation keeps no history');
  const relisted = recordListingHistory([unit(2200)], missing.observationHistory, 'feed', at(5));
  assert.equal(relisted.listings[0].priceHistory.observations.length, 1);
  assert.equal(relisted.listings[0].priceHistory.firstObservedAt, at(5));
});
test('source and unit identity stay isolated; feed-supplied history is discarded', () => {
  const first = recordListingHistory([unit()], undefined, 'feed', at(1));
  const other = recordListingHistory([{ ...unit(), unit: '3', priceHistory: { forged: true } }], first.observationHistory, 'feed', at(2));
  assert.equal(other.listings[0].priceHistory.firstObservedAt, at(2));
  assert.equal(other.observationHistory.entries.length, 1, 'the unit no longer listed keeps no history');
  assert.throws(() => recordListingHistory([unit()], first.observationHistory, 'other', at(3)));
  const unknown = recordListingHistory([{ ...unit(NaN), priceHistory: { forged: true } }], undefined, 'feed', at(1));
  assert.equal('priceHistory' in unknown.listings[0], false);
});
test('bounded rolling price history labels truncation', () => {
  let history;
  for (let day = 1; day <= 30; day++) history = recordListingHistory([unit(2000 + day)], history?.observationHistory, 'feed', at(day));
  assert.equal(required(history).listings[0].priceHistory.observations.length, 24);
  assert.equal(required(history).listings[0].priceHistory.truncated, true);
  assert.equal(required(history).listings[0].priceHistory.firstObservedAt, at(1));
  const many = recordListingHistory(Array.from({ length: MAX_HISTORY_UNITS + 1 }, (_, i) => unit(2000, `feed:${i}`)), undefined, 'feed', at(1));
  assert.equal(many.observationHistory.entries.length, MAX_HISTORY_UNITS);
  assert.equal(many.observationHistory.truncated, true);
});
test('invalid timestamps, schema and malformed history fail closed', () => {
  assert.throws(() => recordListingHistory([], undefined, '', at(1)));
  assert.throws(() => recordListingHistory([], undefined, 'feed', 'bad'));
  assert.throws(() => recordListingHistory([], { version: 2, entries: [] } as any, 'feed', at(1)));
  assert.throws(() => recordListingHistory([], { version: 1, entries: null } as any, 'feed', at(1)));
  const first = recordListingHistory([unit()], undefined, 'feed', at(2));
  assert.throws(() => recordListingHistory([unit()], first.observationHistory, 'feed', at(1)));
  for (const patch of [{ identity: '' }, { observations: null }, { firstObservedAt: 'bad' }, { lastObservedAt: 'bad' },
    { observations: [{ rent: -1, checkedAt: at(1), priceIncludesFees: false }] },
    { observations: [{ rent: 2000, checkedAt: 'bad', priceIncludesFees: false }] },
    { observations: [{ rent: 2000, checkedAt: at(1), priceIncludesFees: 'yes' }] }]) {
    assert.throws(() => recordListingHistory([], { ...first.observationHistory, entries: [{ ...first.observationHistory.entries[0], ...patch }] } as any, 'feed', at(3)));
  }
});
test('duplicate unit identities cannot create conflicting observations in one refresh', () => {
  assert.throws(() => recordListingHistory([unit(), unit(1900)], undefined, 'feed', at(1)), /Duplicate unit/);
});

test('older empty snapshots cannot overwrite newer observations or successful empty checks', () => {
  const newer = recordListingHistory([unit()], undefined, 'feed', at(3));
  assert.throws(() => recordListingHistory([], newer.observationHistory, 'feed', at(2)));
  const empty = recordListingHistory([], undefined, 'feed', at(3));
  assert.throws(() => recordListingHistory([], empty.observationHistory, 'feed', at(2)));
});
