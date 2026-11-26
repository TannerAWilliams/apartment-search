/**
 * Scheduled resyncs. Cloudflare wakes the Worker at the top of every hour (UTC); what runs depends on the hour in
 * New York, so daylight saving time is followed:
 * - 1 AM, the nightly resync: every source. Quick sources are checked at once; the slower ones and the complete
 *   inventories run in the sync Workflow, which then checks saved alerts.
 * - Every two hours from 8 AM to 10 PM, the daytime check: the quick sources only, then alerts, so new apartments
 *   are reported within a couple of hours instead of the next morning.
 * An admin turns either one off on their profile.
 */
import { refreshOpenData } from './open-data.ts';
import * as v from 'valibot';
import type { AppEnv, Bucket, SourceFetch } from './contracts.ts';
import { log } from './log.ts';
import { refreshSources } from './refresh.ts';
import { runAlerts } from './alerts.ts';
import { warnAboutFailures } from './ops.ts';
import { isDigestHour, runDigest } from './digest.ts';
import type { SyncJob } from './routes/context.ts';
import { checkedDocument } from './storage/stored-documents.ts';
import { refreshInventory } from './inventory.ts';

const SETTINGS_KEY = 'settings/platform.json';
const RunSchema = v.object({ at: v.string(), state: v.string(), updated: v.number(), failed: v.number() });
const SettingsSchema = v.object({
  nightlyResync: v.boolean(),
  daytimeChecks: v.optional(v.boolean(), true),
  lastDaytime: v.optional(RunSchema),
  lastNightly: v.optional(v.object({ ...RunSchema.entries, background: v.boolean() })),
});
export type PlatformSettings = v.InferOutput<typeof SettingsSchema>;
const DEFAULTS: PlatformSettings = { nightlyResync: true, daytimeChecks: true };

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
  return updateSettings(bucket, { nightlyResync: enabled });
}

/** Turns the nightly resync or the daytime checks on or off, keeping the records of their last runs. */
export async function updateSettings(bucket: Bucket, change: { nightlyResync?: boolean; daytimeChecks?: boolean }) {
  const set = Object.fromEntries(Object.entries(change).filter(([, value]) => typeof value === 'boolean'));
  return writeSettings(bucket, { ...(await readSettings(bucket)), ...set });
}

const EASTERN_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
/** Whether it is the 1 AM hour in New York, whichever of the two UTC wake-ups this is. */
export const isNightlyHour = (now: Date) => Number(EASTERN_HOUR.format(now)) === 1;
/** The New York hours of the daytime checks: every two hours from 8 AM to 10 PM. */
export const DAYTIME_HOURS = [8, 10, 12, 14, 16, 18, 20, 22];
export const isDaytimeHour = (now: Date) => DAYTIME_HOURS.includes(Number(EASTERN_HOUR.format(now)));

type ScheduledDeps = { fetcher: SourceFetch; syncJob?: SyncJob; now?: Date };

/** What the hourly wake-up does: the nightly resync at 1 AM, a daytime check every two hours, otherwise nothing. */
export async function runScheduled(env: AppEnv & { BUCKET: Bucket }, deps: ScheduledDeps) {
  const outcome = await runHour(env, deps);
  // Each hour, whatever ran: the inventory file follows the listings, and listings age out with time alone.
  await refreshInventory(env, deps.now).catch((cause) => log.error('inventory_build_failed', cause));
  return outcome;
}

async function runHour(env: AppEnv & { BUCKET: Bucket }, deps: ScheduledDeps) {
  const now = deps.now ?? new Date();
  if (isNightlyHour(now)) return runNightly(env, { ...deps, now });
  if (isDaytimeHour(now)) return runDaytime(env, { fetcher: deps.fetcher, now });
  if (isDigestHour(now)) return `digest:${await runDigest(env, { now })}`;
  // Quiet hours keep the subway stations, rail stops and rent registry loaded (each is fetched once a month);
  // the nightly run does it too, but only once every source has synced.
  const refreshed = await refreshOpenData(env.BUCKET, deps.fetcher, now).catch(() => []);
  return refreshed.length ? `open-data:${refreshed.join(',')}` : 'idle';
}

/** The daytime check: the quick sources, then alerts. Says what it did. */
export async function runDaytime(env: AppEnv & { BUCKET: Bucket }, { fetcher, now = new Date() }: ScheduledDeps) {
  if (!isDaytimeHour(now)) return 'not-daytime';
  if (!(await readSettings(env.BUCKET)).daytimeChecks) return 'off';
  const result = await refreshSources(env, { onDemand: true, fetcher, now, excludeWorkflowSources: true });
  const checked = result.sources.filter(({ checkedAt }) => checkedAt === now.toISOString());
  const updated = checked.filter(({ status }) => status === 'updated' || status === 'current').length;
  const failed = checked.filter(({ status }) => status === 'failed').length;
  await runAlerts(env);
  await writeSettings(env.BUCKET, {
    ...(await readSettings(env.BUCKET)),
    lastDaytime: { at: now.toISOString(), state: result.state, updated, failed },
  });
  log.info('daytime_check_ran', { state: result.state, updated, failed });
  return 'ran';
}

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
  // Admins hear about sources that were working and now fail.
  await warnAboutFailures(
    env,
    result.sources.filter(({ status }) => status === 'failed').map(({ name, error }) => ({ name, error })),
    now,
  );
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
