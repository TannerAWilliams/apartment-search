/** What the app is told when it starts: how the server is set up, and what each source last saved. */
import type { AppEnv, Bucket } from './contracts.ts';
import { companyCounts } from '../src/companies.ts';
import { SNAPSHOT_MONTH } from '../src/market.ts';
import { routingCredentials } from './commute.ts';
import { DIRECT_RENTAL_SOURCES } from './sources/direct-rentals.ts';
import { configuredFeeds, STREETEASY_EXPORT_COVERAGE } from './sources/listings.ts';
import { OPENIGLOO } from './sources/openigloo.ts';
import { refreshCatalog } from './refresh/sources.ts';
import { refreshStatus, sourceRecent } from './refresh/status.ts';
import { storedMarket } from './refresh/market.ts';
import { isCompleteCoverage } from './sources/source-registry.ts';
import { STREETEASY_LIVE } from './sources/streeteasy.ts';

/** The server's settings alone. Throws when the partner feed settings are invalid. */
export function appConfig(env: AppEnv) {
  const feeds = configuredFeeds(env).filter(({ id }) => env.STREETEASY_SYNC_ENABLED !== 'false' || id !== STREETEASY_LIVE.marketplace);
  return {
    mode: feeds.length > 0 ? 'live' : 'snapshot',
    storageMode: env.BUCKET ? 'persistent' : 'none',
    browserImportAllowed: env.PUBLIC_APP !== 'true',
    // The research data is shared with signed-in people only, so it is offered wherever someone can sign in.
    streetViewAvailable: Boolean(env.GOOGLE_MAPS_API_KEY),
    dashboardAvailable: env.PUBLIC_APP === 'true' || Boolean(env.APP_ACCESS_TOKEN) || Boolean(env.BETTER_AUTH_SECRET),
    snapshotMonth: SNAPSHOT_MONTH,
    sources: feeds.map(({ id, name }) => ({ id, name })),
    ...(routingCredentials(env) ? { commuteConfigured: true } : {}),
  };
}

/** The settings with each source's saved status, the source catalog and the companies in the snapshot. */
export async function savedAppConfig(
  env: AppEnv & { BUCKET: Bucket },
  config: ReturnType<typeof appConfig>,
  cache: Pick<Cache, 'match' | 'put'> | undefined = (globalThis as { caches?: { default?: Cache } }).caches?.default,
) {
  const refresh = await refreshStatus(env.BUCKET);
  const sourceCatalog = refreshCatalog(env);
  const coverageById = new Map(sourceCatalog.map((source) => [source.id, source.coverage]));
  const liveSources = [
    ...DIRECT_RENTAL_SOURCES.map(({ marketplace, id, name }) => {
      const coverage = coverageById.get(id);
      return { id: marketplace, name, coverage, sample: coverage !== STREETEASY_EXPORT_COVERAGE && !isCompleteCoverage(coverage) };
    }),
    { id: OPENIGLOO.id, name: OPENIGLOO.name, sample: false, coverage: coverageById.get(OPENIGLOO.id) ?? 'NYC' },
  ];
  const companies = await savedCompanies(env, refresh, cache);
  return {
    ...config,
    refresh,
    companies,
    sourceCatalog,
    mode: refresh.sources.some(({ id }) => sourceRecent(refresh, id)) ? 'live' : config.mode,
    sources: [...liveSources, ...config.sources.filter(({ id }) => !liveSources.some((item) => item.id === id))],
    snapshotMonth: refresh.sources.find(({ id }) => id === 'firstmover')?.month ?? SNAPSHOT_MONTH,
  };
}

/**
 * The companies in the saved listings, which means reading every listing: kept in Cloudflare's cache for this
 * deployed version until a sync changes what is saved, so opening the app does not wait on that read.
 */
async function savedCompanies(env: AppEnv & { BUCKET: Bucket }, refresh: unknown, cache: Pick<Cache, 'match' | 'put'> | undefined) {
  const count = async () => companyCounts((await storedMarket(env.BUCKET)).listings);
  if (!cache) return count();
  const text = JSON.stringify({ refresh, version: env.CF_VERSION_METADATA?.id ?? '' });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const key = new Request(
    `https://config-cache.internal/${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`,
  );
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as Awaited<ReturnType<typeof count>>;
  const companies = await count();
  await cache.put(
    key,
    new Response(JSON.stringify(companies), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' } }),
  );
  return companies;
}
