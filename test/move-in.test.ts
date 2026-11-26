import { expect, test } from 'bun:test';
import { typicalCosts } from '../src/move-in.ts';

test('typical monthly and move-in costs follow the bedroom count and the state’s rules', () => {
  const nyc = typicalCosts({ rent: 3000, bedrooms: 2, state: 'NY', region: 'nyc' });
  expect(nyc.monthly).toBe(3000 + 140 + 60 + 15);
  expect(nyc.moveIn).toBe(3000 + 3000 + 20);
  expect(nyc.possibleBrokerFee).toBe(0);
  expect(nyc.notes.join(' ')).toMatch(/one month’s rent and the application fee at \$20.*FARE Act.*net effective/);
  const jersey = typicalCosts({ rent: 2000, bedrooms: 0, state: 'nj', region: 'nj', priceIncludesFees: true });
  expect(jersey.moveInParts).toEqual({ firstMonth: 2000, deposit: 3000, applicationFee: 50 });
  expect(jersey.possibleBrokerFee).toBe(2000);
  expect(jersey.notes.join(' ')).toMatch(/1.5 months’ rent.*broker fee, often about one month’s rent \(\$2,000\).*already includes/);
  expect(typicalCosts({ rent: 2000, bedrooms: 7, state: 'CT' }).moveInParts.deposit).toBe(4000);
  expect(typicalCosts({ rent: 2000, bedrooms: 7, state: 'CT' }).parts.utilities).toBe(200);
});

test('a broker fee is also shown as a monthly cost, spread over a year; none where no fee is paid', () => {
  expect(typicalCosts({ rent: 3000, bedrooms: 2, state: 'NY', region: 'nyc' }).monthlyWithFee).toBeNull();
  const jersey = typicalCosts({ rent: 2400, bedrooms: 1, state: 'NJ', region: 'nj' });
  expect(jersey.monthlyWithFee).toBe(jersey.monthly + 200);
});
