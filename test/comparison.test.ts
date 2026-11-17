import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonOptions, comparisonRows, comparisonTitle, toggleComparison } from '../src/comparison.ts';
const unit = (id = '1') => ({ id, address: '12 Grove Street', unit: id, zip: '07302', city: 'Jersey City', state: 'NJ' });
test('selection toggles, caps at four, deduplicates and removes unavailable keys without mutating', () => {
  const keys = ['a', 'a', 'missing'];
  assert.deepEqual(toggleComparison(keys, 'b', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(keys, ['a', 'a', 'missing']);
  assert.deepEqual(toggleComparison(['a', 'b'], 'a', ['a', 'b']), ['b']);
  assert.deepEqual(toggleComparison(['a', 'b', 'c', 'd'], 'e', ['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(toggleComparison([], 'bad', ['a']), []);
});
test('search options match address/unit/city/ZIP case-insensitively and deduplicate units', () => {
  const first = unit();
  assert.equal(comparisonTitle(first), '12 Grove Street, Unit 1, Jersey City');
  assert.equal(comparisonTitle({ address: '12 Grove Street' }), '12 Grove Street');
  for (const query of [' grove ', 'UNIT 1', '07302', 'jersey']) assert.equal(comparisonOptions([first, { ...first, id: 'duplicate' }], query).length, 1);
  assert.equal(comparisonOptions([first], 'unknown').length, 0);
});
test('comparison keeps unknown facts unknown, fee basis and historic prices explicit', () => {
  const unknown = Object.fromEntries(comparisonRows(unit()));
  for (const field of ['Monthly advertised price', 'Bathrooms', 'Area', 'Pets', 'Laundry', 'Source checks']) assert.equal(unknown[field], 'Unknown');
  assert.equal(unknown.Bedrooms, 'Beds unknown');
  const known = Object.fromEntries(comparisonRows({ ...unit(), rent: 2000, bedrooms: 0, bathrooms: 1.5, squareFeet: 850, petsAllowed: true, laundry: 'in_unit', priceIncludesFees: true, checkedAt: '2026-01-02T12:00:00Z' }));
  assert.equal(known['Monthly advertised price'], '$2,000/mo'); assert.equal(known['Price basis'], 'Includes reported fees');
  assert.equal(known.Bathrooms, '1.5'); assert.equal(known.Area, '850 sq ft'); assert.match(known.Pets, /verify restrictions/); assert.equal(known.Laundry, 'In-unit laundry');
  assert.equal(known['Source checks'], 'Jan 2, 2026 ET');
  const historic = Object.fromEntries(comparisonRows({ ...unit(), kind: 'snapshot', petsAllowed: false, seenAt: '2026-01-02', discoveryConflicts: ['petsAllowed'] }));
  assert.equal(historic['Price basis'], 'Historical recorded rent'); assert.equal(historic.Pets, 'Unknown'); assert.match(historic.Cautions, /Sources disagree/);
  assert.equal(Object.fromEntries(comparisonRows({ ...unit(), petsAllowed: false })).Pets, 'Reported not allowed');
  assert.equal(Object.fromEntries(comparisonRows({ ...unit(), checkedAt: 1 }))['Source checks'], 'Unknown');
});
