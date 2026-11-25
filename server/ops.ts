/**
 * Running the business: a daily count of what people do (searches, saves, alerts set, checkouts started,
 * payments), kept in one document for the admin dashboard's funnel, and an email to the admins when sources that
 * were working start failing. The counts are only totals per day; nothing about who did what is kept.
 */
import * as v from 'valibot';
import { alertChannels } from './alerts.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { adminEmails } from './roles.ts';
import { checkedDocument } from './storage/stored-documents.ts';

export const EVENTS = ['search', 'save', 'alert', 'checkout', 'paid'] as const;
export type ProductEvent = (typeof EVENTS)[number];
const EVENTS_KEY = 'analytics/daily.json';
const FAILING_KEY = 'ops/failing.json';
/** Days of counts kept. */
const KEEP_DAYS = 90;
const DaysSchema = v.object({ days: v.record(v.string(), v.record(v.string(), v.number())) });
const FailingSchema = v.object({ names: v.array(v.string()), at: v.string() });

async function readDays(bucket: Bucket) {
  const object = await bucket.get(EVENTS_KEY);
  return (object && checkedDocument(DaysSchema, await object.json().catch(() => null), EVENTS_KEY)?.days) ?? {};
}

/** Counts one event for today (UTC). A failure to count never fails the request that caused it. */
export async function recordEvent(bucket: Bucket | undefined, event: ProductEvent, now = new Date()) {
  if (!bucket) return;
  try {
    const days = await readDays(bucket);
    const day = now.toISOString().slice(0, 10);
    const today = days[day] ?? {};
    today[event] = (today[event] ?? 0) + 1;
    days[day] = today;
    const kept = Object.fromEntries(
      Object.entries(days)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, KEEP_DAYS),
    );
    await bucket.put(EVENTS_KEY, JSON.stringify({ days: kept }));
  } catch (cause) {
    log.warn('event_not_counted', { event, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

/** Totals of each event over the last `days` days, and how many accounts were created then (from the sign-in database). */
export async function funnel(bucket: Bucket, days = 30, now = new Date(), signups = 0) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const totals = Object.fromEntries(EVENTS.map((event) => [event, 0])) as Record<ProductEvent, number>;
  const recorded = await readDays(bucket);
  for (const [day, counts] of Object.entries(recorded)) if (day > since) for (const event of EVENTS) totals[event] += counts[event] ?? 0;
  return { days, signups, ...totals };
}

/**
 * Emails the admins when sources that were working now fail; a source still failing from before is not
 * reported again. Returns the sources that newly failed.
 */
export async function warnAboutFailures(env: AppEnv & { BUCKET: Bucket }, failing: string[], now = new Date()) {
  const object = await env.BUCKET.get(FAILING_KEY);
  const before = (object && checkedDocument(FailingSchema, await object.json().catch(() => null), FAILING_KEY)?.names) ?? [];
  await env.BUCKET.put(FAILING_KEY, JSON.stringify({ names: failing, at: now.toISOString() }));
  const fresh = failing.filter((name) => !before.includes(name));
  const channels = alertChannels(env);
  const admins = adminEmails(env);
  if (!fresh.length || !channels.email || !channels.from || !admins.length) return fresh;
  const lines = fresh.map((name) => `• ${name}`).join('\n');
  try {
    await channels.email.send({
      from: channels.from,
      to: admins,
      subject: `Walkup: ${fresh.length} ${fresh.length === 1 ? 'source' : 'sources'} stopped working`,
      text: `These sources failed in the scheduled resync and were working before:\n${lines}\n\nProfile → Sources & sync shows why.`,
      html: `<p>These sources failed in the scheduled resync and were working before:</p><ul>${fresh
        .map((name) => `<li>${name.replace(/[<>&]/g, '')}</li>`)
        .join('')}</ul><p>Profile → Sources &amp; sync shows why.</p>`,
    });
  } catch (cause) {
    log.error('admin_warning_failed', cause);
  }
  return fresh;
}
