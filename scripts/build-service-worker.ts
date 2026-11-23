// Bundles web/service-worker.ts into web-build/sw.js with Bun. Runs after the Expo web export.
const result = await Bun.build({
  entrypoints: [new URL('../web/service-worker.ts', import.meta.url).pathname],
  // A classic script: browsers register /sw.js without type: 'module', where `export` would not parse.
  target: 'browser',
  format: 'iife',
  minify: true,
});
if (!result.success || result.outputs.length !== 1) throw new AggregateError(result.logs, 'The service worker did not build.');
await Bun.write(new URL('../web-build/sw.js', import.meta.url), result.outputs[0]);
console.log(`Service worker: web-build/sw.js (${result.outputs[0].size} bytes)`);
