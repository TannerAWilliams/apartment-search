/**
 * What an apartment is likely to cost beyond its rent, from the rent, the bedroom count and the state's rules:
 * - each month: rent, plus typical electricity and gas, internet and renter's insurance;
 * - to move in: the first month, the security deposit (New York caps it at one month's rent, New Jersey at one and
 *   a half, Connecticut at two), an application fee (New York caps it at $20) and any broker fee.
 * In New York City, since June 2025 (the FARE Act), a broker the landlord hired is paid by the landlord, not the
 * renter. These are typical amounts for planning, not quotes.
 */
import type { ListingData } from './domain.ts';

/** Typical monthly electricity and gas by bedroom count (studio first), in dollars. */
const UTILITIES = [90, 110, 140, 170, 200];
const INTERNET = 60;
const INSURANCE = 15;

export function typicalCosts(listing: Pick<ListingData, 'rent' | 'bedrooms' | 'state' | 'region' | 'priceIncludesFees'>) {
  const utilities = UTILITIES[Math.min(4, Math.max(0, listing.bedrooms))];
  const monthly = listing.rent + utilities + INTERNET + INSURANCE;
  const state = listing.state.toUpperCase();
  const depositMonths = state === 'NJ' ? 1.5 : state === 'CT' ? 2 : 1;
  const deposit = Math.round(listing.rent * depositMonths);
  const applicationFee = state === 'NY' ? 20 : 50;
  const nyc = listing.region === 'nyc';
  // Outside New York City a renter may still pay a broker: often about one month's rent.
  const possibleBrokerFee = nyc ? 0 : listing.rent;
  return {
    monthly,
    parts: { rent: listing.rent, utilities, internet: INTERNET, insurance: INSURANCE },
    moveIn: listing.rent + deposit + applicationFee,
    moveInParts: { firstMonth: listing.rent, deposit, applicationFee },
    possibleBrokerFee,
    notes: [
      depositMonths === 1
        ? 'New York law caps the security deposit at one month’s rent and the application fee at $20.'
        : `Security deposits here can be up to ${depositMonths} months’ rent.`,
      nyc
        ? 'In New York City you don’t pay a broker the landlord hired (FARE Act, June 2025); ask before you agree to any fee.'
        : `You may be asked for a broker fee, often about one month’s rent (${'$' + listing.rent.toLocaleString('en-US')}).`,
      listing.priceIncludesFees
        ? 'The listed price already includes some fees.'
        : 'Ask whether the rent is gross or “net effective” (with free months spread over the lease); these figures use the listed rent.',
    ],
  };
}
