import { DASHBOARD_SNAPSHOT } from './data/dashboard-snapshot.ts';
import { parseDashboardCsv } from '../src/dashboard-data.ts';
import base64 from 'base64-js';
import { unzipSync, strFromU8 } from 'fflate';
import { DASHBOARD_CATALOG } from './data/dashboard-catalog.ts';
let archives: Record<string, Uint8Array>;
const cache = new Map<string, ReturnType<typeof parseDashboardCsv>>();
export function dashboardSnapshot(name?: string) {
  const provenance = { source: 'StreetEasy Data Dashboard', url: 'https://streeteasy.com/blog/data-dashboard/',
    downloadedAt: '2026-11-17', sourceArchive: 'https://cdn-charts.streeteasy.com/Master%20Report.zip',
    sha256: '05d017d90302883339eca32fe920b6b170d85a3583d6f436bd78a720bc6adfdc',
    note: 'Frozen historical aggregate snapshot, not live listings. No automatic refresh. Source anomalies retained and labeled.' };
  if (name !== undefined) {
    if (!DASHBOARD_CATALOG.some(file => file.name === name)) return null;
    let file = cache.get(name);
    if (!file) {
      archives ??= unzipSync(base64.toByteArray(DASHBOARD_SNAPSHOT));
      const extracted = unzipSync(archives[name.replace(/\.csv$/, '.zip')]);
      file = parseDashboardCsv(name, strFromU8(extracted[name]));
      if (cache.size >= 3) { const oldest = cache.keys().next(); if (!oldest.done) cache.delete(oldest.value); }
      cache.set(name, file);
    }
    return { provenance, file };
  }
  return { provenance, files: DASHBOARD_CATALOG };

}
