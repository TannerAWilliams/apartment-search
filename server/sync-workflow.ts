import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { AppEnv, Bucket } from './contracts.ts';
import { createD1Bucket, type D1Database } from './storage/d1-bucket.ts';
import { crawlOpeniglooCell, finishOpeniglooRun, OPENIGLOO_CELL_COUNT } from './sources/openigloo-sync.ts';
import { refreshSources } from './refresh.ts';
import { log } from './log.ts';
import { runAlerts } from './alerts.ts';
import { fillBuildingFactsFromInventory } from './building-facts.ts';
import { refreshOpenData } from './open-data.ts';

/** Batches of 40 building checks after a full nightly run: about 200 buildings a night. */
const BUILDING_BATCHES = 5;
import { SYNC_PROGRESS_KEY, WORKFLOW_SOURCE_IDS, workflowSync } from './sources/source-registry.ts';
import { refreshInventory } from './inventory.ts';

type Environment = AppEnv & { APARTMENTS: D1Database };
/** sources: which complete syncs to run, in order; all of them when omitted. */
type RefreshParameters = { delay: boolean; sources?: string[] };

const NAMES: Record<string, string> = Object.fromEntries(WORKFLOW_SOURCE_IDS.map((id) => [id, workflowSync(id)!.name]));

/**
 * After a full (nightly) run: the rent-stabilized registry and subway stations when a month old, then listed
 * buildings' records in batches of 40, one durable step each: about 200 buildings a night.
 */
export async function afterFullRun(step: Pick<WorkflowStep, 'do'>, env: AppEnv & { BUCKET: Bucket }) {
  await step.do('Refresh rent registrations and subway stations', { retries: { limit: 1, delay: '1 minute' }, timeout: '10 minutes' }, () =>
    refreshOpenData(env.BUCKET, (url, options) => fetch(url, options)),
  );
  let checked = 0;
  for (let batch = 1; batch <= BUILDING_BATCHES; batch++) {
    checked += await step.do(
      `Check building records (${batch} of ${BUILDING_BATCHES})`,
      { retries: { limit: 1, delay: '30 seconds' }, timeout: '10 minutes' },
      () => fillBuildingFactsFromInventory(env, (url, options) => fetch(url, options)),
    );
  }
  return checked;
}

/** Runs the syncs that are too long for an API request: slow samples, then complete inventories. The class keeps its original name, which the deployed Workflow uses. */
export class CityRealtySync extends WorkflowEntrypoint<Environment, RefreshParameters> {
  async run(event: WorkflowEvent<RefreshParameters>, step: WorkflowStep) {
    if (event.payload.delay) await step.sleep('Give other sources time to start', '3 seconds');
    const sources = (event.payload.sources ?? WORKFLOW_SOURCE_IDS).filter((id) => WORKFLOW_SOURCE_IDS.includes(id));
    const outcomes: Record<string, { state: string; listingCount?: number; error?: string }> = {};
    const bucket = createD1Bucket(this.env.APARTMENTS);
    for (const sourceId of sources) {
      await step.do(`Record ${NAMES[sourceId]} as syncing`, { retries: { limit: 2, delay: '5 seconds' } }, async () => {
        await bucket.put(SYNC_PROGRESS_KEY, JSON.stringify({ source: sourceId, startedAt: new Date().toISOString() }));
        return sourceId;
      });
      outcomes[sourceId] = sourceId === 'openigloo' ? await this.syncOpenigloo(event.instanceId, step) : await this.sync(sourceId, step);
    }
    // Saved-search alerts compare the new inventory with each alert's last check.
    if (Object.values(outcomes).some((outcome) => !outcome.error)) {
      await step.do('Check saved-search alerts', { retries: { limit: 1, delay: '10 seconds' }, timeout: '5 minutes' }, async () => ({
        alerts: (await runAlerts({ ...this.env, BUCKET: bucket }))?.alerts.length ?? 0,
      }));
    }
    // A full run (the nightly one) also refreshes the open data and checks a few more listed buildings.
    if (!event.payload.sources) await afterFullRun(step, { ...this.env, BUCKET: bucket });
    // The file browsers search follows what was just synced.
    await step.do('Build the inventory file', { retries: { limit: 1, delay: '30 seconds' }, timeout: '5 minutes' }, () =>
      refreshInventory({ ...this.env, BUCKET: bucket }),
    );
    const failed = Object.entries(outcomes).filter(([, outcome]) => outcome.error);
    for (const [id, outcome] of failed) log.warn('complete_sync_failed', { source: id, error: outcome.error, instance: event.instanceId });
    if (failed.length) throw new Error(failed.map(([id, outcome]) => NAMES[id] + ': ' + outcome.error).join(' '));
    return outcomes;
  }

  private async sync(sourceId: string, step: WorkflowStep) {
    const bucket = createD1Bucket(this.env.APARTMENTS);
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await step.do(
        `Verify and save ${NAMES[sourceId]} inventory (attempt ${attempt + 1})`,
        { timeout: workflowSync(sourceId)?.stepTimeout ?? '13 minutes', retries: { limit: 0, delay: '1 second' } },
        () =>
          refreshSources(
            { ...this.env, BUCKET: bucket },
            {
              sourceId,
              onDemand: true,
              fetcher: (url, options) => fetch(url, { ...options, redirect: 'manual' }),
            },
          ),
      );
      if (result.state !== 'running') {
        const status = result.sources.find(({ id }) => id === sourceId);
        const error =
          result.state !== 'already_checked' && status?.status === 'failed'
            ? (status.error ?? `${NAMES[sourceId]} refresh failed.`)
            : undefined;
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
        await step.do(
          `Search Openigloo part ${index + 1} of ${OPENIGLOO_CELL_COUNT}`,
          { timeout: '20 minutes', retries: { limit: 2, delay: '2 minutes', backoff: 'linear' } },
          () => crawlOpeniglooCell(bucket, run, index, fetcher),
        );
      }
    } catch (cause) {
      return { state: 'failed', error: cause instanceof Error ? cause.message : 'The Openigloo search failed.' };
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await step.do(
        `Verify and save Openigloo inventory (attempt ${attempt + 1})`,
        { timeout: '10 minutes', retries: { limit: 0, delay: '1 second' } },
        () =>
          finishOpeniglooRun({ ...this.env, BUCKET: bucket }, run, fetcher).catch((cause: unknown) => ({
            state: 'failed',
            error: cause instanceof Error ? cause.message : 'Openigloo inventory could not be saved.',
          })),
      );
      if (result.state !== 'running') {
        const error =
          'error' in result
            ? result.error
            : result.status?.status === 'failed'
              ? (result.status.error ?? 'Openigloo refresh failed.')
              : undefined;
        return {
          state: result.state,
          ...('listingCount' in result ? { listingCount: result.listingCount } : {}),
          ...(error ? { error } : {}),
        };
      }
      await step.sleep(`Wait for active refresh before saving Openigloo ${attempt + 1}`, '15 seconds');
    }
    return { state: 'running', error: 'Another source refresh is already running.' };
  }
}
