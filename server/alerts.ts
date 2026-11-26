import type { ListingData } from '../src/domain.ts';
import { paidEmails } from './plans.ts';
import {
  checkObservedChanges,
  MAX_BASELINE_UNITS,
  observedKey,
  parseChangeBaseline,
  type ObservedChange,
} from '../src/observed-changes.ts';
import { buildingGrade, marketBadge } from '../src/insights.ts';
import { displayPriceHistory } from '../src/price-history.ts';
import { localWorkplace, needsCommute, parseFilters, SearchInputError } from '../src/search.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { AlertDevicesSchema, AlertRulesSchema, checkedDocument, HeldAlertsSchema, RecentAlertsSchema } from './storage/stored-documents.ts';
import { offline, search } from './search.ts';
import { sendPush, validSubscription, type PushSubscriptionJson, type VapidKeys } from './web-push.ts';
import * as v from 'valibot';
import { mapLimit } from './concurrency.ts';

/** Saved searches checked at once (each is a search over the kept listings), and emails or notifications sent at once. */
const RULES_AT_ONCE = 4;
const SENDS_AT_ONCE = 4;

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
/**
 * The free plan: one alert, each sent three hours after its apartments were found, and at most three a day. The
 * paid plan sends every alert as soon as it is found.
 */
export const FREE_RULES = 1;
export const FREE_DELAY_HOURS = 3;
export const FREE_ALERTS_A_DAY = 3;
const HELD_KEY = 'alerts/held.json';
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
  /** Each line's apartment page, as a path; '' for a line that is not one apartment. */
  urls?: string[];
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
const NEIGHBORHOODS = 'Choose neighborhoods by name.';
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
            // Every neighborhood in the city can be chosen (there are about 215).
            v.maxLength(400, NEIGHBORHOODS),
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

/** What an alert says about an apartment besides its rent, and where its page is. */
type Described = Map<string, { facts: string[]; url: string }>;

/**
 * What is known about each matching apartment, by the key its changes carry: its size, its rent against similar
 * apartments, its building's rent stabilization and grade, and the nearest subway. An alert is read in an inbox,
 * so it says enough to decide whether to open the apartment.
 */
export function describeMatches(matches: ListingData[]): Described {
  const described: Described = new Map();
  for (const listing of matches) {
    const sourceId = displayPriceHistory(listing.priceHistory)?.sourceId;
    if (!sourceId) continue;
    const grade = buildingGrade(listing.building);
    const subway = listing.insights?.subway?.[0];
    described.set(observedKey(listing, sourceId), {
      facts: [
        listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} BR`,
        marketBadge(listing.insights) ?? '',
        listing.building?.stabilized ? 'rent-stabilized building' : '',
        grade ? `building grade ${grade}` : '',
        subway ? `${subway.routes.join('/')} ${subway.minutes} min walk` : '',
      ].filter(Boolean),
      url: '/listing/' + encodeURIComponent(listing.id),
    });
  }
  return described;
}

/** The alert for one rule, or null when nothing new matched and no price dropped. */
export function composeAlert(rule: AlertRule, changes: ObservedChange[], now: Date, described: Described = new Map()): Alert | null {
  const added = changes.filter(({ kind }) => kind === 'newly_encountered');
  const drops = changes.filter(({ kind, current, previous }) => kind === 'price' && previous && current.rent < previous.rent);
  if (!added.length && !drops.length) return null;
  const parts = [
    added.length && `${added.length} new ${added.length === 1 ? 'apartment' : 'apartments'}`,
    drops.length && `${drops.length} price ${drops.length === 1 ? 'drop' : 'drops'}`,
  ].filter(Boolean);
  // Each apartment's line, with what is known about it after its rent.
  const line = ({ current }: ObservedChange, rent: string) => {
    const known = described.get(current.key);
    return { text: [`${current.label}: ${rent}`, ...(known?.facts ?? [])].join(' · '), url: known?.url ?? '' };
  };
  const all = [
    ...drops.map((change) => line(change, `${money(change.previous!.rent)} → ${money(change.current.rent)}`)),
    ...added.map((change) => line(change, money(change.current.rent))),
  ];
  const hidden = all.length - SHOWN_UNITS;
  const shown = hidden > 0 ? [...all.slice(0, SHOWN_UNITS), { text: `and ${hidden} more`, url: '' }] : all;
  return {
    id: crypto.randomUUID(),
    at: now.toISOString(),
    ruleId: rule.id,
    title: `${rule.name}: ${parts.join(', ')}`,
    lines: shown.map(({ text }) => text),
    newCount: added.length,
    dropCount: drops.length,
    ...(rule.owner ? { owner: rule.owner } : {}),
    ...(shown.some(({ url }) => url) ? { urls: shown.map(({ url }) => url) } : {}),
  };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The calendar day in New York, which the free plan's daily limit counts by. */
const newYorkDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

/**
 * Holds free accounts' new alerts for three hours, and returns the ones to send now: those whose wait is over,
 * up to three a day for each account (the rest of that day's are dropped), and everything waiting for an account
 * that has since upgraded.
 */
async function releaseHeld(bucket: Bucket, fresh: Alert[], paid: Set<string>, now: Date) {
  const held = await read(bucket, HELD_KEY, HeldAlertsSchema, { waiting: [], sent: {} });
  if (!fresh.length && !held.waiting.length) return [];
  const day = newYorkDay(now);
  const dueAt = new Date(now.getTime() + FREE_DELAY_HOURS * 3_600_000).toISOString();
  const sent = Object.fromEntries(Object.entries(held.sent).filter(([, count]) => count.day === day));
  const release: Alert[] = [];
  const waiting: typeof held.waiting = [];
  for (const item of [...held.waiting, ...fresh.map((alert) => ({ ...alert, dueAt }))]) {
    const { dueAt: due, ...alert } = item;
    const owner = alert.owner ?? '';
    if (paid.has(owner)) release.push(alert);
    else if (due > now.toISOString()) waiting.push(item);
    else if ((sent[owner]?.count ?? 0) < FREE_ALERTS_A_DAY) {
      sent[owner] = { day, count: (sent[owner]?.count ?? 0) + 1 };
      release.push(alert);
    }
  }
  await write(bucket, HELD_KEY, { waiting, sent });
  return release;
}

/**
 * Sends the alerts by email (one message per account, to that account's address only) and to each device of the
 * account the alert belongs to (one notification per alert). Alerts made before accounts had their own go to every
 * allowed address and to devices added the same way.
 */
export async function deliver(
  bucket: Bucket,
  alerts: Alert[],
  channels: AlertChannels,
  origin: string,
  /** Accounts on the free plan, whose email says how the paid plan differs. */
  free: Set<string> = new Set(),
) {
  const delivered = { email: false, devices: 0 };
  if (!alerts.length) return delivered;
  const owners = [...new Set(alerts.map(({ owner }) => owner))];
  // Emails (one per account) and notifications go out together.
  const [emailed, devices] = await Promise.all([
    mapLimit(owners, SENDS_AT_ONCE, (owner) =>
      sendEmail(
        alerts.filter((alert) => alert.owner === owner),
        channels,
        owner ? [owner] : (channels.to ?? []),
        origin,
        Boolean(owner && free.has(owner)),
      ),
    ),
    channels.vapid ? sendPushes(bucket, alerts, channels.vapid, channels.pushFetcher) : 0,
  ]);
  delivered.email = emailed.some(Boolean);
  delivered.devices = devices;
  return delivered;
}

async function sendEmail(alerts: Alert[], channels: AlertChannels, to: string[], origin: string, free = false) {
  if (!channels.email || !channels.from || !to.length) return false;
  const subject = alerts.length === 1 ? alerts[0].title : `${alerts.length} apartment alerts`;
  // What a free account's email was held for, and what the paid plan changes.
  const plan = `Free alerts are sent ${FREE_DELAY_HOURS} hours after a match is found, up to ${FREE_ALERTS_A_DAY} a day. The paid plan sends every match as soon as it is found`;
  // Each apartment's line opens its own page, where the alert knows it.
  const page = (alert: Alert, index: number) => (alert.urls?.[index] ? origin + alert.urls[index] : '');
  const text =
    alerts
      .map((alert) =>
        [alert.title, ...alert.lines.map((line, index) => '• ' + line + (page(alert, index) ? '\n  ' + page(alert, index) : ''))].join(
          '\n',
        ),
      )
      .join('\n\n') +
    `\n\nOpen Walkup: ${origin}/` +
    (free ? `\n\n${plan}: ${origin}/pricing` : '');
  const html =
    alerts
      .map(
        (alert) =>
          `<h3>${escapeHtml(alert.title)}</h3><ul>${alert.lines
            .map((line, index) =>
              page(alert, index)
                ? `<li><a href="${escapeHtml(page(alert, index))}">${escapeHtml(line)}</a></li>`
                : `<li>${escapeHtml(line)}</li>`,
            )
            .join('')}</ul>`,
      )
      .join('') +
    `<p><a href="${escapeHtml(origin)}/">Open Walkup</a></p>` +
    (free ? `<p>${plan}. <a href="${escapeHtml(origin)}/pricing">See pricing</a></p>` : '');
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
  // Devices are sent to together, a few at a time; one device's alerts go in order, and stop if it is gone.
  await mapLimit(devices, SENDS_AT_ONCE, async (device) => {
    for (const alert of alerts.filter(({ owner }) => owner === device.owner)) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: one device's alerts go in order and stop when it is gone; devices run together
        const result = await sendPush(device, { title: alert.title, body: alert.lines.join('\n'), tag: alert.ruleId, url: '/' }, vapid, {
          fetcher,
        });
        if (result.gone) {
          gone.add(device.endpoint);
          return;
        }
        if (result.ok) sent++;
        else log.warn('alert_push_failed', { status: result.status, device: device.label });
      } catch (cause) {
        log.error('alert_push_failed', cause, { device: device.label });
      }
    }
  });
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
  {
    origin,
    now = new Date(),
    paid,
  }: {
    origin: string;
    now?: Date;
    /**
     * Accounts on the paid plan, whose alerts are sent at once; another account's wait (the free plan). Alerts
     * made before accounts, and every alert where no plans are given, are sent at once.
     */
    paid?: Set<string>;
  },
) {
  const rules = await readRules(bucket);
  // Each rule has its own baseline, so rules are checked together, a few at a time; alerts keep the rules' order.
  const checked = await mapLimit(rules, RULES_AT_ONCE, async (rule): Promise<Alert | null> => {
    try {
      // The match search and the stored baseline do not depend on each other.
      const key = BASELINE_PREFIX + rule.id + '.json';
      const [found, baseline] = await Promise.all([loadMatches(rule.filters), readBaseline(bucket, key)]);
      const matches = matchesCriteria(found, rule.criteria);
      if (matches.length > MAX_BASELINE_UNITS) {
        log.warn('alert_rule_too_broad', { rule: rule.id, matches: matches.length });
        return null;
      }
      // An unrecognized baseline is dropped, so the rule records a new one instead of sending a flood.
      const result = checkObservedChanges(matches, baseline);
      await write(bucket, key, result.baseline);
      return baseline ? composeAlert(rule, result.changes, now, describeMatches(matches)) : null;
    } catch (cause) {
      log.error('alert_check_failed', cause, { rule: rule.id });
      return null;
    }
  });
  const found = checked.filter((alert): alert is Alert => alert !== null);
  const onFreePlan = ({ owner }: Alert) => Boolean(paid && owner && !paid.has(owner));
  // A free account's alerts wait; what goes now is everyone else's, and the held ones whose wait is over.
  const released = paid ? await releaseHeld(bucket, found.filter(onFreePlan), paid, now) : [];
  const alerts = [...found.filter((alert) => !onFreePlan(alert)), ...released];
  if (!alerts.length) return { alerts, delivered: { email: false, devices: 0 } };
  await write(bucket, RECENT_KEY, [...alerts, ...(await readRecent(bucket))].slice(0, MAX_RECENT));
  const free = new Set(released.filter(onFreePlan).map(({ owner }) => owner ?? ''));
  const delivered = await deliver(bucket, alerts, channels, origin, free);
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
  const paid = env.PUBLIC_APP === 'true' ? undefined : await paidEmails(env, env.BUCKET);
  return checkAlerts(env.BUCKET, alertMatches(env), alertChannels(env), { origin, paid });
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

/** Removes everything alerts keep for one account: its rules, devices and recent alerts. */
export async function forgetAlerts(bucket: Bucket, owner: string) {
  const [rules, devices, recent] = await Promise.all([readRules(bucket), readDevices(bucket), readRecent(bucket)]);
  await write(
    bucket,
    RULES_KEY,
    rules.filter((rule) => rule.owner !== owner),
  );
  await write(
    bucket,
    DEVICES_KEY,
    devices.filter((device) => device.owner !== owner),
  );
  await write(
    bucket,
    RECENT_KEY,
    recent.filter((alert) => alert.owner !== owner),
  );
  const held = await read(bucket, HELD_KEY, HeldAlertsSchema, { waiting: [], sent: {} });
  const { [owner]: _sent, ...sent } = held.sent;
  await write(bucket, HELD_KEY, { waiting: held.waiting.filter((alert) => alert.owner !== owner), sent });
}
