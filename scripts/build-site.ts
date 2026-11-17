import '../scripts/check-runtime.ts';
import { extname } from 'node:path';
import { MIME } from '../server/mime.ts';

const assets: Record<string, { type: string; binary: boolean; content: string }> = {};
for await (const relative of new Bun.Glob('**/*').scan({ cwd: 'web-build', onlyFiles: true, dot: true })) {
  if (relative.endsWith('.map') || relative === 'metadata.json') continue;
  const type = MIME[extname(relative)] || 'application/octet-stream';
  const binary = !/charset=utf-8|image\/svg\+xml/.test(type);
  const file = Bun.file('web-build/' + relative);
  assets['/' + relative] = { type, binary, content: binary ? Buffer.from(await file.arrayBuffer()).toString('base64') : await file.text() };
}
async function bundleRunner(path: string) {
  const result = await Bun.build({ entrypoints: [path], target: 'bun', format: 'esm', minify: true });
  if (!result.success || result.outputs.length !== 1) throw new Error('Runner bundle failed.');
  return result.outputs[0].text();
}
assets['/_refresh-runner.mjs'] = { type: 'text/javascript; charset=utf-8', binary: false, content: await bundleRunner('scripts/refresh-runner.ts') };
assets['/_streeteasy-sync.mjs'] = { type: 'text/javascript; charset=utf-8', binary: false, content: await bundleRunner('scripts/sync-streeteasy.ts') };
if (!assets['/index.html']) throw new Error('The Expo web build is missing index.html.');
const worker = await Bun.build({
  entrypoints: ['server/worker.ts'], target: 'browser', format: 'esm', minify: true,
  plugins: [{ name: 'expo-web-assets', setup(builder) {
    builder.onResolve({ filter: /^virtual:web-assets$/ }, args => ({ path: args.path, namespace: 'assets' }));
    builder.onLoad({ filter: /.*/, namespace: 'assets' }, () => ({ contents: `export default ${JSON.stringify(assets)};`, loader: 'js' }));
  } }],
});
if (!worker.success || worker.outputs.length !== 1) throw new Error('Worker bundle failed.');
await Bun.write('dist/server/index.js', worker.outputs[0]);
await Bun.write('dist/.openai/hosting.json', Bun.file('.openai/hosting.json'));
