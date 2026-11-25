/**
 * Times the live site as a first-time visitor on a phone sees it, and fails when it is over the limits below:
 *
 *   bun run perf:live [origin]     # defaults to https://apartments.5thof6.com
 *
 * Run after each deploy (.github/workflows/deploy.yml), so a slowdown that only shows in production (the
 * database, the network, a cold server) turns the run red. Each measure is the middle of several visits in a
 * new browser profile, like a private window. The limits leave room for a slow network; the tests in CI
 * (perf/ and e2e/perf.spec.ts) are the tight ones.
 */
import { chromium, devices, type Browser } from 'playwright';

const LIMITS_MS = {
  'home page ready': 3000,
  'results after tapping Search': 3000,
  'results opening /search': 4000,
  'Rents after tapping it': 800,
};
const VISITS = 3;
type Measure = keyof typeof LIMITS_MS;

const middle = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function visit(browser: Browser, origin: string): Promise<Record<Measure, number>> {
  const fresh = async () => (await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' })).newPage();
  const home = await fresh();
  let from = Date.now();
  await home.goto(origin + '/');
  await home.getByRole('button', { name: 'Search apartments', exact: true }).waitFor();
  const homeReady = Date.now() - from;
  // As long as it takes to read the page and choose.
  await home.waitForTimeout(3000);
  from = Date.now();
  await home.getByRole('tab', { name: 'Rents', exact: true }).click();
  await home.getByRole('heading', { name: 'Median rent', exact: true }).waitFor();
  const rents = Date.now() - from;
  await home.goto(origin + '/');
  await home.getByRole('textbox', { name: 'Max rent', exact: true }).fill(String(3000 + Math.floor(Math.random() * 2000)));
  from = Date.now();
  await home.getByRole('button', { name: 'Search apartments', exact: true }).click();
  await home
    .getByText(/matching apartment/)
    .first()
    .waitFor();
  const afterTap = Date.now() - from;
  await home.context().close();

  const results = await fresh();
  from = Date.now();
  await results.goto(origin + '/search');
  await results
    .getByText(/matching apartment/)
    .first()
    .waitFor();
  const direct = Date.now() - from;
  await results.context().close();
  return {
    'home page ready': homeReady,
    'results after tapping Search': afterTap,
    'results opening /search': direct,
    'Rents after tapping it': rents,
  };
}

if (import.meta.main) {
  const origin = (Bun.argv[2] ?? 'https://apartments.5thof6.com').replace(/\/$/, '');
  const browser = await chromium.launch();
  const visits: Record<Measure, number>[] = [];
  // One visit after another, as visitors arrive; together they would slow each other.
  for (let index = 0; index < VISITS; index++) visits.push(await visit(browser, origin));
  await browser.close();
  // Where an uncached search's time went on the server, from its Server-Timing header.
  const search = await fetch(origin + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      region: 'all',
      bedrooms: null,
      maxRent: 3000 + Math.floor(Math.random() * 3000),
      liveOnly: true,
      includeCached: true,
    }),
  });
  await search.arrayBuffer();
  const rows = (Object.keys(LIMITS_MS) as Measure[]).map((name) => {
    const all = visits.map((visit) => visit[name]);
    return { name, ms: middle(all), all, limit: LIMITS_MS[name] };
  });
  const table = [
    '| Measure | Middle of ' + VISITS + ' | Each visit | Limit |',
    '|---|---:|---|---:|',
    ...rows.map(({ name, ms, all, limit }) => `| ${name} | ${ms} ms | ${all.join(', ')} | ${limit} ms |`),
    '',
    'Uncached search, server phases: ' + (search.headers.get('Server-Timing') ?? 'not reported'),
  ].join('\n');
  console.log(`${origin}\n\n${table}\n`);
  const failures = rows
    .filter(({ ms, limit }) => ms > limit)
    .map(({ name, ms, limit }) => `${name}: ${ms} ms is over its limit of ${limit} ms`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await Bun.write(
      process.env.GITHUB_STEP_SUMMARY,
      `## Live site speed\n\n${table}\n\n${failures.length ? failures.map((line) => `- ❌ ${line}`).join('\n') : 'All within limits.'}\n`,
    );
  if (failures.length) {
    console.error('Over limit:\n' + failures.map((line) => '  ✗ ' + line).join('\n'));
    process.exit(1);
  }
  console.log('All within limits.');
}
