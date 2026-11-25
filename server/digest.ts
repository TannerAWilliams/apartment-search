/**
 * The weekly digest: Monday at 9 AM in New York, each paid account with alerts gets one email: for each alert,
 * how many apartments match now and how many of them are new this week. Accounts with nothing new get nothing.
 */
import type { ListingData } from '../src/domain.ts';
import { alertChannels, alertMatches, matchesCriteria, readRules } from './alerts.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { paidEmails } from './plans.ts';

const EASTERN = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
/** Monday, 9 AM in New York. */
export function isDigestHour(now: Date) {
  const parts = Object.fromEntries(EASTERN.formatToParts(now).map(({ type, value }) => [type, value]));
  return parts.weekday === 'Mon' && Number(parts.hour) === 9;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Sends this week's digest. Returns how many accounts were emailed. */
export async function runDigest(
  env: AppEnv & { BUCKET: Bucket },
  { now = new Date(), loadMatches = alertMatches(env) }: { now?: Date; loadMatches?: ReturnType<typeof alertMatches> } = {},
) {
  const channels = alertChannels(env);
  if (!channels.email || !channels.from) return 0;
  const paid = await paidEmails(env, env.BUCKET, now);
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const byOwner = new Map<string, { name: string; matching: number; fresh: number }[]>();
  for (const rule of await readRules(env.BUCKET)) {
    if (!rule.owner || !paid.has(rule.owner)) continue;
    const matches: ListingData[] = matchesCriteria(await loadMatches(rule.filters), rule.criteria);
    const fresh = matches.filter(({ listedAt }) => Date.parse(listedAt ?? '') >= weekAgo).length;
    byOwner.set(rule.owner, [...(byOwner.get(rule.owner) ?? []), { name: rule.name, matching: matches.length, fresh }]);
  }
  const origin = env.APP_ORIGIN ?? '';
  let sent = 0;
  for (const [owner, rows] of byOwner) {
    const fresh = rows.reduce((sum, { fresh }) => sum + fresh, 0);
    if (!fresh) continue;
    const lines = rows.map(({ name, matching, fresh }) => `${name}: ${matching} match now, ${fresh} new this week`);
    try {
      await channels.email.send({
        from: channels.from,
        to: [owner],
        subject: `Your week on Walkup: ${fresh} new ${fresh === 1 ? 'apartment' : 'apartments'}`,
        text: `${lines.join('\n')}\n\nSee them: ${origin}/`,
        html: `<h2>Your week on Walkup</h2><ul>${lines.map((line) => `<li>${escape(line)}</li>`).join('')}</ul><p><a href="${escape(origin)}/">See them on Walkup</a></p>`,
      });
      sent++;
    } catch (cause) {
      log.error('digest_email_failed', cause);
    }
  }
  log.info('weekly_digest_sent', { accounts: sent });
  return sent;
}
