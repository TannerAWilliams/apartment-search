import { readdirSync, readFileSync } from 'node:fs';

/** Modules that start a process when loaded; they are exercised in child processes or bundles instead. */
export const ENTRY_POINTS: Record<string, string> = {
  'server/main.ts': 'starts the Bun server when loaded; http-server and public-server tests run it as a child process',
  'server/worker.ts': 'legacy ChatGPT Sites entry that needs build-time web assets; refresh tests run it as a built bundle',
};

/** UI modules need React Native, which the unit runner cannot load; the Playwright suite covers them. */
export const isUiModule = (source: string) => /from ['"](react|react-native|@react-native-async-storage\/[^'"]+)['"]/.test(source);

/** Application modules measured by unit-test coverage, relative to the repository root. */
export function applicationModules(root: URL) {
  const all = ['server', 'src'].flatMap((directory) => readdirSync(new URL(`${directory}/`, root))
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
    .map((name) => `${directory}/${name}`));
  const ui = all.filter((path) => path.endsWith('.tsx') || isUiModule(readFileSync(new URL(path, root), 'utf8')));
  return { measured: all.filter((path) => !ui.includes(path) && !Object.hasOwn(ENTRY_POINTS, path)), ui };
}
