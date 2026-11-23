export type SourceStatus = {
  id: string;
  name?: string;
  marketplace?: string;
  status?: string;
  checkedAt?: string | null;
  updatedAt?: string | null;
  retryAt?: string;
  error?: string;
  listingCount?: number;
  total?: number;
  pages?: number;
  sampleLimit?: number;
  partial?: boolean;
  requestedPages?: number;
  failedPages?: number;
};
export type SourceDefinition = { id: string; name: string; marketplace?: string; coverage?: string; resyncable: boolean; paused?: boolean };
/**
 * Complete syncs that run in the background Workflow, with how long the app keeps checking on
 * them. Mirrors server/sources/source-registry.ts (a test keeps them in step) without bundling server code.
 */
export const LONG_SYNC_LIMITS: Record<string, number> = {
  'cityrealty-live': 13 * 60_000,
  openigloo: 50 * 60_000,
  'zumper-live': 25 * 60_000,
};
export const LONG_SYNC_POLL_MS = 15_000;

export function sourceRows(catalog: SourceDefinition[], statuses: SourceStatus[], browseNames: Record<string, string>, now = Date.now()) {
  const definitions = new Map(catalog.map((source) => [source.id, source]));
  const represented = new Set(catalog.map((source) => source.marketplace ?? source.id.replace(/-live$/, '')));
  for (const status of statuses)
    if (!definitions.has(status.id)) definitions.set(status.id, { id: status.id, name: status.name ?? status.id, resyncable: false });
  for (const [id, name] of Object.entries(browseNames))
    if (!represented.has(id))
      definitions.set('browse:' + id, { id: 'browse:' + id, name, coverage: 'Browse link only; no data connection', resyncable: false });
  return [...definitions.values()]
    .map((definition) => {
      const status = statuses.find((item) => item.id === definition.id);
      const coolingDown = Date.parse(status?.retryAt ?? '') > now;
      return {
        ...definition,
        status,
        coolingDown,
        state: definition.paused
          ? 'Sync paused'
          : !definition.resyncable
            ? 'Not connected'
            : status?.status === 'failed'
              ? 'Last attempt failed'
              : status?.updatedAt
                ? 'Saved data available'
                : 'Not fetched yet',
      };
    })
    .sort((a, b) => Number(b.resyncable) - Number(a.resyncable) || a.name.localeCompare(b.name));
}

/** A partial refresh must not look like an empty or successful full inventory fetch. */
export function refreshSummary(sources: SourceStatus[]): string {
  const updated = sources.filter((source) => source.status === 'updated');
  const unchanged = sources.filter((source) => source.status === 'current');
  const successful = updated.length + unchanged.length;
  const failed = sources.filter((source) => source.status === 'failed');
  const unavailable = failed.map((source) => source.name ?? source.id).join(', ');
  const count = (number: number) => `${number} source${number === 1 ? '' : 's'}`;
  const outcome = [
    updated.length ? `${count(updated.length)} updated` : '',
    unchanged.length ? `${count(unchanged.length)} checked with no changes` : '',
  ]
    .filter(Boolean)
    .join('; ');
  if (failed.length)
    return `${outcome ? outcome + '; ' : ''}${unavailable} could not refresh. Previous cached listings are retained where available. This is not complete coverage.`;
  if (successful) return `${outcome}. Connected providers may return limited samples.`;
  return 'No sources refreshed. Check Sources for connection status and retry times.';
}

/** Report observed scope, never infer complete coverage from matching counts. */
export function sourceCoverage(status?: SourceStatus): string {
  if (!status) return '';
  const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const parts: string[] = [];
  if (status.partial)
    parts.push(
      `Partial check: ${status.pages}/${status.requestedPages} pages succeeded; earlier units kept with their original check dates`,
    );
  if (validCount(status.total)) parts.push(`Provider reported ${status.total.toLocaleString('en-US')} records`);
  if (validCount(status.pages) && status.pages > 0) parts.push(`${status.pages} pages fetched`);
  if (validCount(status.sampleLimit) && status.sampleLimit > 0)
    parts.push(`sample capped at ${status.sampleLimit.toLocaleString('en-US')} records`);
  if (!parts.length) return '';
  return `${status.status === 'failed' ? 'Last saved snapshot: ' : ''}${parts.join(' · ')}. Provider totals may include listings excluded by our filters; counts do not prove complete coverage.`;
}
