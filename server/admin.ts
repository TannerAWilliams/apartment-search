/**
 * The admin dashboard: how the business and the platform are doing, from what the app already keeps. Members and
 * plans, what payments bring in each month (estimated from the plan prices), alerts, the public data loaded, and
 * the sources and scheduled runs.
 */
import { funnel } from './ops.ts';
import type { D1Database } from './storage/d1-bucket.ts';
import { readRecent, readRules, readDevices } from './alerts.ts';
import { readBilling } from './billing.ts';
import { readBuildingFacts } from './building-facts.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { readSettings } from './nightly.ts';
import { REGISTRY_KEY, STATIONS_KEY } from './open-data.ts';
import { paidEmails } from './plans.ts';
import { refreshStatus } from './refresh/status.ts';
import { addresses } from './roles.ts';

/** The plan prices, in dollars per month, for the revenue estimate. */
export const MONTHLY_PRICE = 15;
export const PASS_PRICE_PER_MONTH = 35 / 3;

async function documentDate(bucket: Bucket, key: string) {
  const object = await bucket.get(key);
  const data = object ? await object.json<{ checkedAt?: unknown; buildings?: object; stations?: unknown[] }>().catch(() => null) : null;
  return {
    checkedAt: typeof data?.checkedAt === 'string' ? data.checkedAt : null,
    count: data?.buildings ? Object.keys(data.buildings).length : Array.isArray(data?.stations) ? data.stations.length : 0,
  };
}

/** Accounts created in the last 30 days, from the sign-in database. */
async function recentSignups(database: D1Database | undefined, now: Date) {
  if (!database) return 0;
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const row = await database.prepare('SELECT count(*) AS count FROM "user" WHERE "createdAt" >= ?1').bind(since).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function adminStats(env: AppEnv & { BUCKET: Bucket }, now = new Date(), database?: D1Database) {
  const bucket = env.BUCKET;
  const [paid, billing, rules, devices, recent, settings, status, facts, registry, stations] = await Promise.all([
    paidEmails(env, bucket, now),
    readBilling(bucket),
    readRules(bucket),
    readDevices(bucket),
    readRecent(bucket),
    readSettings(bucket),
    refreshStatus(bucket),
    readBuildingFacts(bucket),
    documentDate(bucket, REGISTRY_KEY),
    documentDate(bucket, STATIONS_KEY),
  ]);
  const allowed = new Set(addresses(env.ACCESS_ALLOWED_EMAILS));
  const active = Object.values(billing.accounts).filter(({ until }) => Date.parse(until) > now.getTime());
  const monthly = active.filter(({ plan }) => plan === 'monthly').length;
  const passes = active.length - monthly;
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const failed = status.sources.filter(({ status: state }) => state === 'failed');
  return {
    members: { total: new Set([...allowed, ...paid]).size, paid: paid.size, free: [...allowed].filter((email) => !paid.has(email)).length },
    payments: { monthly, passes, estimatedMonthlyRevenue: Math.round(monthly * MONTHLY_PRICE + passes * PASS_PRICE_PER_MONTH) },
    alerts: {
      rules: rules.length,
      accounts: new Set(rules.map(({ owner }) => owner ?? '')).size,
      devices: devices.length,
      sentThisWeek: recent.filter(({ at }) => Date.parse(at) >= weekAgo).length,
    },
    data: { stabilizedBuildings: registry, subwayStations: stations, buildingsChecked: Object.keys(facts).length },
    sources: {
      total: status.sources.length,
      failed: failed.map(({ name }) => name),
      lastCheckedAt: status.lastCheckedAt,
    },
    runs: { nightly: settings.lastNightly ?? null, daytime: settings.lastDaytime ?? null },
    funnel: await funnel(bucket, 30, now, await recentSignups(database, now)),
  };
}
