import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cronLine, launchdPlist, parseArgs, syncTime, withoutSyncJob } from '../scripts/install-streeteasy-schedule.ts';
import { configDir, savedOrigin, savedToken } from '../scripts/streeteasy-daily.ts';

const job = { repo: "/Users/me/my apps/apartment-search", bun: '/Users/me/.bun/bin/bun', hour: 6, minute: 5, log: "/Users/me/it's.log" };

test('installer arguments: --origin=, a bare URL, --origin URL and --uninstall', () => {
  expect(parseArgs(['--origin=https://app.example.dev/'])).toEqual({ origin: 'https://app.example.dev', uninstall: false });
  expect(parseArgs(['--origin', 'https://app.example.dev'])).toEqual({ origin: 'https://app.example.dev', uninstall: false });
  expect(parseArgs(['--uninstall'])).toEqual({ origin: '', uninstall: true });
  expect(() => parseArgs(['--bogus'])).toThrow('Unknown argument: --bogus');
  expect(() => parseArgs(['--origin=https://a.dev', 'https://b.dev'])).toThrow('Unknown argument');
});

test('the sync time defaults to 6:17 and refuses impossible times', () => {
  expect(syncTime({})).toEqual({ hour: 6, minute: 17, label: '6:17' });
  expect(syncTime({ SYNC_HOUR: '23', SYNC_MINUTE: '5' })).toEqual({ hour: 23, minute: 5, label: '23:05' });
  for (const env of [{ SYNC_HOUR: '24' }, { SYNC_MINUTE: '60' }, { SYNC_HOUR: 'six' }, { SYNC_MINUTE: '1.5' }]) expect(() => syncTime(env)).toThrow();
});

test('launchd runs the TypeScript runner with Bun from the repository, with paths escaped', () => {
  const plist = launchdPlist({ ...job, repo: '/Users/me/a&b' });
  expect(plist).toContain('<string>/Users/me/.bun/bin/bun</string><string>/Users/me/a&amp;b/scripts/streeteasy-daily.ts</string>');
  expect(plist).toContain('<key>WorkingDirectory</key><string>/Users/me/a&amp;b</string>');
  expect(plist).toContain('<key>Hour</key><integer>6</integer><key>Minute</key><integer>5</integer>');
  expect(plist).not.toContain('/bin/bash');
});

test('cron quotes every path and replaces an older shell-script job, keeping other jobs', () => {
  expect(cronLine(job)).toBe("5 6 * * * cd '/Users/me/my apps/apartment-search' && '/Users/me/.bun/bin/bun' scripts/streeteasy-daily.ts >> '/Users/me/it'\\''s.log' 2>&1");
  const crontab = '1 2 * * * backup\n\n17 6 * * * /bin/bash /repo/scripts/streeteasy-daily.sh\n5 6 * * * bun scripts/streeteasy-daily.ts\n';
  expect(withoutSyncJob(crontab)).toEqual(['1 2 * * * backup']);
});

test('the runner reads the saved origin and token, preferring flags and the environment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apartment-search-'));
  try {
    expect(configDir({ XDG_CONFIG_HOME: dir })).toBe(join(dir, 'apartment-search'));
    expect(configDir({ XDG_CONFIG_HOME: '' })).toEndWith('/.config/apartment-search');
    await expect(savedOrigin([], {}, dir)).rejects.toThrow('Set APARTMENT_SEARCH_ORIGIN');
    await expect(savedToken(dir, 'linux')).rejects.toThrow('No app access token found');
    await Bun.write(join(dir, 'origin'), 'https://saved.example.dev\n');
    await Bun.write(join(dir, 'token'), 'token-from-file\n');
    expect(await savedOrigin([], {}, dir)).toBe('https://saved.example.dev');
    expect(await savedOrigin([], { APARTMENT_SEARCH_ORIGIN: 'https://env.example.dev' }, dir)).toBe('https://env.example.dev');
    expect(await savedOrigin(['--origin=https://flag.example.dev/path'], {}, dir)).toBe('https://flag.example.dev');
    expect(await savedToken(dir, 'linux')).toBe('token-from-file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
