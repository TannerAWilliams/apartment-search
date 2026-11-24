import { expect, test } from 'bun:test';
import { affordability, bracketTax, takeHome } from '../src/affordability.ts';

test('brackets tax each slice of income at its own rate', () => {
  const brackets: [number, number][] = [
    [10, 0.1],
    [20, 0.2],
    [Infinity, 0.5],
  ];
  expect(bracketTax(0, brackets)).toBe(0);
  expect(bracketTax(15, brackets)).toBeCloseTo(2);
  expect(bracketTax(30, brackets)).toBeCloseTo(8);
});

test('take-home pay for a single filer in New York City, New York State, New Jersey and Connecticut', () => {
  const city = takeHome(100_000, 'nyc');
  // Federal: (100,000 − 15,750) through the 2025 brackets.
  expect(Math.round(city.federal)).toBe(13_449);
  expect(Math.round(city.payroll)).toBe(7_650);
  expect(Math.round(city.state)).toBe(4_952);
  expect(Math.round(city.city)).toBe(3_441);
  expect(Math.round(city.yearly)).toBe(70_508);
  expect(takeHome(100_000, 'ny').city).toBe(0);
  expect(Math.round(takeHome(100_000, 'nj').state)).toBe(4_180);
  expect(Math.round(takeHome(100_000, 'ct').state)).toBe(4_750);
  // Above the Social Security cap, and the additional Medicare tax over $200,000.
  expect(Math.round(takeHome(300_000, 'nyc').payroll)).toBe(Math.round(176_100 * 0.062 + 300_000 * 0.0145 + 100_000 * 0.009));
  // A 401(k) lowers income tax but not payroll tax.
  expect(takeHome(100_000, 'nyc', 10_000).federal).toBeLessThan(city.federal);
  expect(takeHome(100_000, 'nyc', 10_000).payroll).toBe(city.payroll);
  expect(takeHome(0, 'nyc').yearly).toBe(0);
});

test('what an income affords by the landlord rule, the guarantor rule and Dave Ramsey’s 25%', () => {
  const result = affordability(120_000, 'nyc');
  expect(result.landlord).toBe(3_000);
  expect(result.guarantorIncome).toBe(240_000);
  expect(result.ramsey).toBeLessThan(result.landlord);
  expect(result.ramsey % 25).toBe(0);
  expect(affordability(120_000, 'nyc', { monthlyTakeHome: 6_000 })).toMatchObject({ ramsey: 1_500, takeHome: 6_000 });
});
