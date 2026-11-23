import type { ListingData, Loose } from './domain.ts';
import { savedCommuteEstimate } from './commute-estimate.ts';
import { listingKey, listingPresentation } from './listings.ts';
import { discoveryFacts, LAUNDRY_LABELS } from './discovery.ts';
import { formatRent } from './search.ts';
export const MAX_COMPARISON = 4;
export const comparisonTitle = (listing: Loose<Pick<ListingData, 'address' | 'unit' | 'city'>>) => [listing.address, listing.unit ? `Unit ${listing.unit}` : '', listing.city].filter(Boolean).join(', ');
export function toggleComparison(keys: string[], key: string, available: string[]) {
  const current = [...new Set(keys)].filter(item => available.includes(item)).slice(0, MAX_COMPARISON);
  if (current.includes(key)) return current.filter(item => item !== key);
  return available.includes(key) && current.length < MAX_COMPARISON ? [...current, key] : current;
}
export function comparisonOptions(listings: ListingData[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  return listings.filter(listing => {
    const key = listingKey(listing);
    if (seen.has(key)) return false;
    seen.add(key);
    return `${comparisonTitle(listing)} ${listing.zip ?? ''}`.toLocaleLowerCase().includes(needle);
  });
}
export function comparisonRows(listing: ListingData) {
  const facts = discoveryFacts(listing), presentation = listingPresentation(listing);
  for (const key of (Object.keys(facts) as (keyof typeof facts)[])) if (Array.isArray(listing.discoveryConflicts) && listing.discoveryConflicts.includes(key)) facts[key] = null;
  const commute = savedCommuteEstimate(listing);
  const checkedAt = listing.checkedAt ?? listing.seenAt;
  return [
    ['Monthly advertised price', presentation.priceKnown ? `${formatRent(listing.rent)}/mo` : 'Unknown'],
    ['Price basis', listing.kind === 'snapshot' ? 'Historical recorded rent' : listing.priceIncludesFees ? 'Includes reported fees' : 'Asking rent; fees not confirmed'],
    ['Bedrooms', presentation.bedsLabel],
    ['Bathrooms', facts.bathrooms === null ? 'Unknown' : String(facts.bathrooms)],
    ['Area', facts.squareFeet === null ? 'Unknown' : `${facts.squareFeet.toLocaleString('en-US')} sq ft`],
    ['Pets', facts.petsAllowed === null ? 'Unknown' : facts.petsAllowed ? 'Reported allowed; verify restrictions' : 'Reported not allowed'],
    ['Laundry', facts.laundry === null ? 'Unknown' : LAUNDRY_LABELS[facts.laundry]],
    ['Source checks', typeof checkedAt === 'string' && Number.isFinite(Date.parse(checkedAt)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' }).format(new Date(checkedAt)) + ' ET' : 'Unknown'],
    ['Commute destination', commute ? `${commute.destination.label} (${commute.destination.latitude.toFixed(4)}, ${commute.destination.longitude.toFixed(4)})` : 'Unknown'],
    ['Commute estimate checked', commute ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(commute.checkedAt)) + ' ET' : 'Unknown'],
    ['Transit estimate', commute?.transitMinutes == null ? 'Unknown' : `${commute.transitMinutes} min (weekday morning)`],
    ['Driving estimate', commute?.drivingMinutes == null ? 'Unknown' : `${commute.drivingMinutes} min (weekday morning)`],
    ['Commute caveat', commute ? 'Saved TravelTime estimate, not current traffic. Compare only matching destinations.' : 'No destination-linked estimate; use directions.'],
    ['Cautions', presentation.notices.join(' ') || 'Verify current availability and lease terms.'],
  ];
}
