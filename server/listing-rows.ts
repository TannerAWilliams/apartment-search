/** How a saved listing is indexed for search, shared by the D1 store and the in-memory one used in tests. */
import { isRecord } from '../src/domain.ts';
import { regionOf } from '../src/regions.ts';
import type { SnapshotFilter } from './contracts.ts';

/** The listing's top-level region and rent, or null where it has none. */
export function listingIndex(listing: unknown): { region: string | null; rent: number | null } {
  if (!isRecord(listing) || typeof listing.state !== 'string') return { region: null, rent: null };
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const region = regionOf({
    state: listing.state,
    city: text(listing.city),
    county: text(listing.county),
    zip: text(listing.zip),
    region: text(listing.region),
  });
  return { region: region ?? null, rent: typeof listing.rent === 'number' && Number.isFinite(listing.rent) ? listing.rent : null };
}

/** Whether a listing passes the filter; the D1 store applies the same test in SQL. */
export function passesFilter({ region, rent }: ReturnType<typeof listingIndex>, filter: SnapshotFilter = {}) {
  return (
    (!filter.region || region === null || region === filter.region) &&
    (filter.maxRent === undefined || rent === null || rent <= filter.maxRent)
  );
}
