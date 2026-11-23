/**
 * StreetEasy's Data Dashboard files. Each series is a small zip holding one CSV, published at
 * cdn-charts.streeteasy.com; the market history tables load them from there when you resync, and from the
 * archive bundled with the app (the same files, downloaded 2026-11-17) until then.
 */
import { strFromU8, unzipSync } from 'fflate';
import { dashboardMarket, type DashboardFile } from '../src/dashboard-data.ts';
import { parseDashboardCsv } from './dashboard-csv.ts';
import { DASHBOARD_CATALOG } from './data/dashboard-catalog.ts';

/** Where the archive is published with the web app's static files; the Worker refuses direct requests for it. */
export const DASHBOARD_ARCHIVE_PATH = '/data/streeteasy-dashboard-2026-11-17.zip';
export const ARCHIVE_SHA256 = '05d017d90302883339eca32fe920b6b170d85a3583d6f436bd78a720bc6adfdc';
export const DASHBOARD_CDN = 'https://cdn-charts.streeteasy.com';
export const PROVENANCE = {
  source: 'StreetEasy Data Dashboard',
  url: 'https://streeteasy.com/blog/data-dashboard/',
  downloadedAt: '2026-11-17',
  sourceArchive: `${DASHBOARD_CDN}/Master%20Report.zip`,
  sha256: ARCHIVE_SHA256,
  note: 'Market-wide monthly figures, not individual listings. Blank months are unknown. Source anomalies are kept as reported.',
};

/** Where StreetEasy publishes one series, such as rentals/OneBd/medianAskingRent_OneBd.zip. */
export function dashboardFileUrl(name: string) {
  const [metric, segment] = name.slice(0, -4).split('_') as [DashboardFile['metric'], string];
  return `${DASHBOARD_CDN}/${dashboardMarket(metric) === 'Rentals' ? 'rentals' : 'sales'}/${segment}/${name.replace(/\.csv$/, '.zip')}`;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A series' zip, checked and parsed. Throws when it is not a zip holding that series' CSV. */
export function parseSeriesZip(name: string, zip: Uint8Array) {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new Error(`StreetEasy's ${name} download is not a readable zip file.`);
  }
  const csv = files[name];
  if (!csv) throw new Error(`StreetEasy's download for ${name} does not contain that file.`);
  return parseDashboardCsv(name, strFromU8(csv));
}

export type ArchiveLoader = () => Promise<Uint8Array<ArrayBuffer>>;

/** Each loader's verified archive, so the Worker reads and checks it once. */
const archives = new WeakMap<ArchiveLoader, Promise<Record<string, Uint8Array<ArrayBuffer>>>>();

function archiveFor(load: ArchiveLoader) {
  let files = archives.get(load);
  if (!files) {
    files = load().then(async (bytes) => {
      if ((await sha256Hex(bytes)) !== ARCHIVE_SHA256) throw new Error('The dashboard archive does not match the original download.');
      return unzipSync(bytes) as Record<string, Uint8Array<ArrayBuffer>>;
    });
    // A failed read is not kept, so the next request tries again.
    files.catch(() => archives.delete(load));
    archives.set(load, files);
  }
  return files;
}

/** One series' zip from the verified archive; null when the archive has no such series. */
export async function archivedSeriesZip(name: string, loadArchive: ArchiveLoader) {
  if (!DASHBOARD_CATALOG.some((file) => file.name === name)) return null;
  return (await archiveFor(loadArchive))[name.replace(/\.csv$/, '.zip')] ?? null;
}
