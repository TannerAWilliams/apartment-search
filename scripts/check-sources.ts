#!/usr/bin/env bun
/**
 * Runs every source's reader against the live site once and reports what each one found, so a site that
 * changes its pages is noticed before its listings go missing. CI runs it weekly (.github/workflows/sources.yml).
 *   bun scripts/check-sources.ts [source-id ...]
 * Each source is one of:
 *   working  it read listings (the count is shown)
 *   blocked  the site refused automated requests (HTTP 403 or 429, or a bot challenge): reported, not a failure
 *   broken   anything else, such as a page the reader no longer recognizes: the run fails
 * The complete syncs that take many minutes (CityRealty, Openigloo, Zumper) are left out; they run in the Workflow.
 */
import { DIRECT_RENTAL_SOURCES } from '../server/sources/direct-rentals.ts';
import { loadHdcRerentals } from '../server/sources/hdc-rerentals.ts';
import { loadHousingConnect } from '../server/sources/housing.ts';
import { loadJerseyAffordable } from '../server/sources/jersey-affordable.ts';
import { completeSync } from '../server/sources/source-registry.ts';
import { loadHomeSeeker } from '../server/sources/westchester-homeseeker.ts';
import type { FetchTransport } from '../src/fetch-type.ts';

type Check = { id: string; run: (fetcher: FetchTransport, now: Date) => Promise<number> };
export type Outcome = { id: string; state: 'working' | 'blocked' | 'broken'; detail: string; seconds: number };

export const CHECKS: Check[] = [
  ...DIRECT_RENTAL_SOURCES.filter(({ id }) => !completeSync(id)).map((source) => ({
    id: source.id,
    run: async (fetcher: FetchTransport, now: Date) => (await source.load(fetcher, now)).listings.length,
  })),
  { id: 'housingconnect', run: async (fetcher, now) => (await loadHousingConnect(fetcher, now)).opportunities.length },
  { id: 'hdc-rerentals', run: async (fetcher) => (await loadHdcRerentals(fetcher)).results.length },
  { id: 'jersey-affordable', run: async (fetcher, now) => (await loadJerseyAffordable(fetcher, now)).notices.length },
  { id: 'westchester-homeseeker', run: async (fetcher, now) => (await loadHomeSeeker(fetcher, now)).opportunities.length },
];

/** Whether a failure is the site refusing us, which is reported but is not something the code can fix. */
export function isBlocked(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = 'httpStatus' in error ? Number(error.httpStatus) : Number(error.message.match(/HTTP (\d{3})/)?.[1]);
  return status === 403 || status === 429 || ('code' in error && error.code === 'bot_challenge');
}

export async function checkSources(checks: Check[], fetcher: FetchTransport, now = new Date()): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  // One source at a time, so no site sees more than one reader at once.
  for (const { id, run } of checks) {
    const started = Date.now();
    try {
      const count = await run(fetcher, now);
      outcomes.push({ id, state: count > 0 ? 'working' : 'broken', detail: count > 0 ? `${count} listings` : 'no listings', seconds: 0 });
    } catch (error) {
      outcomes.push({
        id,
        state: isBlocked(error) ? 'blocked' : 'broken',
        detail: error instanceof Error ? error.message : String(error),
        seconds: 0,
      });
    }
    outcomes[outcomes.length - 1]!.seconds = Math.round((Date.now() - started) / 1000);
  }
  return outcomes;
}

/** A Markdown table of the outcomes, for the job summary. */
export const summary = (outcomes: Outcome[]) =>
  [
    '| Source | State | Detail | Seconds |',
    '| --- | --- | --- | --- |',
    ...outcomes.map((o) => `| ${o.id} | ${o.state} | ${o.detail.replaceAll('|', '/')} | ${o.seconds} |`),
  ].join('\n');

if (import.meta.main) {
  const wanted = Bun.argv.slice(2);
  const outcomes = await checkSources(wanted.length ? CHECKS.filter(({ id }) => wanted.includes(id)) : CHECKS, (url, init) =>
    fetch(url, init),
  );
  const table = summary(outcomes);
  console.log(table);
  if (Bun.env.GITHUB_STEP_SUMMARY) await Bun.write(Bun.env.GITHUB_STEP_SUMMARY, '## Live source check\n\n' + table + '\n');
  const broken = outcomes.filter(({ state }) => state === 'broken');
  if (broken.length) {
    console.error(`\n${broken.length} source(s) broken: ${broken.map(({ id }) => id).join(', ')}`);
    process.exit(1);
  }
}
