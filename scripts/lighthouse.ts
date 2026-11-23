// Lab performance audit with Google Lighthouse (pinned) against the running app:
//   bun run dev          # in one terminal
//   bun run perf [url]   # defaults to http://127.0.0.1:8787/
// Lighthouse emulates a mid-range phone on a slow 4G connection. Real visits are measured separately
// (src/web-vitals-report.ts → Workers Logs, event "web_vital"). Fails below the budgets below.
import { $ } from 'bun';

const LIGHTHOUSE = 'lighthouse@12.8.2';
const BUDGETS = { performance: 85, accessibility: 100, 'best-practices': 90 };
const METRICS = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index', 'total-byte-weight'];

type Audit = { score: number | null; scoreDisplayMode?: string; title: string; displayValue?: string };
type Report = { categories: Record<string, { score: number | null }>; audits: Record<string, Audit> };

/** Scores out of 100, key metrics, failing audits, and the categories below budget. */
export function summarize(report: Report) {
  const scores = Object.fromEntries(Object.entries(report.categories).map(([id, { score }]) => [id, Math.round((score ?? 0) * 100)]));
  const metrics = METRICS.filter((id) => report.audits[id]).map((id) => `${report.audits[id].title}: ${report.audits[id].displayValue ?? ''}`);
  const failing = Object.values(report.audits).filter(({ score, scoreDisplayMode }) => score !== null && score < 0.9 &&
    ['numeric', 'binary', 'metricSavings'].includes(scoreDisplayMode ?? '')).map(({ title, displayValue }) => title + (displayValue ? ` (${displayValue})` : ''));
  const overBudget = Object.entries(BUDGETS).filter(([id, minimum]) => id in scores && scores[id] < minimum).map(([id, minimum]) => `${id} ${scores[id]} < ${minimum}`);
  return { scores, metrics, failing, overBudget };
}

if (import.meta.main) {
  const url = Bun.argv[2] ?? 'http://127.0.0.1:8787/';
  const chrome = Bun.env.CHROME_PATH ?? Bun.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (await import('playwright')).chromium.executablePath();
  const output = `${Bun.env.TMPDIR ?? '/tmp'}/lighthouse-${crypto.randomUUID()}.json`;
  // Chromium's sandbox cannot start as root (for example in a container).
  const root = (await $`id -u`.text()).trim() === '0';
  const flags = ['--headless=new', ...(root ? ['--no-sandbox'] : [])].join(' ');
  const run = Bun.spawnSync(['bunx', '--bun', LIGHTHOUSE, url, '--quiet', `--chrome-flags=${flags}`,
    '--only-categories=performance,accessibility,best-practices', '--output=json', `--output-path=${output}`],
  { stdio: ['inherit', 'inherit', 'inherit'], env: { ...Bun.env, CHROME_PATH: chrome } });
  if (run.exitCode !== 0) throw new Error('Lighthouse did not finish. Is the app running at ' + url + '?');
  const report = Bun.file(output);
  const { scores, metrics, failing, overBudget } = summarize(await report.json() as Report);
  await report.delete();
  console.log('Scores: ' + Object.entries(scores).map(([id, score]) => `${id} ${score}`).join(', '));
  for (const line of metrics) console.log('  ' + line);
  if (failing.length) console.log('To improve:\n' + failing.map((line) => '  - ' + line).join('\n'));
  if (overBudget.length) { console.error('Below budget: ' + overBudget.join(', ')); process.exit(1); }
}
