/** User-entered estimates only. Blank values are unknown, never assumed to be zero. */
type HousingCostInput = {
  grossMonthlyRent: string;
  leaseMonths: string;
  totalConcessions: string;
  monthlyFees: string;
  nonrefundableUpfrontFees: string;
  refundableDeposit: string;
  rentDueAtSigning: string;
  recurringFeesDueAtSigning: string;
};
export const HOUSING_COST_FIELDS = [
  ['grossMonthlyRent', 'Gross monthly rent'],
  ['leaseMonths', 'Lease length in months'],
  ['totalConcessions', 'Total rent concessions over lease'],
  ['monthlyFees', 'Recurring monthly fees'],
  ['nonrefundableUpfrontFees', 'Nonrefundable upfront fees'],
  ['refundableDeposit', 'Refundable deposit'],
  ['rentDueAtSigning', 'Rent due at signing'],
  ['recurringFeesDueAtSigning', 'Recurring fees due at signing'],
] as const;
export const emptyHousingCosts = (): HousingCostInput =>
  Object.fromEntries(HOUSING_COST_FIELDS.map(([key]) => [key, ''])) as HousingCostInput;

export function calculateHousingCost(input: HousingCostInput) {
  const errors: Partial<Record<keyof HousingCostInput, string>> = {};
  const missing: (keyof HousingCostInput)[] = [];
  const values: Partial<Record<keyof HousingCostInput, number>> = {};
  for (const [key, label] of HOUSING_COST_FIELDS) {
    const raw = input[key]?.trim();
    if (!raw) {
      missing.push(key);
      continue;
    }
    const months = key === 'leaseMonths';
    if (!(months ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(raw)) {
      errors[key] = `${label}: enter ${months ? 'whole months' : 'a dollar amount with at most two decimals'}, without symbols.`;
      continue;
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount > (months ? 120 : 1000000) || ((months || key === 'grossMonthlyRent') && amount <= 0)) {
      errors[key] =
        `${label}: enter ${months ? '1–120 months' : key === 'grossMonthlyRent' ? 'more than $0 and at most $1,000,000' : '$0–$1,000,000'}.`;
      continue;
    }
    values[key] = months ? amount : Math.round(amount * 100);
  }
  const {
    grossMonthlyRent: rent,
    leaseMonths: months,
    totalConcessions: concessions,
    monthlyFees: fees,
    nonrefundableUpfrontFees: upfront,
    refundableDeposit: deposit,
    rentDueAtSigning: signing,
    recurringFeesDueAtSigning: signingFees,
  } = values;
  if (rent !== undefined && months !== undefined && concessions !== undefined && concessions > rent * months) {
    errors.totalConcessions = 'Concessions cannot exceed the gross rent for the entire lease.';
  }
  if (rent !== undefined && months !== undefined && signing !== undefined && signing > rent * months) {
    errors.rentDueAtSigning = 'Rent due at signing cannot exceed gross rent for the entire lease.';
  }
  if (fees !== undefined && months !== undefined && signingFees !== undefined && signingFees > fees * months) {
    errors.recurringFeesDueAtSigning = 'Recurring fees due at signing cannot exceed recurring fees for the entire lease.';
  }
  if (Object.keys(errors).length || missing.length) return { errors, missing, estimate: null };
  // All entries validated above; cents avoid repeated floating-point currency arithmetic.
  const leaseCostCents = rent! * months! - concessions! + fees! * months! + upfront!;
  return {
    errors,
    missing,
    estimate: {
      leaseCostCents,
      effectiveMonthlyCents: Math.round(leaseCostCents / months!),
      recurringMonthlyCents: rent! + fees!,
      cashAtSigningCents: signing! + signingFees! + upfront! + deposit!,
      refundableDepositCents: deposit!,
    },
  };
}
