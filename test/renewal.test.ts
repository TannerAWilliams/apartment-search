import { expect, test } from 'bun:test';
import { renewalAdvice } from '../src/renewal.ts';

test('a renewal is compared with similar apartments listed now, or the Rent Guidelines Board for stabilized leases', () => {
  expect(renewalAdvice(3000, 3500, 10, true)[0]).toMatch(/3% for a one-year lease \(\$3,090\) or 4.5% for two years \(\$3,135\)/);
  expect(renewalAdvice(3000, null, 0, false)).toEqual([
    'Too few similar apartments are listed here to compare. Try a nearby neighborhood.',
  ]);
  expect(renewalAdvice(3000, 3500, 2, false)[0]).toMatch(/Too few/);
  expect(renewalAdvice(4000, 3500, 10, false)).toEqual([
    'You pay 14% more than the $3,500 median of 10 similar apartments listed now.',
    'Ask for a renewal at or below your current rent, and mention the listings. Moving could save about $500 a month.',
  ]);
  expect(renewalAdvice(3000, 3500, 10, false)[0]).toBe('You pay 14% less than the $3,500 median of 10 similar apartments listed now.');
  expect(renewalAdvice(3450, 3500, 10, false)[0]).toBe('Your rent is close to the $3,500 median of 10 similar apartments listed now.');
});
