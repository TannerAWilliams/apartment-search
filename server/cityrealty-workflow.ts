import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { AppEnv } from './contracts.ts';
import { CITYREALTY_ID } from './cityrealty.ts';
import { createD1Bucket, type D1Database } from './d1-bucket.ts';
import { refreshSources } from './refresh.ts';

type Environment = AppEnv & { APARTMENTS: D1Database };
type RefreshParameters = { delay: boolean };

export class CityRealtySync extends WorkflowEntrypoint<Environment, RefreshParameters> {
  async run(event: WorkflowEvent<RefreshParameters>, step: WorkflowStep) {
    if (event.payload.delay) await step.sleep('Give other sources time to start', '3 seconds');
    const bucket = createD1Bucket(this.env.APARTMENTS);
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await step.do(`Verify and save CityRealty inventory (attempt ${attempt + 1})`,
        { timeout: '13 minutes', retries: { limit: 0, delay: '1 second' } },
        () => refreshSources({ ...this.env, BUCKET: bucket }, {
          sourceId: CITYREALTY_ID, onDemand: true, forceRefresh: true,
          fetcher: (url, options) => fetch(url, { ...options, redirect: 'manual' }),
        }));
      if (result.state !== 'running') {
        const status = result.sources.find(({ id }) => id === CITYREALTY_ID);
        if (result.state !== 'already_checked' && status?.status === 'failed') {
          throw new Error(status.error ?? 'CityRealty refresh failed.');
        }
        return { state: result.state, listingCount: status?.listingCount };
      }
      await step.sleep(`Wait for active refresh ${attempt + 1}`, '15 seconds');
    }
    throw new Error('Another source refresh is already running.');
  }
}
