import type { ListingData, Loose } from './domain.ts';
import { savedCommuteEstimate } from './commute-estimate.ts';
/** Transparent ordering. Never substitute straight-line distance for a route. */
export function bestFit(
  listing: Loose<Pick<ListingData, 'rent' | 'commuteEstimate' | 'transitSeconds' | 'drivingSeconds'>>,
  filters: { bestFitRentWeight?: number; maxRent?: number | null; maxTransitMinutes?: number | null; maxDrivingMinutes?: number | null },
  workplace?: { latitude: number; longitude: number },
) {
  const rentWeight =
    typeof filters.bestFitRentWeight === 'number' &&
    Number.isInteger(filters.bestFitRentWeight) &&
    filters.bestFitRentWeight >= 0 &&
    filters.bestFitRentWeight <= 100
      ? filters.bestFitRentWeight
      : 60;
  const commuteWeight = 100 - rentWeight;
  const rentLimit = typeof filters.maxRent === 'number' && Number.isFinite(filters.maxRent) && filters.maxRent > 0 ? filters.maxRent : 5000;
  const mode = filters.maxDrivingMinutes != null && filters.maxTransitMinutes == null ? 'driving' : 'transit';
  const limit = mode === 'driving' ? filters.maxDrivingMinutes : filters.maxTransitMinutes;
  const commuteLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : 60;
  const rent = typeof listing.rent === 'number' && Number.isFinite(listing.rent) && listing.rent > 0 ? listing.rent : null;
  const estimate = savedCommuteEstimate(listing);
  const contextMatches =
    estimate && workplace && estimate.destination.latitude === workplace.latitude && estimate.destination.longitude === workplace.longitude;
  const minutes = contextMatches ? (mode === 'driving' ? estimate.drivingMinutes : estimate.transitMinutes) : null;
  const affordability = rent === null ? 0 : rentWeight * Math.max(0, Math.min(1, 1 - rent / rentLimit));
  const commute = minutes === null ? 0 : commuteWeight * Math.max(0, Math.min(1, 1 - minutes / commuteLimit));
  return {
    score: Math.round((affordability + commute) * 10) / 10,
    affordability: Math.round(affordability * 10) / 10,
    commute: Math.round(commute * 10) / 10,
    rentWeight,
    commuteWeight,
    rentLimit,
    commuteLimit,
    mode,
    rent,
    minutes,
    checkedAt: minutes === null ? null : (estimate?.checkedAt ?? null),
    unknowns: [rent === null ? 'Rent unknown' : '', minutes === null ? 'Matching commute estimate unavailable' : ''].filter(Boolean),
    explanation: `Rent savings: ${rentWeight} × max(0, 1 − rent / $${rentLimit.toLocaleString('en-US')}). ${mode === 'driving' ? 'Driving' : 'Transit'}: ${commuteWeight} × max(0, 1 − estimated minutes / ${commuteLimit}). Unknown values earn no points, not a favorable assumption.`,
  };
}
