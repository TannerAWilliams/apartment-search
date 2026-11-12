import { readdir, readFile, mkdir, copyFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { build } from 'esbuild';
import { MIME } from '../server/mime.ts';

async function loadAssets(directory, prefix = '') {
  const assets = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(assets, await loadAssets(path, key));
    } else if (!key.endsWith('.map') && key !== '/metadata.json') {
      const type = MIME[extname(entry.name)] || 'application/octet-stream';
      const binary = !/charset=utf-8|image\/svg\+xml/.test(type);
      assets[key] = { type, binary, content: await readFile(path, binary ? 'base64' : 'utf8') };
    }
  }
  return assets;
}

const assets = await loadAssets('web-build');
const runner = await build({
  entryPoints: ['scripts/refresh-runner.ts'], bundle: true, platform: 'node',
  format: 'esm', target: 'node22', write: false, minify: true,
});
assets['/_refresh-runner.mjs'] = { type: 'text/javascript; charset=utf-8', binary: false,
  content: runner.outputFiles[0].text };

const streetEasyRunner = await build({
  entryPoints: ['scripts/sync-streeteasy.ts'], bundle: true, platform: 'node',
  format: 'esm', target: 'node22', write: false, minify: true,
});
assets['/_streeteasy-sync.mjs'] = { type: 'text/javascript; charset=utf-8', binary: false,
  content: streetEasyRunner.outputFiles[0].text };

if (!assets['/index.html']) throw new Error('The Expo web build is missing index.html.');
await build({
  entryPoints: ['server/worker.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  plugins: [{
    name: 'expo-web-assets',
    setup(builder) {
      builder.onResolve({ filter: /^virtual:web-assets$/ }, (args) => ({ path: args.path, namespace: 'assets' }));
      builder.onLoad({ filter: /.*/, namespace: 'assets' }, () => ({
        contents: `export default ${JSON.stringify(assets)};`,
        loader: 'js',
      }));
    },
  }],
});
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
