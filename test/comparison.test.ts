import { expect, test } from 'bun:test';
import { comparisonOptions, comparisonRows, comparisonTitle, toggleComparison } from '../src/comparison.ts';
import type { ListingData } from '../src/domain.ts';
/** Device storage can hold incomplete listings from older versions, which comparison must still describe. */
const stored = (fields: object) => fields as ListingData;
const unit = (id = '1') => stored({ id, address: '12 Grove Street', unit: id, zip: '07302', city: 'Jersey City', state: 'NJ' });
test('selection toggles, caps at four, deduplicates and removes unavailable keys without mutating', () => {
  const keys = ['a', 'a', 'missing'];
  expect(toggleComparison(keys, 'b', ['a', 'b'])).toStrictEqual(['a', 'b']);
  expect(keys).toStrictEqual(['a', 'a', 'missing']);
  expect(toggleComparison(['a', 'b'], 'a', ['a', 'b'])).toStrictEqual(['b']);
  expect(toggleComparison(['a', 'b', 'c', 'd'], 'e', ['a', 'b', 'c', 'd', 'e'])).toStrictEqual(['a', 'b', 'c', 'd']);
  expect(toggleComparison([], 'bad', ['a'])).toStrictEqual([]);
});
test('search options match address/unit/city/ZIP case-insensitively and deduplicate units', () => {
  const first = unit();
  expect(comparisonTitle(first)).toBe('12 Grove Street, Unit 1, Jersey City');
  expect(comparisonTitle({ address: '12 Grove Street' })).toBe('12 Grove Street');
  for (const query of [' grove ', 'UNIT 1', '07302', 'jersey'])
    expect(comparisonOptions([first, stored({ ...first, id: 'duplicate' })], query).length).toBe(1);
  expect(comparisonOptions([first], 'unknown').length).toBe(0);
});
test('comparison keeps unknown facts unknown, fee basis and historic prices explicit', () => {
  const unknown = Object.fromEntries(comparisonRows(unit()));
  for (const field of ['Monthly advertised price', 'Bathrooms', 'Area', 'Pets', 'Laundry', 'Source checks'])
    expect(unknown[field]).toBe('Unknown');
  expect(unknown.Bedrooms).toBe('Beds unknown');
  const known = Object.fromEntries(
    comparisonRows(
      stored({
        ...unit(),
        rent: 2000,
        bedrooms: 0,
        bathrooms: 1.5,
        squareFeet: 850,
        petsAllowed: true,
        laundry: 'in_unit',
        priceIncludesFees: true,
        checkedAt: '2026-01-02T12:00:00Z',
      }),
    ),
  );
  expect(known['Monthly advertised price']).toBe('$2,000/mo');
  expect(known['Price basis']).toBe('Includes reported fees');
  expect(known.Bathrooms).toBe('1.5');
  expect(known.Area).toBe('850 sq ft');
  expect(known.Pets).toMatch(/verify restrictions/);
  expect(known.Laundry).toBe('In-unit laundry');
  expect(known['Source checks']).toBe('Jan 2, 2026 ET');
  const historic = Object.fromEntries(
    comparisonRows(stored({ ...unit(), kind: 'snapshot', petsAllowed: false, seenAt: '2026-01-02', discoveryConflicts: ['petsAllowed'] })),
  );
  expect(historic['Price basis']).toBe('Historical recorded rent');
  expect(historic.Pets).toBe('Unknown');
  expect(historic.Cautions).toMatch(/Sources disagree/);
  expect(Object.fromEntries(comparisonRows(stored({ ...unit(), petsAllowed: false }))).Pets).toBe('Reported not allowed');
  expect(Object.fromEntries(comparisonRows(stored({ ...unit(), checkedAt: 1 })))['Source checks']).toBe('Unknown');
});
