import type { SourceFetch } from './refresh.ts';
import { safeListingUrl } from '../src/marketplaces.ts';

const ORIGIN = 'https://www.nychdc.com';
const MAX_PAGES = 12;
export const HDC_RERENTALS = { id: 'hdc-rerentals', name: 'NYC HDC Re-rentals' };

async function readPage(fetcher: SourceFetch, page = 1, offset = 0) {
  const query = new URLSearchParams({ 'current-page': String(page), offset: String(offset) });
  const response = await fetcher(`${ORIGIN}/api/re-rentals?${query}`, {
    headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('NYC HDC returned HTTP ' + response.status + '.');
  const data = await response.json();
  if (!Array.isArray(data?.json) || Number(data.pagination?.['current-page']) !== page) {
    throw new Error('NYC HDC did not return a recognized listing page.');
  }
  return data;
}

const field = (value: unknown, length = 160) => typeof value === 'string' ? value.trim().slice(0, length) : '';

function opportunity(row: Record<string, unknown> | null) {
  const id = field(row?.nid, 12);
  const name = field(row?.title);
  const pdf = typeof row?.pdf === 'string' && row.pdf.startsWith('/sites/default/files/') ?
    safeListingUrl(ORIGIN + row.pdf) : null;
  const url = pdf ?? safeListingUrl(row?.cta);
  if (!row || !/^\d+$/.test(id) || !name || !url) return null;
  return { id, name, url, address: field(row.address), borough: field(row.borough), rent: field(row.rent_range),
    bedrooms: field(row.bedrooms_copy), age: field(row.age_restriction_copy), accessibility: field(row.adaptation_copy) };
}

export async function loadHdcRerentals(fetcher: SourceFetch) {
  const first = await readPage(fetcher);
  const pages = Number(first.pagination['page-count']);
  const perPage = Number(first.pagination['per-page']);
  const total = Number(first.pagination['total-results']);
  if (!Number.isInteger(pages) || pages < 0 || !Number.isInteger(perPage) || perPage < 1 || perPage > 50 ||
      !Number.isInteger(total) || total < 0 || Math.ceil(total / perPage) !== pages) {
    throw new Error('NYC HDC returned invalid pagination.');
  }
  const rows = [...first.json];
  for (let page = 2; page <= Math.min(pages, MAX_PAGES); page += 1) {
    const next = await readPage(fetcher, page, (page - 1) * perPage);
    rows.push(...next.json);
  }
  const results = [...new Map(rows.map(opportunity).filter((row): row is NonNullable<typeof row> => row !== null).map((row) => [row.id, row])).values()];
  if (total > 0 && results.length === 0) throw new Error('NYC HDC did not return usable listings.');
  return { results, total, limited: results.length < total };
}
