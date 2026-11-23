import { malformed, required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { recordListingHistory, MAX_HISTORY_UNITS, type ObservationHistory } from '../server/storage/listing-history.ts';
import { testListing } from './fixtures/listing.ts';
const unit = (rent = 2000, id = 'feed:1') =>
  testListing({ id, address: '12 Grove Street', unit: '2', city: 'Jersey City', state: 'NJ', zip: '07302', rent });
const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
test('records only successful observations and price/basis changes, with first/last check timestamps', () => {
  const first = recordListingHistory([unit()], undefined, 'feed', at(1));
  const next = recordListingHistory([unit()], first.observationHistory, 'feed', at(2));
  expect(next.listings[0].priceHistory?.observations.length).toBe(1);
  expect(next.listings[0].priceHistory?.firstObservedAt).toBe(at(1));
  expect(next.listings[0].priceHistory?.lastObservedAt).toBe(at(2));
  const cut = recordListingHistory([unit(1900)], next.observationHistory, 'feed', at(3));
  expect(cut.listings[0].priceHistory?.observations.map((o: { rent: number }) => o.rent)).toStrictEqual([2000, 1900]);
  const fees = recordListingHistory([{ ...unit(1900), priceIncludesFees: true }], cut.observationHistory, 'feed', at(4));
  expect(fees.listings[0].priceHistory?.observations.length).toBe(3);
  expect(first.listings[0].priceHistory?.lastObservedAt).toBe(at(1));
});
test('only current listings keep price history; a partial observation carries earlier ones forward', () => {
  const first = recordListingHistory([unit()], undefined, 'feed', at(1));
  const carried = recordListingHistory([], first.observationHistory, 'feed', at(2), { keepUnseen: true });
  expect(carried.observationHistory.entries).toStrictEqual(first.observationHistory.entries);
  const back = recordListingHistory([unit(2100)], carried.observationHistory, 'feed', at(3));
  expect(back.listings[0].priceHistory?.observations.length).toBe(2);
  expect(required(back.listings[0].priceHistory)).not.toHaveProperty('status');
  const missing = recordListingHistory([], back.observationHistory, 'feed', at(4));
  expect(missing.listings.length).toBe(0);
  expect(missing.observationHistory.entries, 'a listing gone from a complete observation keeps no history').toStrictEqual([]);
  const relisted = recordListingHistory([unit(2200)], missing.observationHistory, 'feed', at(5));
  expect(relisted.listings[0].priceHistory?.observations.length).toBe(1);
  expect(relisted.listings[0].priceHistory?.firstObservedAt).toBe(at(5));
});
test('source and unit identity stay isolated; feed-supplied history is discarded', () => {
  const first = recordListingHistory([unit()], undefined, 'feed', at(1));
  const other = recordListingHistory([{ ...unit(), unit: '3', priceHistory: { forged: true } }], first.observationHistory, 'feed', at(2));
  expect(other.listings[0].priceHistory?.firstObservedAt).toBe(at(2));
  expect(other.observationHistory.entries.length, 'the unit no longer listed keeps no history').toBe(1);
  expect(() => recordListingHistory([unit()], first.observationHistory, 'other', at(3))).toThrow();
  const unknown = recordListingHistory([{ ...unit(NaN), priceHistory: { forged: true } }], undefined, 'feed', at(1));
  expect('priceHistory' in unknown.listings[0]).toBe(false);
});
test('bounded rolling price history labels truncation', () => {
  let history: ReturnType<typeof recordListingHistory> | undefined;
  for (let day = 1; day <= 30; day++) history = recordListingHistory([unit(2000 + day)], history?.observationHistory, 'feed', at(day));
  expect(required(history).listings[0].priceHistory?.observations.length).toBe(24);
  expect(required(history).listings[0].priceHistory?.truncated).toBe(true);
  expect(required(history).listings[0].priceHistory?.firstObservedAt).toBe(at(1));
  const many = recordListingHistory(
    Array.from({ length: MAX_HISTORY_UNITS + 1 }, (_, i) => unit(2000, `feed:${i}`)),
    undefined,
    'feed',
    at(1),
  );
  expect(many.observationHistory.entries.length).toBe(MAX_HISTORY_UNITS);
  expect(many.observationHistory.truncated).toBe(true);
});
test('invalid timestamps, schema and malformed history fail closed', () => {
  expect(() => recordListingHistory([], undefined, '', at(1))).toThrow();
  expect(() => recordListingHistory([], undefined, 'feed', 'bad')).toThrow();
  expect(() => recordListingHistory([], malformed<ObservationHistory>({ version: 2, entries: [] }), 'feed', at(1))).toThrow();
  expect(() => recordListingHistory([], malformed<ObservationHistory>({ version: 1, entries: null }), 'feed', at(1))).toThrow();
  const first = recordListingHistory([unit()], undefined, 'feed', at(2));
  expect(() => recordListingHistory([unit()], first.observationHistory, 'feed', at(1))).toThrow();
  for (const patch of [
    { identity: '' },
    { observations: null },
    { firstObservedAt: 'bad' },
    { lastObservedAt: 'bad' },
    { observations: [{ rent: -1, checkedAt: at(1), priceIncludesFees: false }] },
    { observations: [{ rent: 2000, checkedAt: 'bad', priceIncludesFees: false }] },
    { observations: [{ rent: 2000, checkedAt: at(1), priceIncludesFees: 'yes' }] },
  ]) {
    expect(() =>
      recordListingHistory(
        [],
        malformed<ObservationHistory>({ ...first.observationHistory, entries: [{ ...first.observationHistory.entries[0], ...patch }] }),
        'feed',
        at(3),
      ),
    ).toThrow();
  }
});
test('duplicate unit identities cannot create conflicting observations in one refresh', () => {
  expect(() => recordListingHistory([unit(), unit(1900)], undefined, 'feed', at(1))).toThrow(/Duplicate unit/);
});

test('older empty snapshots cannot overwrite newer observations or successful empty checks', () => {
  const newer = recordListingHistory([unit()], undefined, 'feed', at(3));
  expect(() => recordListingHistory([], newer.observationHistory, 'feed', at(2))).toThrow();
  const empty = recordListingHistory([], undefined, 'feed', at(3));
  expect(() => recordListingHistory([], empty.observationHistory, 'feed', at(2))).toThrow();
});
