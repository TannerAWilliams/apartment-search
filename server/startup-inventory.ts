import type { AppEnv } from './contracts.ts';
import { refreshSources, refreshStatus, type SourceFetch } from './refresh.ts';

// One bounded attempt per process startup, not a schedule or replacement for durable storage.
export async function initializeInventory(env: AppEnv, {
  fetcher = fetch, refresh = refreshSources, status = refreshStatus,
}: { fetcher?: SourceFetch; refresh?: typeof refreshSources; status?: typeof refreshStatus } = {}) {
  if (env.STARTUP_OPENIGLOO === 'false' || !env.BUCKET) return { state: 'disabled' };
  const previous = await status(env.BUCKET);
  if (previous.sources.some(source => (source.listingCount ?? 0) > 0 && source.updatedAt)) return { state: 'saved_inventory' };
  const deadline = AbortSignal.timeout(45000);
  const bounded: SourceFetch = (url, options) => fetcher(url, { ...options,
    signal: options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline });
  // This selection prevents fallback into any other adapter, paid router or StreetEasy.
  return refresh(env, { fetcher: bounded, onDemand: true, sourceId: 'openigloo' });
}
