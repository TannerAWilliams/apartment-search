import type { ListingData } from '../src/domain.ts';
import { checkObservedChanges, MAX_BASELINE_UNITS, parseChangeBaseline, type ObservedChange } from '../src/observed-changes.ts';
import { localWorkplace, needsCommute, parseFilters, SearchInputError } from '../src/search.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { AlertDevicesSchema, AlertRulesSchema, checkedDocument, RecentAlertsSchema } from './storage/stored-documents.ts';
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

/** Any of these bedroom counts (studio = 0) and any of these neighborhoods; an empty list means any. */
export type AlertCriteria = { bedrooms: number[]; neighborhoods: string[] };
type AlertRule = {
  id: string;
  name: string;
  filters: ReturnType<typeof parseFilters>;
  createdAt: string;
  /** The account the alert belongs to; its email is the only one the alert goes to. */
  owner?: string;
  criteria?: AlertCriteria;
};
type AlertDevice = PushSubscriptionJson & { label: string; createdAt: string; owner?: string };
export type Alert = {
  id: string;
  at: string;
  ruleId: string;
  title: string;
  lines: string[];
  newCount: number;
  dropCount: number;
  owner?: string;
};
export type AlertChannels = {
  email?: { send(message: { from: string; to: string[]; subject: string; text: string; html: string }): Promise<unknown> } | null;
  from?: string;
  to?: string[];
  vapid?: VapidKeys | null;
  pushFetcher?: (url: string, init: RequestInit) => Promise<Response>;
};

/** A saved document checked against its schema; a missing or unrecognized one reads as the fallback. */
async function read<S extends v.GenericSchema>(bucket: Bucket, key: string, schema: S, fallback: v.InferOutput<S>) {
  const object = await bucket.get(key);
  return (object && checkedDocument(schema, await object.json().catch(() => null), key)) ?? fallback;
}
const write = (bucket: Bucket, key: string, value: unknown) => bucket.put(key, JSON.stringify(value));

async function readBaseline(bucket: Bucket, key: string) {
  const raw = (await (await bucket.get(key))?.text()) ?? null;
  try {
    return parseChangeBaseline(raw);
  } catch (cause) {
    log.warn('stored_document_invalid', { key, issue: cause instanceof Error ? cause.message : 'unreadable' });
    return null;
  }
}

// Rules hold filters that parseFilters produced when the rule was created.
export const readRules = (bucket: Bucket): Promise<AlertRule[]> => read(bucket, RULES_KEY, AlertRulesSchema, []);
export const readDevices = (bucket: Bucket): Promise<AlertDevice[]> => read(bucket, DEVICES_KEY, AlertDevicesSchema, []);
export const readRecent = (bucket: Bucket): Promise<Alert[]> => read(bucket, RECENT_KEY, RecentAlertsSchema, []);

/** Checks a new rule: a name, and filters a stored search can run without routing or geocoding. */
const NAMED = 'Give the alert a name of up to 60 characters.';
const BEDS = 'Choose bedroom counts from studio to 4.';
const NEIGHBORHOODS = 'Choose up to 20 neighborhoods.';
/** A new rule as sent: a name, filters checked by parseFilters, and optional bedroom counts and neighborhoods. */
const NewRuleSchema = v.object(
  {
    name: v.pipe(v.string(NAMED), v.trim(), v.minLength(1, NAMED), v.maxLength(60, NAMED)),
    filters: v.nullish(v.unknown(), {}),
    criteria: v.optional(
      v.object({
        bedrooms: v.optional(
          v.pipe(v.array(v.pipe(v.number(BEDS), v.integer(BEDS), v.minValue(0, BEDS), v.maxValue(4, BEDS)), BEDS), v.maxLength(5, BEDS)),
          [],
        ),
        neighborhoods: v.optional(
          v.pipe(
            v.array(
              v.pipe(v.string(NEIGHBORHOODS), v.trim(), v.minLength(1, NEIGHBORHOODS), v.maxLength(60, NEIGHBORHOODS)),
              NEIGHBORHOODS,
            ),
            v.maxLength(20, NEIGHBORHOODS),
          ),
          [],
        ),
      }),
    ),
  },
  NAMED,
);

/** A neighborhood name compared without case or punctuation: "West Village" and "west-village" are one. */
const placeKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The listings an alert's bedroom counts and neighborhoods allow. A listing with no neighborhood counts as in one
 * when its ZIP code is one where other listings in that neighborhood are.
 */
export function matchesCriteria(listings: ListingData[], criteria: AlertCriteria | undefined) {
  if (!criteria) return listings;
  const beds = new Set(criteria.bedrooms);
  const wanted = new Set(criteria.neighborhoods.map(placeKey));
  const zips = new Set(listings.filter(({ neighborhood }) => neighborhood && wanted.has(placeKey(neighborhood))).map(({ zip }) => zip));
  return listings.filter(
    (listing) =>
      (!beds.size || beds.has(listing.bedrooms)) &&
      (!wanted.size || (listing.neighborhood ? wanted.has(placeKey(listing.neighborhood)) : zips.has(listing.zip))),
  );
}

export function validateRule(raw: unknown, now = new Date(), owner?: string): AlertRule {
  const input = v.safeParse(NewRuleSchema, raw);
  if (!input.success) throw new SearchInputError(input.issues[0].message);
  const { name, filters: rawFilters, criteria: rawCriteria } = input.output;
  const criteria = rawCriteria && {
    bedrooms: [...new Set(rawCriteria.bedrooms)].sort((a, b) => a - b),
    neighborhoods: rawCriteria.neighborhoods.filter(
      (name, index, all) => all.findIndex((other) => placeKey(other) === placeKey(name)) === index,
    ),
  };
  const parsed = parseFilters(rawFilters);
  // Several bedroom counts are matched after the search, so the search itself takes any.
  const filters = criteria?.bedrooms.length ? { ...parsed, bedrooms: null } : parsed;
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
    ...(owner ? { owner } : {}),
    ...(criteria && (criteria.bedrooms.length || criteria.neighborhoods.length) ? { criteria } : {}),
  };
}

/** Saves a rule and records what it matches now, so its alerts report only changes from here on. */
export async function addRule(
  bucket: Bucket,
  raw: unknown,
  loadMatches: (filters: AlertRule['filters']) => Promise<ListingData[]>,
  now = new Date(),
  owner?: string,
) {
  const rule = validateRule(raw, now, owner);
  const rules = await readRules(bucket);
  if (rules.filter((item) => item.owner === owner).length >= MAX_RULES)
    throw new SearchInputError(`You can keep up to ${MAX_RULES} alerts. Remove one first.`);
  const matches = matchesCriteria(await loadMatches(rule.filters), rule.criteria);
  if (matches.length > MAX_BASELINE_UNITS)
    throw new SearchInputError(
      `This search matches more than ${MAX_BASELINE_UNITS.toLocaleString('en-US')} apartments. Narrow it before setting an alert.`,
    );
  await write(bucket, BASELINE_PREFIX + rule.id + '.json', checkObservedChanges(matches, null).baseline);
  await write(bucket, RULES_KEY, [...rules, rule]);
  return [...rules, rule];
}

/** Removes one of this account's alerts; another account's alert is left alone. */
export async function deleteRule(bucket: Bucket, id: unknown, owner?: string) {
  const rules = (await readRules(bucket)).filter((rule) => !(rule.id === id && rule.owner === owner));
  await write(bucket, RULES_KEY, rules);
  return rules;
}

export async function addDevice(bucket: Bucket, raw: unknown, label: unknown, now = new Date(), owner?: string) {
  if (!validSubscription(raw)) throw new SearchInputError('This browser returned a notification subscription the app cannot use.');
  const devices = (await readDevices(bucket)).filter(({ endpoint }) => endpoint !== raw.endpoint);
  const device = {
    endpoint: raw.endpoint,
    keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : 'This device',
    createdAt: now.toISOString(),
    ...(owner ? { owner } : {}),
  };
  const next = [...devices, device].slice(-MAX_DEVICES);
  await write(bucket, DEVICES_KEY, next);
  return next;
}

export async function removeDevice(bucket: Bucket, endpoint: unknown, owner?: string) {
  const devices = (await readDevices(bucket)).filter((device) => !(device.endpoint === endpoint && device.owner === owner));
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
    ...(rule.owner ? { owner: rule.owner } : {}),
  };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * Sends the alerts by email (one message per account, to that account's address only) and to each device of the
 * account the alert belongs to (one notification per alert). Alerts made before accounts had their own go to every
 * allowed address and to devices added the same way.
 */
export async function deliver(bucket: Bucket, alerts: Alert[], channels: AlertChannels, origin: string) {
  const delivered = { email: false, devices: 0 };
  if (!alerts.length) return delivered;
  const owners = [...new Set(alerts.map(({ owner }) => owner))];
  for (const owner of owners) {
    const to = owner ? [owner] : (channels.to ?? []);
    if (
      await sendEmail(
        alerts.filter((alert) => alert.owner === owner),
        channels,
        to,
        origin,
      )
    )
      delivered.email = true;
  }
  if (channels.vapid) delivered.devices = await sendPushes(bucket, alerts, channels.vapid, channels.pushFetcher);
  return delivered;
}

async function sendEmail(alerts: Alert[], channels: AlertChannels, to: string[], origin: string) {
  if (!channels.email || !channels.from || !to.length) return false;
  const subject = alerts.length === 1 ? alerts[0].title : `${alerts.length} apartment alerts`;
  const text =
    alerts.map((alert) => [alert.title, ...alert.lines.map((line) => '• ' + line)].join('\n')).join('\n\n') + `\n\nOpen Walkup: ${origin}/`;
  const html =
    alerts
      .map((alert) => `<h3>${escapeHtml(alert.title)}</h3><ul>${alert.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`)
      .join('') + `<p><a href="${escapeHtml(origin)}/">Open Walkup</a></p>`;
  try {
    await channels.email.send({ from: channels.from, to, subject, text, html });
    return true;
  } catch (cause) {
    log.error('alert_email_failed', cause);
    return false;
  }
}

async function sendPushes(
  bucket: Bucket,
  alerts: Alert[],
  vapid: NonNullable<AlertChannels['vapid']>,
  fetcher: AlertChannels['pushFetcher'],
) {
  let sent = 0;
  const devices = await readDevices(bucket);
  const gone = new Set<string>();
  for (const device of devices) {
    for (const alert of alerts.filter(({ owner }) => owner === device.owner)) {
      try {
        const result = await sendPush(device, { title: alert.title, body: alert.lines.join('\n'), tag: alert.ruleId, url: '/' }, vapid, {
          fetcher,
        });
        if (result.gone) {
          gone.add(device.endpoint);
          break;
        }
        if (result.ok) sent++;
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
  return sent;
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
      const matches = matchesCriteria(await loadMatches(rule.filters), rule.criteria);
      if (matches.length > MAX_BASELINE_UNITS) {
        log.warn('alert_rule_too_broad', { rule: rule.id, matches: matches.length });
        continue;
      }
      const key = BASELINE_PREFIX + rule.id + '.json';
      // An unrecognized baseline is dropped, so the rule records a new one instead of sending a flood.
      const baseline = await readBaseline(bucket, key);
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
    // Each account's alerts go to its own address, so email works once the binding and sender are set.
    email: env.ALERT_EMAIL && env.ALERT_EMAIL_FROM ? env.ALERT_EMAIL : null,
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

/**
 * What the Alerts page shows one account: its rules, recent alerts and devices (without their push addresses),
 * and the channels set up.
 */
export async function alertState(env: AppEnv & { BUCKET: Bucket }, owner?: string) {
  const channels = alertChannels(env);
  const mine = <T extends { owner?: string }>(items: T[]) => items.filter((item) => item.owner === owner);
  const [rules, devices, recent] = await Promise.all([readRules(env.BUCKET), readDevices(env.BUCKET), readRecent(env.BUCKET)]).then(
    ([rules, devices, recent]) => [mine(rules), mine(devices), mine(recent)] as const,
  );
  return {
    rules,
    recent,
    devices: devices.map(({ label, createdAt }) => ({ label, createdAt })),
    channels: { email: Boolean(channels.email), push: channels.vapid ? { publicKey: channels.vapid.publicKey } : null },
  };
}
