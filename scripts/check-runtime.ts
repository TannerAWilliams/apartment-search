/** The Bun version this project is pinned to (.bun-version, which CI and Renovate also read). */
const PINNED_BUN = (await Bun.file(new URL('../.bun-version', import.meta.url)).text()).trim();

/** Refuses to run on another Bun version, whose behavior the tests have not checked. */
export function requirePinnedBun() {
  if (Bun.version !== PINNED_BUN) throw new Error(`Bun ${PINNED_BUN} is required (see .bun-version); this is Bun ${Bun.version}.`);
}
