const TTL = 5 * 60_000;
const MAX = 100;
const clone = (value: any) => JSON.parse(JSON.stringify(value)); // Reports are JSON; works on native JS engines too.
export function buildingRequestIdentity(listing: any) {
  return JSON.stringify(['address', 'city', 'county', 'state', 'zip'].map(key => typeof listing?.[key] === 'string' ? listing[key] : ''));
}
/** Session-memory only. No credentials, notes or private user data enter this cache. */
export function createBuildingReportCache(clock = Date.now) {
  const records = new Map<string, { until: number; value: any }>();
  return async (listing: any, request: (listing: any, signal: AbortSignal) => Promise<any>, signal: AbortSignal) => {
    if (signal.aborted) throw new Error('Building report request canceled.');
    const key = buildingRequestIdentity(listing);
    const cached = records.get(key);
    if (cached && cached.until > clock()) return clone(cached.value);
    records.delete(key);
    const value = await request(listing, signal);
    if (signal.aborted) throw new Error('Building report request canceled.'); // Canceled/late responses must never seed a cache.
    if (!value || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) || !['matched', 'partial', 'unmatched', 'ambiguous', 'unavailable'].includes(value.status)) throw new Error('Invalid building report response.');
    const duration = value.status === 'matched' ? TTL : 30_000;
    records.set(key, { until: clock() + duration, value: clone(value) });
    while (records.size > MAX) records.delete(records.keys().next().value);
    return clone(value);
  };
}
export const cachedBuildingReport = createBuildingReportCache();
