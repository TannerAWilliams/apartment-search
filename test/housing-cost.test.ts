import { expect, test } from 'bun:test';
import { calculateHousingCost, emptyHousingCosts, HOUSING_COST_FIELDS } from '../src/housing-cost.ts';
const example = () => ({
  grossMonthlyRent: '3000',
  leaseMonths: '12',
  totalConcessions: '3000',
  monthlyFees: '50',
  nonrefundableUpfrontFees: '200',
  refundableDeposit: '3000',
  rentDueAtSigning: '3000',
  recurringFeesDueAtSigning: '50',
});
test('separates recurring rent, average cost, total cost and cash including refundable deposit', () => {
  expect(calculateHousingCost(example()).estimate).toStrictEqual({
    leaseCostCents: 3380000,
    effectiveMonthlyCents: 281667,
    recurringMonthlyCents: 305000,
    cashAtSigningCents: 625000,
    refundableDepositCents: 300000,
  });
});
test('every blank amount remains unknown, including whitespace', () => {
  expect(calculateHousingCost(emptyHousingCosts()).missing.length).toBe(8);
  for (const [key] of HOUSING_COST_FIELDS) {
    const result = calculateHousingCost({ ...example(), [key]: ' ' });
    expect(result.missing).toStrictEqual([key]);
    expect(result.estimate).toBeNull();
  }
});
test('zero fees and concessions are valid and deposit does not increase lease cost', () => {
  const input = {
    ...example(),
    monthlyFees: '0',
    totalConcessions: '0',
    nonrefundableUpfrontFees: '0',
    refundableDeposit: '0',
    rentDueAtSigning: '0',
    recurringFeesDueAtSigning: '0',
  };
  expect(calculateHousingCost(input).estimate?.leaseCostCents).toBe(3600000);
  expect(calculateHousingCost(input).estimate?.cashAtSigningCents).toBe(0);
  expect(calculateHousingCost({ ...input, refundableDeposit: '2000' }).estimate?.leaseCostCents).toBe(3600000);
});
test('rejects symbols, exponent notation, negatives, nonfinite and excess precision on all money fields', () => {
  for (const [key] of HOUSING_COST_FIELDS.filter(([key]) => key !== 'leaseMonths')) {
    for (const bad of ['$100', '1,000', '-1', 'NaN', 'Infinity', '1e3', '1.234', '.50', '1.', '1000001']) {
      const result = calculateHousingCost({ ...example(), [key]: bad });
      expect(result.errors[key], key + ':' + bad).toBeTruthy();
      expect(result.estimate).toBeNull();
    }
  }
});
test('lease term and rent must be positive and term is bounded and integral', () => {
  for (const bad of ['0', '121', '12.5', '-1', '1e2'])
    expect(calculateHousingCost({ ...example(), leaseMonths: bad }).errors.leaseMonths).toBeTruthy();
  expect(calculateHousingCost({ ...example(), grossMonthlyRent: '0' }).errors.grossMonthlyRent).toBeTruthy();
  expect(calculateHousingCost({ ...example(), leaseMonths: '120' }).estimate?.leaseCostCents).toBe(36320000);
});
test('concessions and signing rent cannot exceed gross lease rent', () => {
  expect(calculateHousingCost({ ...example(), totalConcessions: '36000.01' }).errors.totalConcessions).toBeTruthy();
  expect(calculateHousingCost({ ...example(), rentDueAtSigning: '36000.01' }).errors.rentDueAtSigning).toBeTruthy();
  expect(calculateHousingCost({ ...example(), totalConcessions: '36000' }).estimate?.leaseCostCents).toBe(80000);
});
test('uses cents for decimals, trims whitespace, rounds monthly average once', () => {
  const result = calculateHousingCost({
    grossMonthlyRent: ' 1000.01 ',
    leaseMonths: '3',
    totalConcessions: '0.01',
    monthlyFees: '0.10',
    nonrefundableUpfrontFees: '0.02',
    refundableDeposit: '0.03',
    rentDueAtSigning: '1000.01',
    recurringFeesDueAtSigning: '0.10',
  });
  expect(result.estimate).toStrictEqual({
    leaseCostCents: 300034,
    effectiveMonthlyCents: 100011,
    recurringMonthlyCents: 100011,
    cashAtSigningCents: 100016,
    refundableDepositCents: 3,
  });
});
test('upper currency bound accepted without unsafe integer arithmetic', () => {
  const result = calculateHousingCost({ ...example(), grossMonthlyRent: '1000000', leaseMonths: '120' });
  expect(Number.isSafeInteger(result.estimate?.leaseCostCents)).toBeTruthy();
});

test('signing recurring fees cannot exceed lease recurring fees', () => {
  expect(calculateHousingCost({ ...example(), recurringFeesDueAtSigning: '600.01' }).errors.recurringFeesDueAtSigning).toBeTruthy();
  expect(calculateHousingCost({ ...example(), recurringFeesDueAtSigning: '600' }).estimate?.cashAtSigningCents).toBe(680000);
});
