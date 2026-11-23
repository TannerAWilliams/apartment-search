/** The app's configuration and the listing sources: their saved status, and resyncs you start. */
import { vValidator } from '@hono/valibot-validator';
import { decodeSourceImport } from '../../src/source-import.ts';
import { runAlerts } from '../alerts.ts';
import { appConfig, savedAppConfig } from '../app-config.ts';
import { CITYREALTY_ID } from '../cityrealty.ts';
import { log } from '../log.ts';
import { refreshCatalog, refreshPlan, refreshSources } from '../refresh.ts';
import { WORKFLOW_SOURCE_IDS } from '../source-registry.ts';
import type { AppEnv } from '../contracts.ts';
import { type ApiServices, apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { RefreshRequestSchema } from './inputs.ts';

/** After a refresh that saved anything, checks the alerts once the response is sent. */
const alertsAfter = (env: AppEnv, waitUntil: ApiServices['waitUntil'], url: string) => (result: { state: string }) => {
  if (['complete', 'partial'].includes(result.state)) waitUntil?.(runAlerts(env, env.APP_ORIGIN ?? new URL(url).origin)
    .catch((cause) => log.error('alert_check_failed', cause)));
};

export const sourceRoutes = factory.createApp()
  .get('/config', async (c) => {
    const env = c.var.appEnv;
    let config;
    try { config = appConfig(env); }
    catch (cause) {
      log.error('feed_settings_invalid', cause);
      return fail(c, 503, 'The free feed settings need to be corrected on the server.');
    }
    if (!env.BUCKET) return c.json(config, 200);
    try { return c.json(await savedAppConfig({ ...env, BUCKET: env.BUCKET }, config), 200); }
    catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'Saved source data could not be read. Try again shortly.');
    }
  })
  .get('/refresh', async (c) => {
    const { appEnv: env, services: { syncJob } } = c.var;
    const plan = await refreshPlan(env.BUCKET);
    const running = plan.checking || !syncJob ? null : await syncJob.pending();
    // The Workflow names the source it is on; a job that only reports "running" is CityRealty's.
    return c.json(running ? { ...plan, checking: true, activeSource: typeof running === 'string' ? running : CITYREALTY_ID } : plan, 200);
  })
  .post('/refresh', needsStorage('A private hosted site with saved storage is required to refresh sources.'), apiBodies,
    vValidator('json', RefreshRequestSchema, refuse), async (c) => {
      const { appEnv, bucket, services: { fetcher, syncJob, waitUntil } } = c.var;
      const env = { ...appEnv, BUCKET: bucket };
      const body = c.req.valid('json');
      const source = body.source;
      const afterRefresh = alertsAfter(env, waitUntil, c.req.url);
      if ('check' in body) {
        // The app no longer checks sources when it opens. A page loaded before that change still asks
        // with sessionStart; it gets the saved status and nothing is fetched.
        if (body.sessionStart === true) return c.json({ ...await refreshPlan(bucket), state: 'already_checked' }, 200);
        if (source !== undefined && !refreshCatalog(env).some((item) => item.id === source && item.resyncable)) {
          return fail(c, 422, 'Unknown or disconnected refresh source.');
        }
        if (syncJob && source !== undefined && WORKFLOW_SOURCE_IDS.includes(source)) {
          const current = await refreshPlan(bucket);
          const previous = current.sources.find(item => item.id === source);
          if (previous?.retryAt && Date.parse(previous.retryAt) > Date.now()) return c.json({ ...current, state: 'already_checked' }, 200);
          if (!current.checking || current.activeSource !== source) await syncJob.start(Boolean(current.checking), [source]);
          return c.json({ ...current, state: 'running', checking: true, activeSource: source }, 202);
        }
        const work = refreshSources(env, { fetcher, onDemand: true, sourceId: source, excludeWorkflowSources: Boolean(syncJob) });
        if (syncJob && source === undefined) {
          try { await syncJob.start(true); }
          catch (cause) { await work.catch(() => {}); throw cause; }
        }
        waitUntil?.(work.then(afterRefresh, () => {}));
        return c.json(await work, 200);
      }
      let imports;
      try { imports = decodeSourceImport(body); }
      catch { return fail(c, 422, 'Send a valid compressed source import.'); }
      const result = await refreshSources(env, { fetcher, imports, fallback: body.fallback === true, onlyStreetEasy: source === 'streeteasy-live' });
      afterRefresh(result);
      const unavailable = result.state === 'partial' && result.sources.every(({ status }) => status === 'failed' || status === 'feed_required');
      return c.json(result, unavailable ? 502 : 200);
    });
