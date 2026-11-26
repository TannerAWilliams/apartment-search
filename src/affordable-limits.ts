/**
 * What an income-restricted apartment asks of one person, from the city's own tables. Housing Connect's open
 * data says how many apartments a lottery has in each income band, not each apartment's rent or limit, so these
 * are the band's ceilings: the listing itself has the exact figures.
 *
 * Source: HPD, "Area Median Income" (nyc.gov/site/hpd/services-and-information/area-median-income.page).
 * Incomes are the 2026 limits for a one-person household; rents are the latest HPD has published (2025). Both
 * change each spring.
 */
export const INCOME_YEAR = 2026;
export const RENT_YEAR = 2025;

/** The bands as Housing Connect's data counts them (server/sources/housing.ts), in order, each with the top of its range. */
export const BANDS = [
  { label: 'Extremely low income', share: 30, incomeForOne: 35_640, rents: [850, 911, 1093, 1263] },
  { label: 'Very low income', share: 50, incomeForOne: 59_400, rents: [1417, 1518, 1822, 2106] },
  { label: 'Low income', share: 80, incomeForOne: 95_040, rents: [2268, 2430, 2916, 3370] },
  { label: 'Moderate income', share: 120, incomeForOne: 142_560, rents: [3402, 3644, 4374, 5054] },
  { label: 'Middle income', share: 165, incomeForOne: 196_020, rents: [4678, 5011, 6014, 6950] },
] as const;

const SIZE_NAMES = ['studio', '1 BR', '2 BR', '3 BR'];
const dollars = (amount: number) => '$' + amount.toLocaleString('en-US');

/**
 * One line per income band a lottery has apartments in: the most one person may earn, and the most the rent
 * may be for each size the lottery offers. `bands` counts apartments per band, `sizes` per size (studio first).
 */
export function restrictionLines(bands: readonly number[] | undefined, sizes: readonly number[]) {
  return BANDS.flatMap(({ label, share, incomeForOne, rents }, index) => {
    const apartments = bands?.[index] ?? 0;
    if (!(apartments > 0)) return [];
    // Four-bedroom rents are not in the city's table; the sizes it has are shown.
    const offered = rents.flatMap((rent, size) => ((sizes[size] ?? 0) > 0 ? [`${SIZE_NAMES[size]} up to ${dollars(rent)}`] : []));
    return [
      `${label} (up to ${share}% of the area median): ${apartments} ${apartments === 1 ? 'apartment' : 'apartments'}. ` +
        `One person may earn up to ${dollars(incomeForOne)} a year.` +
        (offered.length ? ` Rent: ${offered.join(', ')}.` : ''),
    ];
  });
}
