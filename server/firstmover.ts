import type { MarketRow } from '../src/market.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { isRecord } from '../src/domain.ts';
import { parse } from 'csv-parse/browser/esm/sync';

const REPOSITORY_PATH = 'benfwalla/firstmover-open-data-project';
const CATALOG_URL = `https://api.github.com/repos/${REPOSITORY_PATH}/contents/public/data`;
const CSV_ROOT = `https://raw.githubusercontent.com/${REPOSITORY_PATH}/main/public/data/`;
const PUBLISHED_CATALOG = 'https://www.firstmovernyc.com/open-data';
const MONTHLY_FILE = /^20\d{2}-(0[1-9]|1[0-2])\.csv$/;
const MAX_CSV_BYTES = 32 * 1024 * 1024;
const NYC_COUNTIES = {
  Manhattan: 'New York', Brooklyn: 'Kings', Queens: 'Queens', Bronx: 'Bronx', 'Staten Island': 'Richmond',
};
export const NJ_ZIPS: Record<string, [string, string]> = {
  '07002': ['Bayonne', 'Hudson'], '07010': ['Cliffside Park', 'Bergen'],
  '07020': ['Edgewater', 'Bergen'], '07024': ['Fort Lee', 'Bergen'],
  '07029': ['Harrison', 'Hudson'], '07030': ['Hoboken', 'Hudson'],
  '07032': ['Kearny', 'Hudson'], '07047': ['North Bergen', 'Hudson'],
  '07086': ['Weehawken', 'Hudson'], '07087': ['Union City', 'Hudson'],
  '07093': ['West New York', 'Hudson'], '07094': ['Secaucus', 'Hudson'],
  '07302': ['Jersey City', 'Hudson'], '07304': ['Jersey City', 'Hudson'],
  '07305': ['Jersey City', 'Hudson'], '07306': ['Jersey City', 'Hudson'],
  '07307': ['Jersey City', 'Hudson'], '07310': ['Jersey City', 'Hudson'],
  '07311': ['Jersey City', 'Hudson'],
};
const EXCLUDED = new Set(['HOUSE', 'TOWNHOUSE', 'COMMERCIAL', 'LAND']);
const COLUMNS = ['id', 'street', 'unit', 'state', 'zip_code', 'neighborhood',
  'latitude', 'longitude', 'bedrooms', 'price', 'url', 'created_at_utc', 'building_type'];

export function nycBorough(zip: string): keyof typeof NYC_COUNTIES | null {
  const prefix = zip.slice(0, 3);
  if (['100', '101', '102'].includes(prefix)) return 'Manhattan';
  if (prefix === '103') return 'Staten Island';
  if (prefix === '104') return 'Bronx';
  if (prefix === '112') return 'Brooklyn';
  if (['111', '113', '114', '116'].includes(prefix) || ['11004', '11005'].includes(zip)) return 'Queens';
  return null;
}

function packedRow(row: Record<string, string>): MarketRow | null {
  const address = row.street.trim();
  const zip = row.zip_code.trim();
  const neighborhood = row.neighborhood.trim();
  const state = row.state.trim();
  const bedrooms = row.bedrooms.trim() === '' ? NaN : Number(row.bedrooms);
  const rent = Number(row.price);
  const latitude = Math.round(Number(row.latitude) * 1e6) / 1e6;
  const longitude = Math.round(Number(row.longitude) * 1e6) / 1e6;
  const path = row.url.match(/^https:\/\/streeteasy\.com(\/(?:building|rental)\/[^?#]+)(?:[?#].*)?$/)?.[1];
  if (!row.id || !address || !neighborhood || !/^\d{5}$/.test(zip) || !path || EXCLUDED.has(row.building_type) ||
      !Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 4 || !(rent > 0 && rent <= 100000) ||
      !(latitude >= 40 && latitude <= 42 && longitude >= -75 && longitude <= -72)) return null;

  let city;
  let county;
  if (state === 'NY') {
    city = nycBorough(zip);
    county = city ? NYC_COUNTIES[city] : undefined;
  } else if (state === 'NJ') {
    [city, county] = NJ_ZIPS[zip] ?? [];
    if (zip === '07093' && neighborhood === 'Guttenberg') city = 'Guttenberg';
  }
  if (!city) return null;
  return [row.id, address, row.unit.trim(), city, county ?? '', state, zip, neighborhood, latitude,
    longitude, bedrooms, rent, path, row.created_at_utc.slice(0, 10), row.source_group?.trim().slice(0, 160) ?? ''];
}

export function parseFirstMoverCsv(csv: string, month: string) {
  const records = parse<Record<string, string>>(csv, {
    bom: true,
    skip_empty_lines: true,
    max_record_size: 65536,
    columns: (headers) => {
      if (!COLUMNS.every((column) => headers.includes(column))) throw new Error('The FirstMover CSV columns changed.');
      return headers.map((header) => COLUMNS.includes(header) || header === 'source_group' ? header : false);
    },
  });
  const paths = new Set<string>();
  const listings: MarketRow[] = [];
  for (const row of records.sort((a, b) => a.created_at_utc.localeCompare(b.created_at_utc))) {
    if (!row.created_at_utc.startsWith(month + '-')) throw new Error('The FirstMover CSV contains a different month.');
    const listing = packedRow(row);
    if (!listing || paths.has(listing[12])) continue;
    paths.add(listing[12]);
    listings.push(listing);
  }
  if (!listings.length) throw new Error('The FirstMover CSV contained no supported listings.');
  return listings;
}

type FirstMoverState = { month?: string; revision?: string; catalogEtag?: string; csvEtag?: string };
/** A file in GitHub's directory listing; sha and size are checked before use. */
type CatalogFile = { type: 'file'; name: string; sha?: unknown; size?: unknown };

export async function checkFirstMover(previous: FirstMoverState | null | undefined, fetcher: FetchTransport = fetch) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (previous?.catalogEtag) headers['If-None-Match'] = previous.catalogEtag;
  const response = await fetcher(CATALOG_URL, { headers, redirect: 'manual', signal: AbortSignal.timeout(12000) });
  if (response.status === 304 && previous?.revision) return { changed: false as const, ...previous };
  if (!response.ok) throw new Error(`FirstMover catalog returned HTTP ${response.status}.`);
  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error('The FirstMover catalog was invalid.');
  const entry = entries.filter((file): file is CatalogFile => isRecord(file) && file.type === 'file' &&
    typeof file.name === 'string' && MONTHLY_FILE.test(file.name)).sort((a, b) => b.name.localeCompare(a.name))[0];
  if (!entry || typeof entry.sha !== 'string' || !/^[a-f0-9]{40}$/.test(entry.sha) ||
      typeof entry.size !== 'number' || !(entry.size > 0 && entry.size <= MAX_CSV_BYTES)) {
    throw new Error('The latest FirstMover CSV is unavailable or too large.');
  }

  const month = entry.name.slice(0, 7);
  const catalogEtag = response.headers.get('ETag') ?? '';
  if (previous?.month && previous.month > month) throw new Error('The FirstMover catalog returned an older snapshot.');
  if (previous?.revision === entry.sha) return { changed: false as const, ...previous, catalogEtag };

  const download = await fetcher(CSV_ROOT + entry.name, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const raw = await readCsv(download);
  const rows = parseFirstMoverCsv(new TextDecoder().decode(raw), month);
  return { changed: true as const, month, revision: entry.sha, catalogEtag, csvEtag: download.headers.get('ETag') ?? '', rows };
}

async function readCsv(response: Response) {
  if (!response.ok) throw new Error(`FirstMover download returned HTTP ${response.status}.`);
  if (Number(response.headers.get('Content-Length')) > MAX_CSV_BYTES) throw new Error('The FirstMover CSV is too large.');
  const raw = await response.arrayBuffer();
  if (raw.byteLength > MAX_CSV_BYTES) throw new Error('The FirstMover CSV is too large.');
  return raw;
}

async function gitRevision(raw: ArrayBuffer) {
  const header = new TextEncoder().encode('blob ' + raw.byteLength + '\0');
  const blob = new Uint8Array(header.length + raw.byteLength);
  blob.set(header);
  blob.set(new Uint8Array(raw), header.length);
  const hash = await crypto.subtle.digest('SHA-1', blob);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function checkPublishedFirstMover(previous: FirstMoverState | null | undefined, fetcher: FetchTransport) {
  const page = await fetcher(PUBLISHED_CATALOG, { redirect: 'manual', signal: AbortSignal.timeout(9000) });
  if (!page.ok) throw new Error(`FirstMover catalog returned HTTP ${page.status}.`);
  const html = await page.text();
  const file = [...html.matchAll(/\bhref=["']([^"']+)["']/gi)]
    .map(([, href]) => href.startsWith(CSV_ROOT) ? href.slice(CSV_ROOT.length) : '')
    .filter((name) => MONTHLY_FILE.test(name)).sort().at(-1);
  if (!file) throw new Error('The latest FirstMover CSV is unavailable.');

  const month = file.slice(0, 7);
  if (previous?.month && previous.month > month) throw new Error('The FirstMover catalog returned an older snapshot.');
  const headers: Record<string, string> = previous?.month === month && previous.csvEtag ? { 'If-None-Match': previous.csvEtag } : {};
  const download = await fetcher(CSV_ROOT + file, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (download.status === 304 && headers['If-None-Match']) return { changed: false as const, ...previous };

  const raw = await readCsv(download);
  const csvEtag = download.headers.get('ETag') ?? '';
  const revision = await gitRevision(raw);
  if (previous?.revision === revision) return { changed: false as const, ...previous, csvEtag };
  return { changed: true as const, month, revision, csvEtag, rows: parseFirstMoverCsv(new TextDecoder().decode(raw), month) };
}
