const TTL = 5 * 60_000;
const MAX = 100;
import type { ListingData, Loose } from './domain.ts';

type Report = { status: string; checkedAt: string };
type Location = Loose<Pick<ListingData, 'address' | 'city' | 'county' | 'state' | 'zip'>>;
const clone = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T; // Reports are JSON; works on native JS engines too.
const text = (value: unknown) => typeof value === 'string' ? value : '';
export function buildingRequestIdentity(listing: Location | null | undefined) {
  return JSON.stringify([text(listing?.address), text(listing?.city), text(listing?.county), text(listing?.state), text(listing?.zip)]);
}
/** Session-memory only. No credentials, notes or private user data enter this cache. */
export function createBuildingReportCache(clock = Date.now) {
  const records = new Map<string, { until: number; value: Report }>();
  return async <L extends Location, R extends Report>(listing: L, request: (listing: L, signal: AbortSignal) => Promise<R>, signal: AbortSignal): Promise<R> => {
    if (signal.aborted) throw new Error('Building report request canceled.');
    const key = buildingRequestIdentity(listing);
    const cached = records.get(key);
    if (cached && cached.until > clock()) return clone(cached.value) as R;
    records.delete(key);
    const value = await request(listing, signal);
    if (signal.aborted) throw new Error('Building report request canceled.'); // Canceled/late responses must never seed a cache.
    if (!value || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) || !['matched', 'partial', 'unmatched', 'ambiguous', 'unavailable'].includes(value.status)) throw new Error('Invalid building report response.');
    const duration = value.status === 'matched' ? TTL : 30_000;
    records.set(key, { until: clock() + duration, value: clone(value) });
    while (records.size > MAX) { const oldest = records.keys().next().value; if (oldest === undefined) break; records.delete(oldest); }
    return clone(value);
  };
}
export const cachedBuildingReport = createBuildingReportCache();
