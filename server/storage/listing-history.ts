import type { ListingData } from '../../src/domain.ts';
import { listingKey } from '../../src/listings.ts';

type PriceObservation = { checkedAt: string; rent: number; priceIncludesFees: boolean };
export type UnitHistory = {
  identity: string;
  sourceId: string;
  firstObservedAt: string;
  lastObservedAt: string;
  observations: PriceObservation[];
  truncated: boolean;
};
export type ObservationHistory = { version: 1; entries: UnitHistory[]; truncated: boolean; lastCheckedAt?: string };
/** A listing as saved after an observation: with the server's own price history, or none. */
export type ObservedListing = ListingData & { priceHistory?: UnitHistory };
export const MAX_HISTORY_UNITS = 20000;
const MAX_PRICE_OBSERVATIONS = 24;

/**
 * Observations, not availability claims. Missing units remain unknown, never "delisted".
 * Only listings in this observation keep their price history, unless keepUnseen is set for a
 * partial observation that carries earlier listings forward.
 */
export function recordListingHistory(
  listings: ListingData[],
  previous: ObservationHistory | undefined,
  sourceId: string,
  checkedAt: string,
  { keepUnseen = false }: { keepUnseen?: boolean } = {},
): { listings: ObservedListing[]; observationHistory: ObservationHistory } {
  if (!sourceId || !Number.isFinite(Date.parse(checkedAt))) throw new Error('Invalid observation context.');
  if (previous && (previous.version !== 1 || !Array.isArray(previous.entries))) throw new Error('Unrecognized listing history.');
  if (
    previous?.lastCheckedAt &&
    (!Number.isFinite(Date.parse(previous.lastCheckedAt)) || Date.parse(previous.lastCheckedAt) > Date.parse(checkedAt))
  )
    throw new Error('Observation predates saved history.');
  const entries = new Map<string, UnitHistory>();
  for (const entry of previous?.entries ?? []) {
    if (
      entry.sourceId !== sourceId ||
      !entry.identity ||
      !Array.isArray(entry.observations) ||
      !Number.isFinite(Date.parse(entry.firstObservedAt)) ||
      !Number.isFinite(Date.parse(entry.lastObservedAt)) ||
      entry.observations.some(
        (o) =>
          !Number.isFinite(o.rent) || o.rent <= 0 || !Number.isFinite(Date.parse(o.checkedAt)) || typeof o.priceIncludesFees !== 'boolean',
      )
    ) {
      throw new Error('Invalid saved listing history.');
    }
    if (Date.parse(entry.lastObservedAt) > Date.parse(checkedAt)) throw new Error('Observation predates saved history.');
    entries.set(entry.identity, { ...entry, observations: entry.observations.map((o) => ({ ...o })) });
  }
  const seen = new Set<string>();
  const observed = listings.map((listing) => {
    // Strip history supplied by feeds: only the server's own successful observations are trusted.
    const { priceHistory: _untrusted, ...clean } = listing;
    if (!Number.isFinite(listing.rent) || listing.rent <= 0) return clean;
    const identity = JSON.stringify([listing.id, listingKey(listing)]);
    if (seen.has(identity)) throw new Error('Duplicate unit observation.');
    seen.add(identity);
    const old = entries.get(identity);
    if (old && Date.parse(checkedAt) < Date.parse(old.lastObservedAt)) throw new Error('Observation predates saved history.');
    const latest = old?.observations.at(-1);
    const observation = { checkedAt, rent: listing.rent, priceIncludesFees: listing.priceIncludesFees === true };
    // Keep the first point and price/basis changes, not one point per unchanged refresh.
    const changed = !latest || latest.rent !== observation.rent || latest.priceIncludesFees !== observation.priceIncludesFees;
    const points = [...(old?.observations ?? []), ...(changed ? [observation] : [])];
    const history: UnitHistory = {
      identity,
      sourceId,
      firstObservedAt: old?.firstObservedAt ?? checkedAt,
      lastObservedAt: checkedAt,
      observations: points.slice(-MAX_PRICE_OBSERVATIONS),
      truncated: Boolean(old?.truncated || points.length > MAX_PRICE_OBSERVATIONS),
    };
    entries.set(identity, history);
    return { ...clean, priceHistory: history };
  });
  const retained = [...entries.values()]
    .filter((entry) => keepUnseen || seen.has(entry.identity))
    .sort((a, b) => Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt));
  return {
    listings: observed,
    observationHistory: {
      version: 1,
      lastCheckedAt: checkedAt,
      entries: retained.slice(0, MAX_HISTORY_UNITS),
      truncated: Boolean(previous?.truncated || retained.length > MAX_HISTORY_UNITS),
    },
  };
}
