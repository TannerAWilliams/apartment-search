/** UI modules need React Native, which the unit runner cannot load; the Playwright suite covers them. */
const isUiModule = (source: string) => /from ['"](react|react-native|@react-native-async-storage\/[^'"]+)['"]/.test(source);

/** Application modules measured by unit-test coverage, relative to the repository root. */
export async function applicationModules(root: URL) {
  const all = ['server/*.ts', 'server/routes/*.ts', 'src/*.{ts,tsx}'].flatMap((pattern) => [...new Bun.Glob(pattern).scanSync(root.pathname)])
    .filter((path) => !path.endsWith('.d.ts')).sort();
  const ui = new Set<string>();
  for (const path of all) if (path.endsWith('.tsx') || isUiModule(await Bun.file(new URL(path, root)).text())) ui.add(path);
  return { measured: all.filter((path) => !ui.has(path)), ui: all.filter((path) => ui.has(path)) };
}
