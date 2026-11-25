/**
 * Size budgets for what is downloaded and what the server starts with:
 *
 *   bun run build:web && bun run perf:bundle
 *
 * - the web app's first download (the scripts and styles index.html names), compressed as it is sent;
 * - what must never be in that first download: the map libraries, which are large and only needed with a map
 *   (they slipped in once and doubled it);
 * - every lazily loaded file, so none grows unnoticed;
 * - the Worker's script, which every new server instance reads before it can answer.
 * Limits are in perf/budgets.json under "bundles", in KB after gzip; raise one on purpose, in the same commit
 * as the change that needs it.
 */
import { $ } from 'bun';

type Bundles = { entryJsKb: number; entryCssKb: number; lazyChunkKb: number; totalJsKb: number; workerKb: number };
/** Text that only appears inside a library, which the first download must not contain. */
const NOT_IN_FIRST_DOWNLOAD = { MapLibre: 'maplibregl-canvas', Leaflet: 'leaflet-pane' };

const root = new URL('../', import.meta.url);
const gzipKb = (bytes: Uint8Array) => Bun.gzipSync(bytes as Uint8Array<ArrayBuffer>).byteLength / 1024;
const read = async (path: string) => new Uint8Array(await Bun.file(new URL(path, root)).arrayBuffer());

/** Everything over its limit, as lines to print. */
export function overLimits(measured: Record<keyof Bundles, number>, limits: Bundles, contains: string[] = []) {
  return [
    ...(Object.keys(limits) as (keyof Bundles)[])
      .filter((name) => measured[name] > limits[name])
      .map((name) => `${name}: ${measured[name].toFixed(0)} KB is over its limit of ${limits[name]} KB`),
    ...contains.map((library) => `the first download contains ${library}, which must stay in the lazily loaded map file`),
  ];
}

if (import.meta.main) {
  const html = await Bun.file(new URL('web-build/index.html', root)).text();
  const named = (pattern: RegExp) => [...new Set([...html.matchAll(pattern)].map((match) => 'web-build' + match[1]!))];
  const entryJs = await Promise.all(named(/<script[^>]+src="([^"]+\.js)"/g).map(read));
  const entryCss = await Promise.all(named(/<link[^>]+href="([^"]+\.css)"/g).map(read));
  const chunkPaths = [...new Bun.Glob('web-build/_expo/static/js/web/*.js').scanSync(root.pathname)];
  const chunks = await Promise.all(chunkPaths.map(async (path) => ({ path, kb: gzipKb(await read(path)) })));
  const entryNames = new Set(named(/<script[^>]+src="([^"]+\.js)"/g));
  // The Worker as Wrangler bundles it for upload.
  const out = new URL('.wrangler/perf-bundle/', root).pathname;
  await $`node ./node_modules/wrangler/bin/wrangler.js deploy -c deploy/cloudflare/wrangler.jsonc --dry-run --outdir ${out}`
    .cwd(root.pathname)
    .quiet();
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const measured = {
    entryJsKb: sum(entryJs.map(gzipKb)),
    entryCssKb: sum(entryCss.map(gzipKb)),
    lazyChunkKb: Math.max(0, ...chunks.filter(({ path }) => !entryNames.has(path)).map(({ kb }) => kb)),
    totalJsKb: sum(chunks.map(({ kb }) => kb)),
    workerKb: gzipKb(await read('.wrangler/perf-bundle/cloudflare.js')),
  };
  const decoder = new TextDecoder();
  const first = entryJs.map((bytes) => decoder.decode(bytes)).join('\n');
  const contains = Object.entries(NOT_IN_FIRST_DOWNLOAD).flatMap(([library, marker]) => (first.includes(marker) ? [library] : []));
  const budgets = await Bun.file(new URL('perf/budgets.json', root)).json();
  if (Bun.argv.includes('--update') || !budgets.bundles) {
    // A tenth of headroom: enough for ordinary changes, not for a library.
    budgets.bundles = Object.fromEntries(Object.entries(measured).map(([name, kb]) => [name, Math.ceil(kb * 1.1)]));
    await Bun.write(new URL('perf/budgets.json', root), JSON.stringify(budgets, null, 2) + '\n');
    console.log('Recorded new bundle limits in perf/budgets.json.');
  }
  const limits: Bundles = budgets.bundles;
  const lines = (Object.keys(measured) as (keyof Bundles)[]).map(
    (name) => `| ${name} | ${measured[name].toFixed(0)} KB | ${limits[name]} KB |`,
  );
  const table = ['| Bundle (gzip) | Size | Limit |', '|---|---:|---:|', ...lines].join('\n');
  console.log(table + '\n');
  const failures = overLimits(measured, limits, contains);
  if (process.env.GITHUB_STEP_SUMMARY)
    await Bun.write(
      process.env.GITHUB_STEP_SUMMARY,
      `## Download sizes\n\n${table}\n\n${failures.length ? failures.map((line) => `- ❌ ${line}`).join('\n') : 'All within limits.'}\n`,
    );
  if (failures.length) {
    console.error('Over limit:\n' + failures.map((line) => '  ✗ ' + line).join('\n'));
    process.exit(1);
  }
  console.log('All within limits.');
}
