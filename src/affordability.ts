/**
 * What rent an income affords, three ways:
 * - landlords' rule: a yearly income of 40 times the monthly rent (the same as rent at 30% of gross pay);
 * - a guarantor's: 80 times the rent;
 * - Dave Ramsey's: housing at no more than 25% of take-home pay.
 * Take-home pay is estimated for a single filer taking the standard deduction, with 2025 federal, Social Security,
 * Medicare, state and New York City income tax. It is an estimate for planning, not tax advice; someone who knows
 * their take-home pay can enter it instead.
 */

export type Residence = 'nyc' | 'ny' | 'nj' | 'ct';
export const RESIDENCES: [Residence, string][] = [
  ['nyc', 'New York City'],
  ['ny', 'New York State, outside NYC'],
  ['nj', 'New Jersey'],
  ['ct', 'Connecticut'],
];

type Bracket = [upTo: number, rate: number];
/** Tax on an amount through brackets of [upper limit, rate]; the last bracket has no limit. */
export function bracketTax(amount: number, brackets: Bracket[]) {
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of brackets) {
    if (amount <= lower) break;
    tax += (Math.min(amount, upTo) - lower) * rate;
    lower = upTo;
  }
  return tax;
}

const FEDERAL_DEDUCTION = 15_750;
const FEDERAL: Bracket[] = [
  [11_925, 0.1],
  [48_475, 0.12],
  [103_350, 0.22],
  [197_300, 0.24],
  [250_525, 0.32],
  [626_350, 0.35],
  [Infinity, 0.37],
];
const SOCIAL_SECURITY_CAP = 176_100;
const NY_DEDUCTION = 8_000;
const NEW_YORK: Bracket[] = [
  [8_500, 0.04],
  [11_700, 0.045],
  [13_900, 0.0525],
  [80_650, 0.055],
  [215_400, 0.06],
  [1_077_550, 0.0685],
  [5_000_000, 0.0965],
  [25_000_000, 0.103],
  [Infinity, 0.109],
];
const NEW_YORK_CITY: Bracket[] = [
  [12_000, 0.03078],
  [25_000, 0.03762],
  [50_000, 0.03819],
  [Infinity, 0.03876],
];
const NJ_EXEMPTION = 1_000;
const NEW_JERSEY: Bracket[] = [
  [20_000, 0.014],
  [35_000, 0.0175],
  [40_000, 0.035],
  [75_000, 0.05525],
  [500_000, 0.0637],
  [1_000_000, 0.0897],
  [Infinity, 0.1075],
];
const CONNECTICUT: Bracket[] = [
  [10_000, 0.02],
  [50_000, 0.045],
  [100_000, 0.055],
  [200_000, 0.06],
  [250_000, 0.065],
  [500_000, 0.069],
  [Infinity, 0.0699],
];

/** The yearly taxes on a salary for a single filer, and what is left. `pretax` is yearly 401(k) or similar contributions. */
export function takeHome(gross: number, residence: Residence, pretax = 0) {
  const wages = Math.max(0, gross - pretax);
  const federal = bracketTax(Math.max(0, wages - FEDERAL_DEDUCTION), FEDERAL);
  const payroll = Math.min(gross, SOCIAL_SECURITY_CAP) * 0.062 + gross * 0.0145 + Math.max(0, gross - 200_000) * 0.009;
  const nyTaxable = Math.max(0, wages - NY_DEDUCTION);
  const state =
    residence === 'nj'
      ? bracketTax(Math.max(0, wages - NJ_EXEMPTION), NEW_JERSEY)
      : residence === 'ct'
        ? bracketTax(wages, CONNECTICUT)
        : bracketTax(nyTaxable, NEW_YORK);
  const city = residence === 'nyc' ? bracketTax(nyTaxable, NEW_YORK_CITY) : 0;
  const net = gross - pretax - federal - payroll - state - city;
  return { federal, payroll, state, city, yearly: net, monthly: net / 12 };
}

/** The most rent by each rule, a month, rounded down to $25. */
export function affordability(
  gross: number,
  residence: Residence,
  { pretax = 0, monthlyTakeHome }: { pretax?: number; monthlyTakeHome?: number } = {},
) {
  const round = (amount: number) => Math.max(0, Math.floor(amount / 25) * 25);
  const pay = monthlyTakeHome ?? takeHome(gross, residence, pretax).monthly;
  return {
    landlord: round(gross / 40),
    ramsey: round(pay * 0.25),
    takeHome: Math.round(pay),
    /** What a guarantor must earn for the landlord-rule rent. */
    guarantorIncome: round(gross / 40) * 80,
  };
}
