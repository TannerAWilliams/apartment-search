/**
 * The refresh status document: each source's last check, how long a check counts as current, and the lock that
 * keeps two refreshes from running at once.
 */
import type { Bucket } from '../contracts.ts';
import { DIRECT_RENTAL_SOURCES } from '../sources/direct-rentals.ts';
import { STREETEASY_EXPORT_FORMAT, STREETEASY_EXPORT_MAX_AGE } from '../sources/listings.ts';
import { COMPLETE_SYNC_LIFETIME, completeSync, fullInventory } from '../sources/source-registry.ts';
import { STREETEASY_LIVE, STREETEASY_PUBLIC_TRANSPORT } from '../sources/streeteasy.ts';
import { RefreshStateSchema, checkedDocument } from '../storage/stored-documents.ts';

export const STREETEASY_TRANSPORT = 'v6-daily';
export const STREETEASY_PARTNER_TRANSPORT = 'partner-feed';
export const STREETEASY_SYNC_INTERVAL = 24 * 60 * 60_000;
export const STATE_KEY = 'rentals/refresh.json';

const DIRECT_BY_ID = new Map(DIRECT_RENTAL_SOURCES.map((source) => [source.id, source]));
const LOCK_TIMEOUT = 5 * 60_000;
const LIVE_MAX_AGE = 2 * 60 * 60_000;

export type CheckResult = {
  transport?: string;
  status: string;
  updatedAt: string | null;
  listingCount?: number;
  pages?: number;
  total?: number;
  sampleLimit?: number;
  partial?: boolean;
  requestedPages?: number;
  failedPages?: number;
  month?: string;
  revision?: string;
  catalogEtag?: string;
  csvEtag?: string;
};

export type SourceStatus = CheckResult & {
  requestTransport?: 'direct' | 'import' | 'partner-feed' | 'public-search' | typeof STREETEASY_EXPORT_FORMAT;
  id: string;
  name: string;
  checkedAt: string | null;
  marketplace?: string;
  transport?: string;
  retryAt?: string;
  retryAttempts?: number;
  error?: string;
};

export type RefreshState = {
  sources?: SourceStatus[];
  running?: boolean;
  startedAt?: string;
  lastCheckedAt?: string;
  market?: Pick<CheckResult, 'revision' | 'catalogEtag' | 'csvEtag'> | null;
  activeSource?: string | null;
};

export async function readState(bucket: Bucket | undefined): Promise<{ value: RefreshState; etag: string | null }> {
  const object = await bucket?.get(STATE_KEY);
  if (!object) return { value: {}, etag: null };
  // A status document that does not match is read as empty, so the next check rebuilds it.
  const value = checkedDocument(RefreshStateSchema, await object.json().catch(() => null), STATE_KEY) as RefreshState | null;
  return { value: value ?? {}, etag: object.etag };
}

export function checkInProgress(state: RefreshState, now: Date) {
  const sync = completeSync(state.activeSource);
  return state.running && now.getTime() - Date.parse(state.startedAt ?? '') < (sync ? sync.timeoutMs + 30_000 : LOCK_TIMEOUT);
}

export function publicStatus(state: RefreshState, now = new Date()) {
  const sources = (state.sources ?? []).map((source) =>
    source.status === 'feed_required' && DIRECT_BY_ID.has(source.id) ? { ...source, status: 'pending' } : source,
  );
  return {
    lastCheckedAt: state.lastCheckedAt ?? null,
    sources,
    ...(checkInProgress(state, now) ? { checking: true, activeSource: state.activeSource ?? null } : {}),
  };
}

export async function refreshStatus(bucket: Bucket | undefined) {
  return publicStatus((await readState(bucket)).value);
}

export function checkedDuring(sources: SourceStatus[] | undefined, ids: string[], hour: string) {
  return ids.every((id) =>
    sources?.some((source) => source.id === id && source.status !== 'failed' && source.checkedAt?.slice(0, 13) === hour),
  );
}

export const coolingDown = (source: SourceStatus | undefined, now: Date) => Date.parse(source?.retryAt ?? '') > now.getTime();

/** How long a check counts as current: a day for full inventories and StreetEasy's daily sync, two hours for samples. */
const sourceLifetime = (id: string, transport: string | undefined) =>
  fullInventory(id)
    ? COMPLETE_SYNC_LIFETIME
    : id === STREETEASY_LIVE.id && transport === STREETEASY_EXPORT_FORMAT
      ? STREETEASY_EXPORT_MAX_AGE
      : id === STREETEASY_LIVE.id &&
          (transport === STREETEASY_TRANSPORT || transport === STREETEASY_PARTNER_TRANSPORT || transport === STREETEASY_PUBLIC_TRANSPORT)
        ? STREETEASY_SYNC_INTERVAL
        : LIVE_MAX_AGE;

export function sourceRecent(status: { sources: SourceStatus[] } | null | undefined, id: string, now = new Date()) {
  const source = status?.sources.find((item) => item.id === id);
  const age = now.getTime() - Date.parse(source?.updatedAt ?? '');
  return (source?.status === 'updated' || source?.status === 'current') && age >= 0 && age <= sourceLifetime(id, source.transport);
}

/** Expiry of a currently usable observation, never an extension of its checked time. */
export function sourceExpiresAt(status: { sources: SourceStatus[] } | null | undefined, id: string, now = new Date()): string | null {
  if (!sourceRecent(status, id, now)) return null;
  const source = status!.sources.find((item) => item.id === id)!;
  const lifetime = sourceLifetime(id, source.transport);
  return new Date(Date.parse(source.updatedAt!) + lifetime).toISOString();
}
