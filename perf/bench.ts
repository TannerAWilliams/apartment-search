/**
 * Speed checks for the server's main paths, against a production-sized inventory (perf/fixtures.ts):
 *
 *   bun run perf           # measure, and fail when anything is over its budget (CI runs this)
 *   bun run perf:update    # after a deliberate change, record the new numbers as the budgets
 *
 * Four kinds of budget, in perf/budgets.json:
 * - time: each scenario's fastest run, divided by a fixed calibration workload timed in the same process, so the
 *   number means the same on a laptop and on a CI machine. Over budget by more than the tolerance, in three
 *   passes running, fails. Timings wander, so this catches a path that got about half again slower or worse; the
 *   three budgets below are exact and catch the rest.
 * - scaling: the scenario at four times the listings may take at most this many times as long. This needs no
 *   baseline at all and catches an accidental quadratic loop however fast the machine is.
 * - sizes: what a response weighs, in bytes.
 * - memory: what a cold search keeps on the heap, because a Worker has 128 MB.
 */
import { heapStats } from 'bun:jsc';
import { handleApi } from '../test/fixtures/api.ts';
import { log } from '../server/log.ts';
import { offline, search } from '../server/search.ts';
import { withInsights } from '../src/insights.ts';
import { mergeListings } from '../src/listings.ts';
import { rentAreas } from '../src/market.ts';
import { matchListings, parseFilters } from '../src/search.ts';
import { coldBucket, makeListings, makeStations, PRODUCTION_SIZE, seeded, seededDatabase } from './fixtures.ts';

type Budgets = {
  tolerance: number;
  scenarios: Record<string, { ratio: number; ms: number }>;
  scaling: Record<string, number>;
  sizes: Record<string, number>;
  memory: Record<string, number>;
};
const BUDGETS = new URL('budgets.json', import.meta.url);
const SMALL = PRODUCTION_SIZE / 4;
const SAMPLES = 9;
const PASSES = 3;
/** The most a scenario may slow down for four times the listings: room for noise above 4, far below a quadratic 16. */
const SCALING_LIMIT = 8;
const ALL = { region: 'all', bedrooms: null, maxRent: null, liveOnly: true, includeCached: true } as const;

const elapsed = async (work: () => unknown) => {
  const from = Bun.nanoseconds();
  await work();
  return (Bun.nanoseconds() - from) / 1e6;
};
/** The fastest of several runs, after warming up: the steadiest measure of what the code costs. */
async function fastest(work: () => unknown, samples = SAMPLES, warmups = 2) {
  for (let run = 0; run < warmups; run++) await work();
  let best = Infinity;
  for (let run = 0; run < samples; run++) best = Math.min(best, await elapsed(work));
  return best;
}

/** A fixed amount of ordinary work (sorting, maps, JSON), which every scenario's time is divided by. */
function calibration() {
  const random = seeded(7);
  const rows = Array.from({ length: 40_000 }, (_, index) => ({
    id: 'row-' + index,
    value: random(),
    tags: ['a', 'b', String(index % 97)],
  }));
  const groups = new Map<string, number>();
  for (const row of rows) groups.set(row.tags[2]!, (groups.get(row.tags[2]!) ?? 0) + row.value);
  const sorted = rows.toSorted((a, b) => a.value - b.value);
  return (JSON.parse(JSON.stringify(sorted)) as typeof rows).length + groups.size;
}

async function measure() {
  log.sink = () => {};
  const now = new Date();
  const [database, smallDatabase] = await Promise.all([seededDatabase(PRODUCTION_SIZE, now), seededDatabase(SMALL, now)]);
  const warm = coldBucket(database);
  const env = { BUCKET: warm };
  const filters = (extra: Record<string, unknown> = {}) => parseFilters({ ...ALL, ...extra });
  const post = (path: string, body: unknown) =>
    handleApi(
      new Request('https://perf.test/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    );
  const get = (path: string) => handleApi(new Request('https://perf.test/api/' + path), env);
  const listings = (count: number) => [...makeListings(count, 1, now).values()].flat();
  const [full, quarter] = [listings(PRODUCTION_SIZE), listings(SMALL)];
  const stations = makeStations();
  const scored = withInsights(mergeListings(full), {}, { stations });
  await search(filters(), env, offline);

  /** Each scenario, with the same work at a quarter of the listings where its scaling is checked. */
  const scenarios: Record<string, { run: () => unknown; small?: () => unknown }> = {
    // A Worker instance's first search: every listing read from the database, merged and scored.
    'search-cold': {
      run: () => search(filters(), { BUCKET: coldBucket(database) }, offline),
      small: () => search(filters(), { BUCKET: coldBucket(smallDatabase) }, offline),
    },
    // Later searches on the same instance re-filter the kept listings.
    'search-warm-all': { run: () => search(filters(), env, offline) },
    'search-warm-borough': { run: () => search(filters({ region: 'brooklyn' }), env, offline) },
    'search-warm-deals': { run: () => search(filters({ belowMarket: true, sort: 'value' }), env, offline) },
    'search-warm-commute-limit': { run: () => search(filters({ maxCommuteMinutes: 30 }), env, offline) },
    'search-warm-map': { run: () => search(filters({ includeMap: true }), env, offline) },
    // The whole request: validation, the route, the search and writing the JSON.
    'api-search': { run: async () => (await post('search', ALL)).text() },
    'api-config': { run: async () => (await get('config')).text() },
    'api-listing': { run: async () => (await get('listing?id=' + encodeURIComponent(full[1234]!.id))).text() },
    'api-market': { run: async () => (await get('market?region=nyc&grouping=neighborhood')).text() },
    // The pure steps, so a slowdown names its own function.
    'merge-listings': { run: () => mergeListings(full), small: () => mergeListings(quarter) },
    'score-listings': { run: () => withInsights(full, {}, { stations }), small: () => withInsights(quarter, {}, { stations }) },
    'match-listings': { run: () => matchListings(scored, filters({ region: 'nyc', bedroomOptions: [1, 2], maxRent: 4500 }), null) },
    'rent-areas': {
      run: () => rentAreas(full, { region: 'nyc', grouping: 'neighborhood' }),
      small: () => rentAreas(quarter, { region: 'nyc', grouping: 'neighborhood' }),
    },
  };

  const base = await fastest(calibration, 15, 5);
  const times: Budgets['scenarios'] = {};
  const scaling: Budgets['scaling'] = {};
  for (const [name, { run, small }] of Object.entries(scenarios)) {
    const ms = await fastest(run);
    times[name] = { ratio: Number((ms / base).toFixed(3)), ms: Number(ms.toFixed(2)) };
    if (small) scaling[name] = Number((ms / (await fastest(small))).toFixed(2));
  }

  const bytes = async (response: Response | Promise<Response>) => (await (await response).arrayBuffer()).byteLength;
  const sizes: Budgets['sizes'] = {
    'search-response-bytes': await bytes(post('search', ALL)),
    'search-map-bytes-per-listing': Math.round((await bytes(post('search', { ...ALL, includeMap: true }))) / PRODUCTION_SIZE),
    'config-response-bytes': await bytes(get('config')),
  };

  Bun.gc(true);
  const before = heapStats().heapSize;
  const bucket = coldBucket(database);
  await search(filters(), { BUCKET: bucket }, offline);
  Bun.gc(true);
  const memory: Budgets['memory'] = { 'search-cold-heap-mb': Math.round((heapStats().heapSize - before) / 1024 / 1024) };
  // Kept until here, so the listings the search holds for this bucket were counted.
  void bucket;
  return { calibrationMs: Number(base.toFixed(2)), scenarios: times, scaling, sizes, memory };
}

/** Everything over its budget, as lines to print; empty when all is well. */
export function overBudget(measured: Omit<Budgets, 'tolerance'>, budgets: Budgets) {
  const failures: string[] = [];
  const percent = (value: number, budget: number) => `${value > budget ? '+' : ''}${Math.round((value / budget - 1) * 100)}%`;
  for (const [name, { ratio }] of Object.entries(measured.scenarios)) {
    const budget = budgets.scenarios[name];
    if (!budget) failures.push(`${name}: no time budget recorded; run "bun run perf:update" and commit perf/budgets.json`);
    else if (ratio > budget.ratio * (1 + budgets.tolerance))
      failures.push(`${name}: ${percent(ratio, budget.ratio)} slower than its budget (allowed +${budgets.tolerance * 100}%)`);
  }
  for (const [name, factor] of Object.entries(measured.scaling)) {
    const limit = budgets.scaling[name];
    if (limit !== undefined && factor > limit)
      failures.push(`${name}: took ${factor}× as long for 4× the listings (limit ${limit}×): it no longer scales in step with the data`);
  }
  for (const kind of ['sizes', 'memory'] as const)
    for (const [name, value] of Object.entries(measured[kind])) {
      const limit = budgets[kind][name];
      if (limit !== undefined && value > limit) failures.push(`${name}: ${value} is over its limit of ${limit} (${percent(value, limit)})`);
    }
  return failures;
}

type Measured = Awaited<ReturnType<typeof measure>>;
/** Two passes as one: each scenario's time from the pass `prefer` chooses; the rest from the later pass. */
function combine(first: Measured, second: Measured, prefer: (a: number, b: number) => number): Measured {
  const pick = <T extends { ratio: number }>(a: T, b: T) => (prefer(a.ratio, b.ratio) === a.ratio ? a : b);
  return {
    ...second,
    scenarios: Object.fromEntries(
      Object.entries(second.scenarios).map(([name, time]) => [name, pick(first.scenarios[name] ?? time, time)]),
    ),
    scaling: Object.fromEntries(
      Object.entries(second.scaling).map(([name, factor]) => [name, prefer(first.scaling[name] ?? factor, factor)]),
    ),
  };
}

if (import.meta.main) {
  const update = Bun.argv.includes('--update');
  const known: Budgets | null = (await Bun.file(BUDGETS).exists()) ? await Bun.file(BUDGETS).json() : null;
  // Timings on a shared machine wander by a third from one pass to the next. So a budget is the slowest of
  // three passes, and a check fails only when a scenario is over its budget in every one of up to three passes.
  let measured = await measure();
  if (update || !known) for (let pass = 1; pass < PASSES; pass++) measured = combine(measured, await measure(), Math.max);
  else
    for (let pass = 1; pass < PASSES && overBudget(measured, known).length; pass++) {
      console.log(`Over budget on pass ${pass}; measuring again to rule out a noisy run.`);
      measured = combine(measured, await measure(), Math.min);
    }
  if (update || !known) {
    const headroom = (values: Record<string, number>, factor: number, floor = 0) =>
      Object.fromEntries(Object.entries(values).map(([name, value]) => [name, Math.max(floor, Math.ceil(value * factor))]));
    const budgets: Budgets = {
      // Other tools' limits in the same file (perf/bundle.ts) are kept.
      ...known,
      tolerance: known?.tolerance ?? 0.5,
      scenarios: measured.scenarios,
      // Four times the data should take about four times as long; a quadratic loop takes sixteen.
      scaling: Object.fromEntries(Object.keys(measured.scaling).map((name) => [name, SCALING_LIMIT])),
      sizes: headroom(measured.sizes, 1.15),
      memory: headroom(measured.memory, 1.25, 16),
    };
    await Bun.write(BUDGETS, JSON.stringify(budgets, null, 2) + '\n');
    console.log('Recorded new budgets in perf/budgets.json.');
  }
  const budgets: Budgets = await Bun.file(BUDGETS).json();
  const rows = Object.entries(measured.scenarios).map(([name, { ms, ratio }]) => {
    const budget = budgets.scenarios[name]?.ratio;
    const change = budget ? Math.round((ratio / budget - 1) * 100) : 0;
    return {
      name,
      ms: ms.toFixed(1),
      change: `${change > 0 ? '+' : ''}${change}%`,
      scaling: measured.scaling[name] ? `${measured.scaling[name]}×` : '',
    };
  });
  const table = [
    '| Scenario | Time | vs budget | 4× data takes |',
    '|---|---:|---:|---:|',
    ...rows.map(({ name, ms, change, scaling }) => `| ${name} | ${ms} ms | ${change} | ${scaling} |`),
    '',
    ...Object.entries({ ...measured.sizes, ...measured.memory }).map(
      ([name, value]) =>
        `- ${name}: ${value.toLocaleString('en-US')} (limit ${({ ...budgets.sizes, ...budgets.memory }[name] ?? 0).toLocaleString('en-US')})`,
    ),
  ].join('\n');
  console.log(`${PRODUCTION_SIZE.toLocaleString('en-US')} listings; calibration ${measured.calibrationMs} ms\n\n${table}\n`);
  const failures = overBudget(measured, budgets);
  // On GitHub, the table shows on the run's summary page.
  if (process.env.GITHUB_STEP_SUMMARY)
    await Bun.write(
      process.env.GITHUB_STEP_SUMMARY,
      `## Server speed\n\n${table}\n\n${failures.length ? failures.map((line) => `- ❌ ${line}`).join('\n') : 'All within budget.'}\n`,
    );
  if (failures.length) {
    console.error('Over budget:\n' + failures.map((line) => '  ✗ ' + line).join('\n'));
    console.error('\nIf the slowdown is intended, run "bun run perf:update" and commit perf/budgets.json with the reason.');
    process.exit(1);
  }
  console.log('All within budget.');
}
