/**
 * The weekly digest: Monday at 9 AM in New York, each paid account with alerts gets one email: for each alert,
 * how many apartments match now and how many of them are new this week. Accounts with nothing new get nothing.
 */
import type { ListingData } from '../src/domain.ts';
import { alertChannels, alertMatches, matchesCriteria, readRules } from './alerts.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { paidEmails } from './plans.ts';
import { mapLimit } from './concurrency.ts';

/** Saved searches counted, and emails sent, at once. */
const AT_ONCE = 4;

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
  const rules = (await readRules(env.BUCKET)).flatMap((rule) =>
    rule.owner && paid.has(rule.owner) ? [{ ...rule, owner: rule.owner }] : [],
  );
  // Each saved search is counted together with the others, a few at a time; rows keep the rules' order.
  const counted = await mapLimit(rules, AT_ONCE, async (rule) => {
    const matches: ListingData[] = matchesCriteria(await loadMatches(rule.filters), rule.criteria);
    return { rule, matching: matches.length, fresh: matches.filter(({ listedAt }) => Date.parse(listedAt ?? '') >= weekAgo).length };
  });
  for (const { rule, matching, fresh } of counted)
    byOwner.set(rule.owner, [...(byOwner.get(rule.owner) ?? []), { name: rule.name, matching, fresh }]);
  const origin = env.APP_ORIGIN ?? '';
  const { email, from } = channels;
  // One email per account, sent together, a few at a time.
  const results = await mapLimit([...byOwner], AT_ONCE, async ([owner, rows]) => {
    const fresh = rows.reduce((sum, { fresh }) => sum + fresh, 0);
    if (!fresh) return false;
    const lines = rows.map(({ name, matching, fresh }) => `${name}: ${matching} match now, ${fresh} new this week`);
    try {
      await email.send({
        from,
        to: [owner],
        subject: `Your week on Walkup: ${fresh} new ${fresh === 1 ? 'apartment' : 'apartments'}`,
        text: `${lines.join('\n')}\n\nSee them: ${origin}/`,
        html: `<h2>Your week on Walkup</h2><ul>${lines.map((line) => `<li>${escape(line)}</li>`).join('')}</ul><p><a href="${escape(origin)}/">See them on Walkup</a></p>`,
      });
      return true;
    } catch (cause) {
      log.error('digest_email_failed', cause);
      return false;
    }
  });
  const sent = results.filter(Boolean).length;
  log.info('weekly_digest_sent', { accounts: sent });
  return sent;
}
