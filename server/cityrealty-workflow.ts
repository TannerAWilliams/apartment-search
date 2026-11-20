import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { AppEnv } from './contracts.ts';
import { CITYREALTY_ID } from './cityrealty.ts';
import { createD1Bucket, type D1Database } from './d1-bucket.ts';
import { crawlOpeniglooCell, finishOpeniglooRun, OPENIGLOO_CELL_COUNT } from './openigloo-sync.ts';
import { refreshSources, WORKFLOW_SOURCE_IDS } from './refresh.ts';

type Environment = AppEnv & { APARTMENTS: D1Database };
/** sources: which complete syncs to run, in order; all of them when omitted. */
type RefreshParameters = { delay: boolean; sources?: string[] };

const NAMES: Record<string, string> = { [CITYREALTY_ID]: 'CityRealty', openigloo: 'Openigloo', 'zumper-live': 'Zumper' };
const STEP_TIMEOUTS: Record<string, '13 minutes' | '25 minutes'> = { [CITYREALTY_ID]: '13 minutes', 'zumper-live': '25 minutes' };

/** Runs the complete-inventory syncs that are too long for an API request. Named for its first source. */
export class CityRealtySync extends WorkflowEntrypoint<Environment, RefreshParameters> {
  async run(event: WorkflowEvent<RefreshParameters>, step: WorkflowStep) {
    if (event.payload.delay) await step.sleep('Give other sources time to start', '3 seconds');
    const sources = (event.payload.sources ?? WORKFLOW_SOURCE_IDS).filter((id) => WORKFLOW_SOURCE_IDS.includes(id));
    const outcomes: Record<string, { state: string; listingCount?: number; error?: string }> = {};
    for (const sourceId of sources) {
      outcomes[sourceId] = sourceId === 'openigloo' ? await this.syncOpenigloo(event.instanceId, step) : await this.sync(sourceId, step);
    }
    const failed = Object.entries(outcomes).filter(([, outcome]) => outcome.error);
    if (failed.length) throw new Error(failed.map(([id, outcome]) => NAMES[id] + ': ' + outcome.error).join(' '));
    return outcomes;
  }

  private async sync(sourceId: string, step: WorkflowStep) {
    const bucket = createD1Bucket(this.env.APARTMENTS);
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await step.do(`Verify and save ${NAMES[sourceId]} inventory (attempt ${attempt + 1})`,
        { timeout: STEP_TIMEOUTS[sourceId] ?? '13 minutes', retries: { limit: 0, delay: '1 second' } },
        () => refreshSources({ ...this.env, BUCKET: bucket }, {
          sourceId, onDemand: true, forceRefresh: true,
          fetcher: (url, options) => fetch(url, { ...options, redirect: 'manual' }),
        }));
      if (result.state !== 'running') {
        const status = result.sources.find(({ id }) => id === sourceId);
        const error = result.state !== 'already_checked' && status?.status === 'failed' ? status.error ?? `${NAMES[sourceId]} refresh failed.` : undefined;
        return { state: result.state, listingCount: status?.listingCount, ...(error ? { error } : {}) };
      }
      await step.sleep(`Wait for active refresh before ${NAMES[sourceId]} ${attempt + 1}`, '15 seconds');
    }
    return { state: 'running', error: 'Another source refresh is already running.' };
  }

  /** Openigloo takes about 45 minutes, so each borough and bedroom count is its own step. */
  private async syncOpenigloo(run: string, step: WorkflowStep) {
    const bucket = createD1Bucket(this.env.APARTMENTS);
    const fetcher = (url: string, options?: RequestInit) => fetch(url, { ...options, redirect: 'manual' });
    try {
      for (let index = 0; index < OPENIGLOO_CELL_COUNT; index++) {
        await step.do(`Search Openigloo part ${index + 1} of ${OPENIGLOO_CELL_COUNT}`,
          { timeout: '20 minutes', retries: { limit: 2, delay: '2 minutes', backoff: 'linear' } },
          () => crawlOpeniglooCell(bucket, run, index, fetcher));
      }
    } catch (cause) {
      return { state: 'failed', error: cause instanceof Error ? cause.message : 'The Openigloo search failed.' };
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await step.do(`Verify and save Openigloo inventory (attempt ${attempt + 1})`,
        { timeout: '10 minutes', retries: { limit: 0, delay: '1 second' } },
        () => finishOpeniglooRun({ ...this.env, BUCKET: bucket }, run, fetcher).catch((cause: unknown) =>
          ({ state: 'failed', error: cause instanceof Error ? cause.message : 'Openigloo inventory could not be saved.' })));
      if (result.state !== 'running') {
        const error = 'error' in result ? result.error : result.status?.status === 'failed' ? result.status.error ?? 'Openigloo refresh failed.' : undefined;
        return { state: result.state, ...('listingCount' in result ? { listingCount: result.listingCount } : {}), ...(error ? { error } : {}) };
      }
      await step.sleep(`Wait for active refresh before saving Openigloo ${attempt + 1}`, '15 seconds');
    }
    return { state: 'running', error: 'Another source refresh is already running.' };
  }
}
