import type { ListingData } from '../src/domain.ts';
import { checkObservedChanges, MAX_BASELINE_UNITS, type ChangeBaseline, type ObservedChange } from '../src/observed-changes.ts';
import { localWorkplace, needsCommute, parseFilters, SearchInputError } from '../src/search.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { offline, search } from './search.ts';
import { sendPush, validSubscription, type PushSubscriptionJson, type VapidKeys } from './web-push.ts';
import * as v from 'valibot';

/**
 * Saved-search alerts. Nothing runs on a schedule: after a resync you start, the sync Workflow, or the
 * StreetEasy upload from your computer, each rule's matches are compared with its last check. New
 * apartments and price drops are sent by email and to the devices that turned on notifications. A rule's
 * first check only records a baseline, so creating one never sends a flood.
 */
const RULES_KEY = 'alerts/rules.json';
const DEVICES_KEY = 'alerts/devices.json';
const RECENT_KEY = 'alerts/recent.json';
const BASELINE_PREFIX = 'alerts/baselines/';
export const MAX_RULES = 10;
const MAX_DEVICES = 10;
const MAX_RECENT = 30;
const SHOWN_UNITS = 4;

type AlertRule = { id: string; name: string; filters: ReturnType<typeof parseFilters>; createdAt: string };
type AlertDevice = PushSubscriptionJson & { label: string; createdAt: string };
export type Alert = { id: string; at: string; ruleId: string; title: string; lines: string[]; newCount: number; dropCount: number };
export type AlertChannels = {
  email?: { send(message: { from: string; to: string[]; subject: string; text: string; html: string }): Promise<unknown> } | null;
  from?: string;
  to?: string[];
  vapid?: VapidKeys | null;
  pushFetcher?: (url: string, init: RequestInit) => Promise<Response>;
};

async function read<T>(bucket: Bucket, key: string, fallback: T): Promise<T> {
  const object = await bucket.get(key);
  return object ? ((await object.json()) as T) : fallback;
}
const write = (bucket: Bucket, key: string, value: unknown) => bucket.put(key, JSON.stringify(value));

export const readRules = (bucket: Bucket) => read<AlertRule[]>(bucket, RULES_KEY, []);
export const readDevices = (bucket: Bucket) => read<AlertDevice[]>(bucket, DEVICES_KEY, []);
export const readRecent = (bucket: Bucket) => read<Alert[]>(bucket, RECENT_KEY, []);

/** Checks a new rule: a name, and filters a stored search can run without routing or geocoding. */
const NAMED = 'Give the alert a name of up to 60 characters.';
/** A new rule as sent: a name, and filters checked by parseFilters. */
const NewRuleSchema = v.object(
  {
    name: v.pipe(v.string(NAMED), v.trim(), v.minLength(1, NAMED), v.maxLength(60, NAMED)),
    filters: v.nullish(v.unknown(), {}),
  },
  NAMED,
);

export function validateRule(raw: unknown, now = new Date()): AlertRule {
  const input = v.safeParse(NewRuleSchema, raw);
  if (!input.success) throw new SearchInputError(input.issues[0].message);
  const { name, filters: rawFilters } = input.output;
  const filters = parseFilters(rawFilters);
  if (needsCommute(filters))
    throw new SearchInputError(
      'Alerts cannot use commute-time limits or sorts, which need routing for every check. Remove them and try again.',
    );
  if (!localWorkplace(filters)) throw new SearchInputError('Alerts need a workplace preset or coordinates, not a typed address.');
  return {
    id: crypto.randomUUID(),
    name,
    filters: { ...filters, offset: 0, includeMap: false, includeCommute: false },
    createdAt: now.toISOString(),
  };
}

/** Saves a rule and records what it matches now, so its alerts report only changes from here on. */
export async function addRule(
  bucket: Bucket,
  raw: unknown,
  loadMatches: (filters: AlertRule['filters']) => Promise<ListingData[]>,
  now = new Date(),
) {
  const rule = validateRule(raw, now);
  const rules = await readRules(bucket);
  if (rules.length >= MAX_RULES) throw new SearchInputError(`You can keep up to ${MAX_RULES} alerts. Remove one first.`);
  const matches = await loadMatches(rule.filters);
  if (matches.length > MAX_BASELINE_UNITS)
    throw new SearchInputError(
      `This search matches more than ${MAX_BASELINE_UNITS.toLocaleString('en-US')} apartments. Narrow it before setting an alert.`,
    );
  await write(bucket, BASELINE_PREFIX + rule.id + '.json', checkObservedChanges(matches, null).baseline);
  await write(bucket, RULES_KEY, [...rules, rule]);
  return [...rules, rule];
}

export async function deleteRule(bucket: Bucket, id: unknown) {
  const rules = (await readRules(bucket)).filter((rule) => rule.id !== id);
  await write(bucket, RULES_KEY, rules);
  return rules;
}

export async function addDevice(bucket: Bucket, raw: unknown, label: unknown, now = new Date()) {
  if (!validSubscription(raw)) throw new SearchInputError('This browser returned a notification subscription the app cannot use.');
  const devices = (await readDevices(bucket)).filter(({ endpoint }) => endpoint !== raw.endpoint);
  const device = {
    endpoint: raw.endpoint,
    keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : 'This device',
    createdAt: now.toISOString(),
  };
  const next = [...devices, device].slice(-MAX_DEVICES);
  await write(bucket, DEVICES_KEY, next);
  return next;
}

export async function removeDevice(bucket: Bucket, endpoint: unknown) {
  const devices = (await readDevices(bucket)).filter((device) => device.endpoint !== endpoint);
  await write(bucket, DEVICES_KEY, devices);
  return devices;
}

const money = (rent: number) => '$' + rent.toLocaleString('en-US');

/** The alert for one rule, or null when nothing new matched and no price dropped. */
export function composeAlert(rule: AlertRule, changes: ObservedChange[], now: Date): Alert | null {
  const added = changes.filter(({ kind }) => kind === 'newly_encountered');
  const drops = changes.filter(({ kind, current, previous }) => kind === 'price' && previous && current.rent < previous.rent);
  if (!added.length && !drops.length) return null;
  const parts = [
    added.length && `${added.length} new ${added.length === 1 ? 'apartment' : 'apartments'}`,
    drops.length && `${drops.length} price ${drops.length === 1 ? 'drop' : 'drops'}`,
  ].filter(Boolean);
  const lines = [
    ...drops.map(({ current, previous }) => `${current.label}: ${money(previous!.rent)} → ${money(current.rent)}`),
    ...added.map(({ current }) => `${current.label}: ${money(current.rent)}`),
  ];
  const hidden = lines.length - SHOWN_UNITS;
  return {
    id: crypto.randomUUID(),
    at: now.toISOString(),
    ruleId: rule.id,
    title: `${rule.name}: ${parts.join(', ')}`,
    lines: hidden > 0 ? [...lines.slice(0, SHOWN_UNITS), `and ${hidden} more`] : lines,
    newCount: added.length,
    dropCount: drops.length,
  };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Sends the alerts by email (one message) and to each device (one notification per alert). */
export async function deliver(bucket: Bucket, alerts: Alert[], channels: AlertChannels, origin: string) {
  const delivered = { email: false, devices: 0 };
  if (!alerts.length) return delivered;
  if (channels.email && channels.from && channels.to?.length) {
    const subject = alerts.length === 1 ? alerts[0].title : `${alerts.length} apartment alerts`;
    const text =
      alerts.map((alert) => [alert.title, ...alert.lines.map((line) => '• ' + line)].join('\n')).join('\n\n') +
      `\n\nOpen Apartment Search: ${origin}/`;
    const html =
      alerts
        .map((alert) => `<h3>${escapeHtml(alert.title)}</h3><ul>${alert.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`)
        .join('') + `<p><a href="${escapeHtml(origin)}/">Open Apartment Search</a></p>`;
    try {
      await channels.email.send({ from: channels.from, to: channels.to, subject, text, html });
      delivered.email = true;
    } catch (cause) {
      log.error('alert_email_failed', cause);
    }
  }
  if (channels.vapid) {
    const devices = await readDevices(bucket);
    const gone = new Set<string>();
    for (const device of devices) {
      for (const alert of alerts) {
        try {
          const result = await sendPush(
            device,
            { title: alert.title, body: alert.lines.join('\n'), tag: alert.ruleId, url: '/' },
            channels.vapid,
            { fetcher: channels.pushFetcher },
          );
          if (result.gone) {
            gone.add(device.endpoint);
            break;
          }
          if (result.ok) delivered.devices++;
          else log.warn('alert_push_failed', { status: result.status, device: device.label });
        } catch (cause) {
          log.error('alert_push_failed', cause, { device: device.label });
        }
      }
    }
    if (gone.size)
      await write(
        bucket,
        DEVICES_KEY,
        devices.filter(({ endpoint }) => !gone.has(endpoint)),
      );
  }
  return delivered;
}

/**
 * Compares every rule with its last check and delivers what changed. `loadMatches` returns all saved
 * matches for a rule's filters without contacting any provider.
 */
export async function checkAlerts(
  bucket: Bucket,
  loadMatches: (filters: AlertRule['filters']) => Promise<ListingData[]>,
  channels: AlertChannels,
  { origin, now = new Date() }: { origin: string; now?: Date },
) {
  const alerts: Alert[] = [];
  for (const rule of await readRules(bucket)) {
    try {
      const matches = await loadMatches(rule.filters);
      if (matches.length > MAX_BASELINE_UNITS) {
        log.warn('alert_rule_too_broad', { rule: rule.id, matches: matches.length });
        continue;
      }
      const key = BASELINE_PREFIX + rule.id + '.json';
      const baseline = await read<ChangeBaseline | null>(bucket, key, null);
      const result = checkObservedChanges(matches, baseline);
      await write(bucket, key, result.baseline);
      const alert = baseline ? composeAlert(rule, result.changes, now) : null;
      if (alert) alerts.push(alert);
    } catch (cause) {
      log.error('alert_check_failed', cause, { rule: rule.id });
    }
  }
  if (!alerts.length) return { alerts, delivered: { email: false, devices: 0 } };
  await write(bucket, RECENT_KEY, [...alerts, ...(await readRecent(bucket))].slice(0, MAX_RECENT));
  const delivered = await deliver(bucket, alerts, channels, origin);
  log.info('alerts_sent', { alerts: alerts.length, email: delivered.email, devices: delivered.devices });
  return { alerts, delivered };
}

/** The channels alerts can use: email when the Email Service binding and sender are set, push when VAPID keys are. */
export function alertChannels(env: AppEnv): AlertChannels {
  const to = (env.ACCESS_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
  return {
    email: env.ALERT_EMAIL && env.ALERT_EMAIL_FROM && to.length ? env.ALERT_EMAIL : null,
    from: env.ALERT_EMAIL_FROM,
    to,
    vapid:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
        : null,
  };
}

/** A rule's current matches, from saved inventory only. */
export const alertMatches = (env: AppEnv) => async (filters: AlertRule['filters']) => (await search(filters, env, offline, true)).matches;

/** Checks every saved alert against the saved inventory; runs after refreshes, never on a schedule. */
export async function runAlerts(env: AppEnv, origin = env.APP_ORIGIN ?? '') {
  if (!env.BUCKET) return null;
  return checkAlerts(env.BUCKET, alertMatches(env), alertChannels(env), { origin });
}

/** What the Alerts page shows: rules, recent alerts, devices (without their push addresses) and the channels set up. */
export async function alertState(env: AppEnv & { BUCKET: Bucket }) {
  const channels = alertChannels(env);
  const [rules, devices, recent] = await Promise.all([readRules(env.BUCKET), readDevices(env.BUCKET), readRecent(env.BUCKET)]);
  return {
    rules,
    recent,
    devices: devices.map(({ label, createdAt }) => ({ label, createdAt })),
    channels: { email: Boolean(channels.email), push: channels.vapid ? { publicKey: channels.vapid.publicKey } : null },
  };
}
