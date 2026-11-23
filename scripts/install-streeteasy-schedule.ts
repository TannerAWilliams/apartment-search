#!/usr/bin/env bun
/**
 * Installs (or removes) a daily StreetEasy sync on this computer.
 *   bun scripts/install-streeteasy-schedule.ts --origin=https://apartment-search.<subdomain>.workers.dev
 *   bun scripts/install-streeteasy-schedule.ts --uninstall
 * macOS uses launchd (a missed run happens when the Mac wakes); Linux uses cron. SYNC_HOUR and SYNC_MINUTE
 * change the time from 6:17.
 */
import { $ } from 'bun';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { configDir, KEYCHAIN_SERVICE } from './streeteasy-daily.ts';

const LABEL = 'com.apartment-search.streeteasy';
const REPO = join(import.meta.dir, '..');
const PLIST = join(homedir(), 'Library/LaunchAgents', LABEL + '.plist');
/** Matches this job's cron line, including one from the older shell-script runner. */
const SYNC_JOB = /streeteasy-daily\.(?:ts|sh)/;

export function parseArgs(args: string[]) {
  let origin = '';
  let uninstall = false;
  for (const arg of args) {
    if (arg.startsWith('--origin=')) origin = arg.slice('--origin='.length);
    else if (arg === '--uninstall') uninstall = true;
    else if (!origin && arg.startsWith('https://')) origin = arg;
    else if (arg !== '--origin') throw new Error('Unknown argument: ' + arg);
  }
  return { origin: origin.replace(/\/$/, ''), uninstall };
}

/** The time of day, from SYNC_HOUR and SYNC_MINUTE. */
export function syncTime(env: Record<string, string | undefined>) {
  const hour = Number(env.SYNC_HOUR || 6);
  const minute = Number(env.SYNC_MINUTE || 17);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('SYNC_HOUR must be 0–23 and SYNC_MINUTE 0–59.');
  }
  return { hour, minute, label: `${hour}:${String(minute).padStart(2, '0')}` };
}

type Job = { repo: string; bun: string; hour: number; minute: number; log: string };
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shell = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

export function launchdPlist({ repo, bun, hour, minute, log }: Job) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(bun)}</string><string>${xml(join(repo, 'scripts/streeteasy-daily.ts'))}</string></array>
  <key>WorkingDirectory</key><string>${xml(repo)}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

export const cronLine = ({ repo, bun, hour, minute, log }: Job) =>
  `${minute} ${hour} * * * cd ${shell(repo)} && ${shell(bun)} scripts/streeteasy-daily.ts >> ${shell(log)} 2>&1`;

/** A crontab without this job, ready for another line to be added. */
export const withoutSyncJob = (crontab: string) => crontab.split('\n').filter((line) => line.trim() && !SYNC_JOB.test(line));

/** Reads a line without echoing it, so the token never shows on screen. */
async function readSecret(prompt: string) {
  process.stdout.write(prompt);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    for await (const line of console) return line.trim();
    return '';
  }
  stdin.setRawMode(true);
  let value = '';
  try {
    for await (const chunk of stdin) {
      for (const char of String(chunk)) {
        if (char === '\u0003') throw new Error('Cancelled.');
        if (char === '\r' || char === '\n') return value;
        value = char === '\u007f' ? value.slice(0, -1) : value + char;
      }
    }
    return value;
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    process.stdout.write('\n');
  }
}

async function uninstall(dir: string) {
  if (process.platform === 'darwin') {
    await $`launchctl bootout gui/${process.getuid?.()} ${PLIST}`.quiet().nothrow();
    await rm(PLIST, { force: true });
    await $`security delete-generic-password -s ${KEYCHAIN_SERVICE}`.quiet().nothrow();
  } else {
    const current = await $`crontab -l`.quiet().nothrow().text();
    await $`crontab - < ${new Response(withoutSyncJob(current).map((line) => line + '\n').join(''))}`;
    await rm(join(dir, 'token'), { force: true });
  }
  console.log('Removed the daily StreetEasy sync.');
}

async function install(origin: string, dir: string) {
  if (!origin) throw new Error('Pass --origin=https://<your apartment-search Worker URL>');
  if (!origin.startsWith('https://')) throw new Error('The origin must start with https://');
  const bun = process.execPath;
  const { hour, minute, label } = syncTime(process.env);
  await $`${bun} install --frozen-lockfile`.cwd(REPO).quiet();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  await Bun.write(join(dir, 'origin'), origin);

  console.log('Paste the app access token (APP_ACCESS_TOKEN on the Worker) when asked.');
  if (process.platform === 'darwin') {
    // -w last makes security prompt, so the token never appears in a process list.
    const prompt = Bun.spawn(['security', 'add-generic-password', '-U', '-a', userInfo().username, '-s', KEYCHAIN_SERVICE, '-w'], { stdio: ['inherit', 'inherit', 'inherit'] });
    if (await prompt.exited !== 0) throw new Error('The token was not saved to the Keychain.');
    const log = join(homedir(), 'Library/Logs/apartment-search-streeteasy.log');
    await mkdir(dirname(PLIST), { recursive: true });
    await Bun.write(PLIST, launchdPlist({ repo: REPO, bun, hour, minute, log }));
    const domain = `gui/${process.getuid?.()}`;
    await $`launchctl bootout ${domain} ${PLIST}`.quiet().nothrow();
    await $`launchctl bootstrap ${domain} ${PLIST}`;
    console.log(`Installed. StreetEasy syncs daily at ${label}. Log: ${log}`);
    console.log(`Run it now with: launchctl kickstart ${domain}/${LABEL}`);
  } else {
    const token = await readSecret('Token: ');
    if (!token) throw new Error('No token entered.');
    const file = join(dir, 'token');
    await writeFile(file, token, { mode: 0o600 });
    await chmod(file, 0o600);
    const log = join(dir, 'streeteasy.log');
    const current = await $`crontab -l`.quiet().nothrow().text();
    const lines = [...withoutSyncJob(current), cronLine({ repo: REPO, bun, hour, minute, log })];
    await $`crontab - < ${new Response(lines.map((line) => line + '\n').join(''))}`;
    console.log(`Installed. StreetEasy syncs daily at ${label}. Log: ${log}`);
    console.log(`Run it now with: bun scripts/streeteasy-daily.ts`);
  }
}

if (import.meta.main) {
  try {
    const { origin, uninstall: remove } = parseArgs(process.argv.slice(2));
    if (remove) await uninstall(configDir());
    else await install(origin, configDir());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
