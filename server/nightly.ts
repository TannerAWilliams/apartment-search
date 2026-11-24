/**
 * The nightly resync: every source is checked at 1 AM Eastern, unless an admin turned it off on their profile.
 * Cloudflare runs scheduled Workers on UTC, so the Worker is woken at 05:00 and 06:00 UTC (1 AM in daylight and in
 * standard time) and only the wake-up that falls at 1 AM in New York does the work. Quick sources are checked at
 * once; the slower ones and the complete inventories run in the sync Workflow, which then checks saved alerts.
 */
import * as v from 'valibot';
import type { AppEnv, Bucket, SourceFetch } from './contracts.ts';
import { log } from './log.ts';
import { refreshSources } from './refresh.ts';
import { runAlerts } from './alerts.ts';
import type { SyncJob } from './routes/context.ts';
import { checkedDocument } from './storage/stored-documents.ts';

const SETTINGS_KEY = 'settings/platform.json';
const SettingsSchema = v.object({
  nightlyResync: v.boolean(),
  lastNightly: v.optional(
    v.object({
      at: v.string(),
      state: v.string(),
      updated: v.number(),
      failed: v.number(),
      background: v.boolean(),
    }),
  ),
});
export type PlatformSettings = v.InferOutput<typeof SettingsSchema>;
const DEFAULTS: PlatformSettings = { nightlyResync: true };

export async function readSettings(bucket: Bucket): Promise<PlatformSettings> {
  const object = await bucket.get(SETTINGS_KEY);
  return (object && checkedDocument(SettingsSchema, await object.json().catch(() => null), SETTINGS_KEY)) ?? DEFAULTS;
}

async function writeSettings(bucket: Bucket, settings: PlatformSettings) {
  await bucket.put(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

/** Turns the nightly resync on or off, keeping the record of its last run. */
export async function setNightlyResync(bucket: Bucket, enabled: boolean) {
  return writeSettings(bucket, { ...(await readSettings(bucket)), nightlyResync: enabled });
}

const EASTERN_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
/** Whether it is the 1 AM hour in New York, whichever of the two UTC wake-ups this is. */
export const isNightlyHour = (now: Date) => Number(EASTERN_HOUR.format(now)) === 1;

/** Runs the nightly resync if it is 1 AM in New York and it is turned on; says what it did. */
export async function runNightly(
  env: AppEnv & { BUCKET: Bucket },
  { fetcher, syncJob, now = new Date() }: { fetcher: SourceFetch; syncJob?: SyncJob; now?: Date },
) {
  if (!isNightlyHour(now)) return 'not-1am';
  const settings = await readSettings(env.BUCKET);
  if (!settings.nightlyResync) {
    log.info('nightly_resync_skipped', { reason: 'turned off' });
    return 'off';
  }
  const result = await refreshSources(env, { onDemand: true, fetcher, now, excludeWorkflowSources: Boolean(syncJob) });
  const checked = result.sources.filter(({ checkedAt }) => checkedAt === now.toISOString());
  const updated = checked.filter(({ status }) => status === 'updated' || status === 'current').length;
  const failed = checked.filter(({ status }) => status === 'failed').length;
  let background = false;
  if (syncJob) {
    try {
      await syncJob.start(true);
      background = true;
    } catch (cause) {
      log.error('nightly_workflow_failed', cause);
    }
  }
  // The Workflow checks alerts when its sources finish; without it, they are checked here.
  if (!background) await runAlerts(env);
  await writeSettings(env.BUCKET, {
    ...(await readSettings(env.BUCKET)),
    lastNightly: { at: now.toISOString(), state: result.state, updated, failed, background },
  });
  log.info('nightly_resync_ran', { state: result.state, updated, failed, background });
  return 'ran';
}
