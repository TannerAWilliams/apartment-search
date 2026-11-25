/**
 * A search answered from an inventory: every listing already merged and scored, and the stations transit
 * estimates need (docs/architecture/search.md). The same function answers on the server and in the browser, so
 * there is one definition of what a search returns.
 */
import type { ListingData, SearchFilters, SourceStatus, Workplace } from './domain.ts';
import { listingWithVerifiedLinks } from './listings.ts';
import { formatSearch } from './market.ts';
import { isPoint, matchListings } from './search.ts';
import type { Station } from './subway.ts';
import { transitEstimator } from './transit-estimate.ts';

export type Inventory = {
  listings: ListingData[];
  /** Subway and PATH stations, for estimated transit times. */
  stations: Station[];
  mode: string;
  sources: SourceStatus[];
  notices: string[];
  snapshotMonth?: string;
};

type Estimates = { estimate: ReturnType<typeof transitEstimator>; byHome: Map<string, number | null> };
const DESTINATIONS_KEPT = 24;
/** Each destination's estimator and the estimates made with it, per set of stations. */
const estimators = new WeakMap<Station[], Map<string, Estimates>>();

/**
 * Each listing with its estimated transit minutes to the destination. An estimate measures every station near a
 * home, so each home's is worked out once per destination: a person's later searches reuse them.
 */
export function withTransitEstimates<T extends ListingData>(
  listings: T[],
  stations: Station[],
  destination: { latitude: number; longitude: number },
) {
  const byDestination = estimators.get(stations) ?? new Map<string, Estimates>();
  estimators.set(stations, byDestination);
  const key = `${destination.latitude.toFixed(4)},${destination.longitude.toFixed(4)}`;
  let known = byDestination.get(key);
  if (!known) {
    // A few destinations are kept; the one unused longest makes room.
    if (byDestination.size >= DESTINATIONS_KEPT) byDestination.delete(byDestination.keys().next().value!);
    known = { estimate: transitEstimator(stations, destination), byHome: new Map() };
  } else byDestination.delete(key);
  byDestination.set(key, known);
  const { estimate, byHome } = known;
  return listings.map((listing) => {
    if (!isPoint(listing)) return listing;
    const home = `${listing.latitude.toFixed(5)},${listing.longitude.toFixed(5)}`;
    let minutes = byHome.get(home);
    if (minutes === undefined) {
      minutes = estimate({ latitude: listing.latitude, longitude: listing.longitude });
      byHome.set(home, minutes);
    }
    return minutes === null ? listing : { ...listing, insights: { warnings: [], ...listing.insights, transitMinutes: minutes } };
  });
}

/** The search's answer: its matches in order, a page of them, the counts, and the map's points when asked for. */
export function answerSearch(inventory: Inventory, filters: SearchFilters, workplace: Workplace) {
  const matched = matchListings(inventory.listings, filters, workplace).map(listingWithVerifiedLinks);
  // A commute limit needs every listing's estimate before the limit is applied, not only those shown.
  const limited = filters.maxCommuteMinutes == null ? matched : withTransitEstimates(matched, inventory.stations, workplace);
  const formatted = formatSearch(limited, filters, workplace, inventory.mode, inventory.sources, inventory.notices);
  return {
    ...formatted,
    // Each listing shown gets its estimated transit time to the destination.
    matches: withTransitEstimates(formatted.matches, inventory.stations, workplace),
    ...(inventory.snapshotMonth ? { snapshotMonth: inventory.snapshotMonth } : {}),
  };
}
