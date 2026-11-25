import { expect, test } from 'bun:test';
import { wholeNumber } from '../src/whole-number.ts';

test('a typed number keeps its digits and never goes above the most', () => {
  expect(wholeNumber('$3,500', 100000)).toBe('3500');
  expect(wholeNumber('250000', 100000)).toBe('100000');
  expect(wholeNumber('007', 180)).toBe('7');
  expect(wholeNumber('0', 180)).toBe('');
  expect(wholeNumber('abc', 180)).toBe('');
});
