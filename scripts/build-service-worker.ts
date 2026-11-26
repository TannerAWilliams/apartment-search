import { assetHeadersFile } from '../server/web-headers.ts';

// After the Expo web export: bundles web/service-worker.ts into web-build/sw.js and web/boot.ts into
// web-build/boot.js with Bun, and writes web-build/_headers.
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

// The page's early requests (web/boot.ts): a few hundred bytes, loaded by index.html before the app.
const boot = await Bun.build({
  entrypoints: [new URL('../web/boot.ts', import.meta.url).pathname],
  target: 'browser',
  format: 'iife',
  minify: true,
});
if (!boot.success || boot.outputs.length !== 1) throw new AggregateError(boot.logs, 'The early-request script did not build.');
await Bun.write(new URL('../web-build/boot.js', import.meta.url), boot.outputs[0]);
console.log(`Early requests: web-build/boot.js (${boot.outputs[0].size} bytes)`);

// The security and caching headers for the pages and files Cloudflare serves without the Worker.
await Bun.write(new URL('../web-build/_headers', import.meta.url), await assetHeadersFile());
console.log('Headers for static files: web-build/_headers');
