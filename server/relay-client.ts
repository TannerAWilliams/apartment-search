import type { AppEnv } from './contracts.ts';
import type { SourceFetch } from './refresh.ts';

type RelayConfig = { origin: string; token: string };
export function relayConfig(env: AppEnv): RelayConfig | null {
  if (!env.LISTING_RELAY_URL && !env.LISTING_RELAY_TOKEN) return null;
  const url = new URL(env.LISTING_RELAY_URL ?? '');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.onrender.com') || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || typeof env.LISTING_RELAY_TOKEN !== 'string' ||
      env.LISTING_RELAY_TOKEN.length < 32) throw new Error('Invalid listing relay configuration.');
  return { origin: url.origin, token: env.LISTING_RELAY_TOKEN };
}

export function sourceRelayPayload(url: string, options?: RequestInit) {
  if (url === 'https://api-v6.streeteasy.com/' && options?.method === 'POST') {
    const query = JSON.parse(String(options.body))?.query;
    if (typeof query !== 'string') throw new Error('Invalid StreetEasy request.');
    const page = query.match(/\bpage:\s*(\d+)/)?.[1];
    const lower = query.match(/\blowerBound:\s*(\d+)/)?.[1];
    const upper = query.match(/\bupperBound:\s*(\d+)/)?.[1];
    if (!page || Boolean(lower) !== Boolean(upper)) throw new Error('Invalid StreetEasy query.');
    return { source: 'streeteasy', page: Number(page), ...(lower && upper ? { lower: Number(lower), upper: Number(upper) } : {}) };
  }
  const market = url.match(/^https:\/\/hotpads\.com\/(new-york-ny|jersey-city-nj|stamford-ct)\/condos-for-rent$/)?.[1];
  if (market && (!options?.method || options.method === 'GET')) return { source: 'hotpads', market };
  return null;
}

export function withListingRelay(fetcher: SourceFetch, config: RelayConfig): SourceFetch {
  return (url, options) => {
    const payload = sourceRelayPayload(url, options);
    if (!payload) return fetcher(url, options);
    return fetcher(config.origin + '/fetch', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify(payload), signal: options?.signal });
  };
}

// Render Free can sleep. Wake it before the adapters start their short page timers.
export async function wakeListingRelay(fetcher: SourceFetch, config: RelayConfig) {
  const signal = AbortSignal.timeout(90000);
  while (!signal.aborted) {
    try {
      const response = await fetcher(config.origin + '/health', { redirect: 'error', signal });
      const body = await response.text();
      if (response.ok && body.trim() === 'ok') return;
    } catch { if (signal.aborted) break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('The listing sync service is unavailable. Cached listings have been kept.');
}

// Per-request diagnostics contain route labels only, never URLs or credentials.
export type ListingTransports = Partial<Record<string, 'direct' | 'relay'>>;
export function createListingSourceClient(env: AppEnv, fetcher: SourceFetch = fetch) {
  const config = relayConfig(env);
  const listingTransports: ListingTransports = {};
  const routed = config ? withListingRelay(fetcher, config) : fetcher;
  const observed: SourceFetch = (url, options) => {
    const payload = sourceRelayPayload(url, options);
    if (payload) listingTransports[payload.source + '-live'] = config ? 'relay' : 'direct';
    return routed(url, options);
  };
  return { fetcher: observed, listingTransports,
    prepareListingSources: config ? () => wakeListingRelay(fetcher, config) : undefined };
}
