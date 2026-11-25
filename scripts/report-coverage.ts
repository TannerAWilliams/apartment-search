// Reports unit-test coverage of the application modules (server/ and the non-UI parts of src/).
// UI components are covered by the Playwright suite; they are listed rather than silently left out.
import { applicationModules } from './coverage-scope.ts';

// Every line is tested. Bun does not name uncalled functions or measure branches, so functions keep a floor instead.
const MIN_LINES = 1;
const MIN_FUNCTIONS = 0.9;
const root = new URL('../', import.meta.url);
const { measured, ui } = await applicationModules(root);
const records = new Map<string, Record<string, number>>();
for (const record of (await Bun.file(new URL('coverage/lcov.info', root)).text()).split('end_of_record')) {
  const lines = record.trim().split('\n');
  const source = lines.find((line) => line.startsWith('SF:'))?.slice(3);
  if (!source) continue;
  const value = (key: string) => Number(lines.find((line) => line.startsWith(key + ':'))?.split(':')[1] || 0);
  records.set(source, { LF: value('LF'), LH: value('LH'), FNF: value('FNF'), FNH: value('FNH') });
}

const missing = measured.filter((path) => !records.has(path));
if (missing.length) throw new Error('Application modules with no coverage data (load them in a test): ' + missing.join(', '));
const totals = { LF: 0, LH: 0, FNF: 0, FNH: 0 };
const partial: string[] = [];
for (const path of measured) {
  const record = records.get(path)!;
  for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += record[key];
  if (record.LH < record.LF) partial.push(`${path} ${record.LH}/${record.LF}`);
}
const lines = totals.LH / totals.LF;
const functions = totals.FNH / totals.FNF;
console.log(
  `Application modules (${measured.length}): lines ${totals.LH}/${totals.LF} (${(lines * 100).toFixed(2)}%); functions ${totals.FNH}/${totals.FNF} (${(functions * 100).toFixed(2)}%).`,
);
if (partial.length) console.log('Not fully covered: ' + partial.join('; '));
console.log(`UI modules covered by the Playwright suite instead (${ui.length}): ${ui.join(', ')}.`);
const scripts = [...records.entries()].filter(([path]) => path.startsWith('scripts/'));
console.log(
  'Build and ops scripts, reported separately: ' + scripts.map(([path, record]) => `${path} ${record.LH}/${record.LF}`).join(', ') + '.',
);
if (lines < MIN_LINES || functions < MIN_FUNCTIONS) {
  throw new Error(`Application coverage is below ${MIN_LINES * 100}% of lines or ${MIN_FUNCTIONS * 100}% of functions.`);
}
