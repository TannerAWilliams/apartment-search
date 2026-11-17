// Report the loaded authored-source scope separately from generated fixture bundles.
const records = (await Bun.file('coverage/lcov.info').text()).split('end_of_record');
const totals = { LF: 0, LH: 0, FNF: 0, FNH: 0 };
let sources = 0;
let excluded = 0;
for (const record of records) {
  const lines = record.trim().split('\n');
  const source = lines.find(line => line.startsWith('SF:'))?.slice(3);
  if (!source) continue;
  if (!/^(scripts|server|src)\//.test(source)) { excluded++; continue; }
  sources++;
  for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
    totals[key] += Number(lines.find(line => line.startsWith(key + ':'))?.split(':')[1] || 0);
  }
}
if (!sources || !totals.LF || !totals.FNF) throw new Error('Missing authored-source coverage.');
const lines = totals.LH / totals.LF;
const functions = totals.FNH / totals.FNF;
console.log(`Loaded authored sources (${sources}): lines ${totals.LH}/${totals.LF} (${(lines * 100).toFixed(2)}%); functions ${totals.FNH}/${totals.FNF} (${(functions * 100).toFixed(2)}%).`);
console.log(`Excluded ${excluded} generated/test-preload records. This is not whole-app, UI, branch or scenario coverage; Bun does not report branch coverage here.`);
if (lines < 0.90 || functions < 0.90) throw new Error('Loaded authored-source line/function coverage is below 90%.');
