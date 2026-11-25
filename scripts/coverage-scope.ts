/** UI modules need React Native, which the unit runner cannot load; the Playwright suite covers them. */
const isUiModule = (source: string) => /from ['"](react|react-native|@react-native-async-storage\/[^'"]+)['"]/.test(source);

/** Application modules measured by unit-test coverage, relative to the repository root. */
export async function applicationModules(root: URL) {
  const all = ['server/*.ts', 'server/{refresh,routes,sources,storage}/*.ts', 'src/*.{ts,tsx}', 'src/{components,hooks,screens}/*.{ts,tsx}']
    .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync(root.pathname)])
    .filter((path) => !path.endsWith('.d.ts'))
    .sort();
  // Every file is read at once; Bun reads them in parallel.
  const isUi = await Promise.all(all.map(async (path) => path.endsWith('.tsx') || isUiModule(await Bun.file(new URL(path, root)).text())));
  const ui = new Set(all.filter((_, index) => isUi[index]));
  return { measured: all.filter((path) => !ui.has(path)), ui: all.filter((path) => ui.has(path)) };
}
