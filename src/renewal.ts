/** The renewal check: a lease renewal next to similar apartments listed now. */
import { formatRent } from './search.ts';

/** Rent Guidelines Board increases for rent-stabilized leases starting October 1, 2025 through September 30, 2026. */
export const RGB_INCREASES = { oneYear: 0.03, twoYear: 0.045 };

/** What a renewal looks like next to similar apartments listed now. */
export function renewalAdvice(rent: number, median: number | null, count: number, stabilized: boolean) {
  if (stabilized)
    return [
      `As a rent-stabilized tenant, your increase is set by the Rent Guidelines Board: ${RGB_INCREASES.oneYear * 100}% for a one-year lease (${formatRent(Math.round(rent * (1 + RGB_INCREASES.oneYear)))}) or ${RGB_INCREASES.twoYear * 100}% for two years (${formatRent(Math.round(rent * (1 + RGB_INCREASES.twoYear)))}), for leases starting October 2025 to September 2026.`,
      'Your landlord must offer a renewal; you choose one or two years.',
    ];
  if (median === null || count < 3) return ['Too few similar apartments are listed here to compare. Try a nearby neighborhood.'];
  const delta = (rent - median) / median;
  const percent = Math.round(Math.abs(delta) * 100);
  if (delta > 0.05)
    return [
      `You pay ${percent}% more than the ${formatRent(median)} median of ${count} similar apartments listed now.`,
      `Ask for a renewal at or below your current rent, and mention the listings. Moving could save about ${formatRent(Math.round(rent - median))} a month.`,
    ];
  if (delta < -0.05)
    return [
      `You pay ${percent}% less than the ${formatRent(median)} median of ${count} similar apartments listed now.`,
      'An increase is likely. Staying probably costs less than moving, so negotiate the size of the increase rather than walking away.',
    ];
  return [
    `Your rent is close to the ${formatRent(median)} median of ${count} similar apartments listed now.`,
    'A small increase is in line with the market; a large one is worth pushing back on with these listings.',
  ];
}
