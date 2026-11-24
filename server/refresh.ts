/**
 * A refresh run: which sources to check, the lock, and each source's status saved as its check finishes.
 * The sources themselves are declared in refresh/sources.ts.
 */
import type { AppEnv, Bucket, SourceFetch } from './contracts.ts';
import { log } from './log.ts';
import { MARKET_KEY, marketBaseline } from './refresh/market.ts';
import {
  type RefreshSource,
  type Run,
  SOURCES,
  type StatusContext,
  checkStatus,
  refreshCatalog,
  sourcesFor,
  streetEasyTransportFor,
} from './refresh/sources.ts';
import {
  type CheckResult,
  STATE_KEY,
  STREETEASY_SYNC_INTERVAL,
  STREETEASY_TRANSPORT,
  type SourceStatus,
  checkInProgress,
  checkedDuring,
  coolingDown,
  publicStatus,
  readState,
} from './refresh/status.ts';
import { configuredFeeds } from './sources/listings.ts';
import { BLOCKED_SOURCES, WORKFLOW_SOURCE_IDS, workflowSync } from './sources/source-registry.ts';
import { requestForRefresh } from './sources/source-requests.ts';
import { STREETEASY_LIVE } from './sources/streeteasy.ts';

const PAGE_FETCH_TIMEOUT = 25_000;

type RefreshOptions = {
  fetcher?: SourceFetch;
  now?: Date;
  /** Snapshots uploaded by the home sync, keyed by source id; each stands in for what that source's loader returns. */
  imports?: Readonly<Record<string, unknown>>;
  onDemand?: boolean;
  onlyStreetEasy?: boolean;
  sourceId?: string;
  fallback?: boolean;
  /** Skip the complete syncs because the Workflow runs them. */
  excludeWorkflowSources?: boolean;
};

export async function refreshPlan(bucket: Bucket | undefined, now = new Date()) {
  const [{ value }, object] = await Promise.all([readState(bucket), bucket?.head(MARKET_KEY)]);
  const market = marketBaseline(object, value.market);
  const hour = now.toISOString().slice(0, 13);
  // Configured feeds are not in SOURCES, which does not depend on the settings; the saved status lists them.
  const feeds = value.sources?.map(({ id }) => id).filter((id) => !SOURCES.some((source) => source.id === id)) ?? [];
  const publicIds = SOURCES.filter(({ kind }) => kind === 'public').map(({ id }) => id);
  return {
    ready: Boolean(bucket),
    market,
    alreadyChecked: Boolean(market) && !value.running && checkedDuring(value.sources, [...SOURCES.map(({ id }) => id), ...feeds], hour),
    publicAlreadyChecked: Boolean(market) && !value.running && checkedDuring(value.sources, publicIds, hour),
    ...publicStatus(value, now),
  };
}

export async function refreshSources(
  env: AppEnv,
  {
    fetcher = fetch,
    now = new Date(),
    imports,
    onDemand = false,
    fallback = false,
    onlyStreetEasy = false,
    sourceId,
    excludeWorkflowSources = false,
  }: RefreshOptions = {},
) {
  const selected = sourceId ?? (onlyStreetEasy ? STREETEASY_LIVE.id : null);
  // A blocked site is never fetched, but data uploaded for it (an authorized feed) can still be saved.
  const uploadForBlocked = Boolean(imports) && selected !== null && Object.hasOwn(BLOCKED_SOURCES, selected);
  if (selected && !uploadForBlocked && !refreshCatalog(env).some((source) => source.id === selected && source.resyncable))
    throw new Error('Unknown or disconnected refresh source.');
  const bucket = env.BUCKET;
  if (!bucket) throw new Error('Source storage is unavailable.');
  const current = await readState(bucket);
  const at = now.toISOString();
  const hour = at.slice(0, 13);
  const previous = current.value;
  if (checkInProgress(previous, now)) {
    return { state: 'running', ...publicStatus(previous, now) };
  }
  const previousById = new Map((previous.sources ?? []).map((source) => [source.id, source]));
  const sources = sourcesFor(env);
  const streetEasyPartner = configuredFeeds(env).find(({ id }) => id === STREETEASY_LIVE.marketplace);
  const streetEasyTransport = streetEasyTransportFor(env, streetEasyPartner);
  /** Whether a source can be checked now: not waiting out a retry, and not paused or left to the Workflow. */
  const ready = (id: string) => {
    const prior = previousById.get(id);
    if (workflowSync(id) && excludeWorkflowSources) return false;
    // A resync of every source leaves out sites that refuse automated requests (see BLOCKED_SOURCES). The API refuses
    // to resync one on its own, since the catalog marks it as not resyncable.
    if (!sourceId && Object.hasOwn(BLOCKED_SOURCES, id)) return false;
    if (id !== STREETEASY_LIVE.id) return !coolingDown(prior, now);
    if (env.STREETEASY_SYNC_ENABLED === 'false') return false;
    // A different way of reading StreetEasy is tried even while the previous one waits out a retry.
    return (onDemand && Boolean(prior?.transport) && prior?.transport !== streetEasyTransport) || !coolingDown(prior, now);
  };
  const imported = <T>(id: string) => imports?.[id] as T | undefined;
  const priorStreetEasy = previousById.get(STREETEASY_LIVE.id);
  // A StreetEasy upload from the home sync replaces a failed or day-old StreetEasy check.
  const recoveredStreetEasy =
    imported<{ transport?: string }>(STREETEASY_LIVE.id)?.transport === STREETEASY_TRANSPORT &&
    (!priorStreetEasy ||
      priorStreetEasy.status === 'failed' ||
      now.getTime() - Date.parse(priorStreetEasy.updatedAt ?? '') >= STREETEASY_SYNC_INTERVAL);
  /**
   * Whether this run checks a source. A regular run checks everything due; an on-demand one what is ready;
   * a StreetEasy-only run just StreetEasy; a fallback (the home sync filling in) only what failed or is stale.
   */
  const included = ({ id, kind }: RefreshSource) => {
    if (kind === 'public')
      return (
        !onlyStreetEasy &&
        (fallback ? Boolean(imports?.[id]) && previousById.get(id)?.status === 'failed' && ready(id) : !onDemand || ready(id))
      );
    if (kind === 'reference') return onDemand && !onlyStreetEasy && !fallback && ready(id);
    if (kind === 'feed') return !onlyStreetEasy && !fallback && (!onDemand || ready(id));
    const streetEasy = id === STREETEASY_LIVE.id;
    const requested = onlyStreetEasy
      ? streetEasy && ready(id)
      : fallback
        ? streetEasy && recoveredStreetEasy
        : onDemand
          ? ready(id)
          : Boolean(imports) && Object.hasOwn(imports!, id);
    // StreetEasy is skipped when paused, and in uploads when a partner feed supplies it.
    return requested && !(streetEasy && (env.STREETEASY_SYNC_ENABLED === 'false' || (!onDemand && streetEasyPartner)));
  };
  const checks = sources.filter(included).filter(({ id }) => !selected || id === selected);
  const ids = checks.map(({ id }) => id);
  if (
    ids.length === 0 ||
    (!onDemand &&
      !selected &&
      !onlyStreetEasy &&
      !previous.running &&
      !imported<{ changed?: boolean }>('firstmover')?.changed &&
      checkedDuring(previous.sources, ids, hour))
  ) {
    return { state: 'already_checked', ...publicStatus(previous) };
  }

  const activeSource = WORKFLOW_SOURCE_IDS.find((id) => ids.includes(id)) ?? selected;
  const lease = await bucket.put(STATE_KEY, JSON.stringify({ ...previous, running: true, startedAt: at, activeSource }), {
    onlyIf: current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
  });
  if (!lease) return { state: 'running', ...publicStatus((await readState(bucket)).value, now) };

  const sourceFetch = onDemand
    ? requestForRefresh(fetcher, AbortSignal.timeout(ids.includes(STREETEASY_LIVE.id) ? 120_000 : PAGE_FETCH_TIMEOUT))
    : fetcher;
  const run: Run = {
    bucket,
    at,
    now,
    onDemand,
    isImport: Boolean(imports),
    previous,
    fetch: sourceFetch,
    imported,
    liveData: <T>(id: string, load: (fetcher: SourceFetch, now: Date) => T): T =>
      onDemand
        ? load(workflowSync(id) ? requestForRefresh(fetcher, AbortSignal.timeout(workflowSync(id)!.timeoutMs)) : sourceFetch, now)
        : (imported<T>(id) as T),
    streetEasyPartner,
    streetEasyTransport,
  };
  const statusContext: StatusContext = { at, now, onDemand, streetEasyTransport, previousById };
  const statusFor = (check: RefreshSource, result: PromiseSettledResult<CheckResult>) => checkStatus(check, result, statusContext);

  // Publish each successful provider immediately, even while another is slow.
  let currentEtag = lease.etag;
  const progress = new Map((previous.sources ?? []).map((source) => [source.id, source]));
  let writes = Promise.resolve();
  const persist = (item: SourceStatus) => {
    writes = writes.then(async () => {
      progress.set(item.id, item);
      const receipt = await bucket.put(
        STATE_KEY,
        JSON.stringify({ ...previous, running: true, startedAt: at, activeSource, lastCheckedAt: at, sources: [...progress.values()] }),
        { onlyIf: { etagMatches: currentEtag } },
      );
      if (!receipt) throw new Error('Source refresh was superseded.');
      currentEtag = receipt.etag;
    });
    return writes;
  };
  const results = await Promise.all(
    checks.map(async (check): Promise<PromiseSettledResult<CheckResult>> => {
      let result: PromiseSettledResult<CheckResult>;
      try {
        result = { status: 'fulfilled', value: await check.check(run) };
      } catch (reason) {
        result = { status: 'rejected', reason };
      }
      await persist(statusFor(check, result));
      return result;
    }),
  );
  const attempted = checks.map((check, index) => statusFor(check, results[index]));
  for (const [index, item] of attempted.entries()) {
    const result = results[index];
    if (result.status === 'rejected')
      log.warn('source_check_failed', {
        source: item.id,
        error: item.error,
        cause: result.reason instanceof Error ? result.reason.message : String(result.reason),
        httpStatus: result.reason?.httpStatus,
      });
  }

  // Sources no longer declared or configured drop out of the saved status.
  const declared = new Set(sources.map(({ id }) => id));
  const saved = [...attempted, ...(previous.sources ?? []).filter(({ id }) => !ids.includes(id) && declared.has(id))];
  const marketResult = results[checks.findIndex(({ id }) => id === 'firstmover')];
  const market = marketResult?.status === 'fulfilled' ? marketResult.value : previous.market;
  const state = {
    running: false,
    hour,
    lastCheckedAt: at,
    market: market
      ? {
          revision: market.revision,
          catalogEtag: market.catalogEtag,
          csvEtag: market.csvEtag,
        }
      : null,
    sources: saved,
  };
  const written = await bucket.put(STATE_KEY, JSON.stringify(state), { onlyIf: { etagMatches: currentEtag } });
  if (!written) return { state: 'superseded', ...publicStatus((await readState(bucket)).value) };
  const result = publicStatus(state);
  return { state: result.sources.some(({ status }) => status === 'failed') ? 'partial' : 'complete', ...result };
}
