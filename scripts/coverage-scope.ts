import { readdirSync, readFileSync } from 'node:fs';

/** UI modules need React Native, which the unit runner cannot load; the Playwright suite covers them. */
export const isUiModule = (source: string) => /from ['"](react|react-native|@react-native-async-storage\/[^'"]+)['"]/.test(source);

/** Application modules measured by unit-test coverage, relative to the repository root. */
export function applicationModules(root: URL) {
  const all = ['server', 'src'].flatMap((directory) => readdirSync(new URL(`${directory}/`, root))
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
    .map((name) => `${directory}/${name}`));
  const ui = all.filter((path) => path.endsWith('.tsx') || isUiModule(readFileSync(new URL(path, root), 'utf8')));
  return { measured: all.filter((path) => !ui.includes(path)), ui };
}
