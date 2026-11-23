import { parseDashboardCsv } from './dashboard-csv.ts';
import { unzipSync, strFromU8 } from 'fflate';
import { DASHBOARD_CATALOG } from './data/dashboard-catalog.ts';

/** Where the archive is published with the web app's static files; the Worker refuses direct requests for it. */
export const DASHBOARD_ARCHIVE_PATH = '/data/streeteasy-dashboard-2026-11-17.zip';
const ARCHIVE_SHA256 = '05d017d90302883339eca32fe920b6b170d85a3583d6f436bd78a720bc6adfdc';
const PROVENANCE = {
  source: 'StreetEasy Data Dashboard',
  url: 'https://streeteasy.com/blog/data-dashboard/',
  downloadedAt: '2026-11-17',
  sourceArchive: 'https://cdn-charts.streeteasy.com/Master%20Report.zip',
  sha256: ARCHIVE_SHA256,
  note: 'Frozen historical aggregate snapshot, not live listings. No automatic refresh. Source anomalies retained and labeled.',
};

export type ArchiveLoader = () => Promise<Uint8Array<ArrayBuffer>>;
type Archive = { files: Promise<Record<string, Uint8Array>>; series: Map<string, ReturnType<typeof parseDashboardCsv>> };

/** Each loader's archive and its last few parsed series, so the Worker reads and verifies the archive once. */
const archives = new WeakMap<ArchiveLoader, Archive>();

function archiveFor(load: ArchiveLoader) {
  let archive = archives.get(load);
  if (!archive) {
    const files = load().then(async (bytes) => {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (hex !== ARCHIVE_SHA256) throw new Error('The dashboard archive does not match the original download.');
      return unzipSync(bytes);
    });
    // A failed read is not kept, so the next request tries again.
    files.catch(() => archives.delete(load));
    archive = { files, series: new Map() };
    archives.set(load, archive);
  }
  return archive;
}

/** The catalog, or one parsed series by file name (null when unknown). The archive is read only for a series. */
export async function dashboardSnapshot(name: string | undefined, loadArchive: ArchiveLoader) {
  if (name === undefined) return { provenance: PROVENANCE, files: DASHBOARD_CATALOG };
  if (!DASHBOARD_CATALOG.some((file) => file.name === name)) return null;
  const { files, series } = archiveFor(loadArchive);
  let file = series.get(name);
  if (!file) {
    const extracted = unzipSync((await files)[name.replace(/\.csv$/, '.zip')]);
    file = parseDashboardCsv(name, strFromU8(extracted[name]));
    if (series.size >= 3) {
      const oldest = series.keys().next();
      if (!oldest.done) series.delete(oldest.value);
    }
    series.set(name, file);
  }
  return { provenance: PROVENANCE, file };
}
