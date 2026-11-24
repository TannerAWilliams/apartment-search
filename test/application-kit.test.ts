import { expect, test } from 'bun:test';
import { emptyProfile, incomeCheck, inquiryText, profileText } from '../src/application-kit.ts';

test('the income rule: 40 times the rent for the renter, 80 times for a guarantor', () => {
  expect(incomeCheck('')).toBeNull();
  expect(incomeCheck('abc')).toBeNull();
  expect(incomeCheck('$120,000')).toEqual({ maxRent: 3000 });
  expect(incomeCheck('120000', 3000)).toEqual({ maxRent: 3000, qualifies: true, needed: 120000, guarantorNeeds: 240000 });
  expect(incomeCheck('100000', 3000)?.qualifies).toBe(false);
});

test('the profile and the inquiry leave out what was not filled in', () => {
  const profile = { ...emptyProfile(), name: 'Alex Rivera', email: 'alex@example.com', annualIncome: '120000', employer: 'Acme' };
  expect(profileText(profile)).toBe('Alex Rivera\nalex@example.com\nWorks at Acme\nAnnual income: $120,000');
  expect(profileText({ ...profile, jobTitle: 'Designer', pets: 'One cat' })).toContain(
    'Works at Acme as Designer\nAnnual income: $120,000\nPets: One cat',
  );
  const message = inquiryText(profile, { address: '1 Bank Street', unit: '4B', rent: 3000, bedrooms: 1 });
  expect(message).toStartWith("Hi,\n\nI'm interested in 1 Bank Street, Unit 4B (1 bedroom, $3,000 a month).");
  expect(message).toEndWith('Thank you,\nAlex Rivera');
  expect(inquiryText(emptyProfile(), { address: '1 Bank Street', rent: 2000, bedrooms: 0 })).toEndWith('Thank you,');
});
