#!/usr/bin/env bun
/**
 * Runs the StreetEasy sync once and uploads the result to the apartment-search Worker.
 * Installed as a daily job by scripts/install-streeteasy-schedule.ts.
 *   bun scripts/streeteasy-daily.ts [--manual] [--origin=https://…]
 */
import { $ } from 'bun';
import { appOrigin, syncStreetEasy } from './sync-streeteasy.ts';

export const KEYCHAIN_SERVICE = 'apartment-search-app-token';
type Env = Record<string, string | undefined>;

/** Where the installer keeps the Worker origin and, on Linux, the token. */
export const configDir = (env: Env = Bun.env) => `${env.XDG_CONFIG_HOME || `${env.HOME ?? Bun.env.HOME}/.config`}/apartment-search`;

/** The Worker origin: --origin=, then APARTMENT_SEARCH_ORIGIN, then the one saved by the installer. */
export async function savedOrigin(argv: string[], env: Env, dir: string) {
  const flag = argv.find((value) => value.startsWith('--origin='))?.slice('--origin='.length);
  if (flag || env.APARTMENT_SEARCH_ORIGIN) return appOrigin(flag || env.APARTMENT_SEARCH_ORIGIN);
  const file = Bun.file(`${dir}/origin`);
  return appOrigin(await file.exists() ? (await file.text()).trim() : undefined);
}

/** The app access token, from the macOS Keychain or the installer's token file (mode 600). */
export async function savedToken(dir: string, platform: string = process.platform) {
  if (platform === 'darwin') return (await $`security find-generic-password -s ${KEYCHAIN_SERVICE} -w`.quiet().text()).trim();
  const file = Bun.file(`${dir}/token`);
  if (!await file.exists()) throw new Error('No app access token found. Run bun scripts/install-streeteasy-schedule.ts first.');
  return (await file.text()).trim();
}

if (import.meta.main) {
  try {
    const dir = configDir();
    const origin = await savedOrigin(Bun.argv, Bun.env, dir);
    const result = await syncStreetEasy({ token: await savedToken(dir), origin, manual: Bun.argv.includes('--manual') });
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), state: 'failed', error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  }
}
