import { isRecord } from '../src/domain.ts';
import { normalizeListing } from '../src/listings.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { nycBorough } from './firstmover.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'apartmentlist', name: 'Apartment List', kind: 'feed' };
const ORIGIN = 'https://www.apartmentlist.com';
const PAGES = [{ url: ORIGIN + '/ny/new-york' }];
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/ny\/new-york\/[^/]+$/);
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'");

export const APARTMENTLIST_LIVE = {
  ...SOURCE,
  id: 'apartmentlist-live',
  marketplace: SOURCE.id,
  coverage: 'NYC first search page; individually identified units marked available now',
  regions: ['nyc'],
  minPages: 1,
  maxPages: 1,
  rowsPerPage: 150,
  listingUrl,
  load: (fetcher: FetchTransport, now: Date) => loadPublicPages(SOURCE, PAGES, parseApartmentListPage, fetcher, now),
};

type ApartmentListUnit = {
  unit_rental_id?: unknown;
  unitTitle?: string;
  unitType?: string;
  availableNow?: unknown;
  price?: unknown;
  isTotalPrice?: unknown;
};

export function parseApartmentListPage(html: string, _market: unknown, checkedAt: string) {
  const flight = [...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)]
    .map((match) => {
      const chunk = JSON.parse(match[1]);
      return Array.isArray(chunk) && typeof chunk[1] === 'string' ? chunk[1] : '';
    })
    .join('');
  const properties = new Map<string, { slug: string }>();
  const units = new Map<string, ApartmentListUnit[]>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if (isRecord(value)) {
      const { rental_id: rentalId, slug, status, data } = value;
      if (typeof rentalId === 'string' && typeof slug === 'string') properties.set(rentalId, { slug });
      if (status === 'success' && isRecord(data)) {
        for (const [id, rows] of Object.entries(data)) {
          // Unit rows carry these fields; normalizeListing checks each one it keeps.
          if (Array.isArray(rows) && rows.some((row) => isRecord(row) && row.unit_rental_id))
            units.set(id, rows.filter(isRecord) as ApartmentListUnit[]);
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  for (const line of flight.split('\n')) {
    const content = line.slice(line.indexOf(':') + 1);
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      continue;
    }
    visit(value);
  }
  if (!properties.size || !units.size) throw new Error('Apartment List did not return a recognized rental page.');
  return [...properties].flatMap(([id, property]) => {
    const url = listingUrl(property.slug);
    if (!url) return [];
    const escaped = property.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const card = html.match(new RegExp('href=["\\\']' + escaped + '["\\\'][\\s\\S]*?<address\\b[^>]*>([\\s\\S]*?)<\\/address>'));
    const address = card && plain(card[1]).match(/^(.+),\s*[^,]+,\s*NY\s+(\d{5})$/);
    const city = nycBorough(address?.[2] ?? '');
    if (!address || !city) return [];
    return (units.get(id) ?? []).flatMap((unit) => {
      const number = unit.unitTitle?.match(/^Unit\s+([\w-]+)$/)?.[1];
      const beds = unit.unitType === 'Studio' ? 0 : Number(unit.unitType?.match(/^(\d+) Beds?$/)?.[1]);
      if (unit.availableNow !== true || !number || !Number.isInteger(beds) || !Number.isFinite(unit.price)) return [];
      const listing = normalizeListing(
        {
          id: unit.unit_rental_id,
          url,
          address: address[1],
          unit: number,
          city,
          state: 'NY',
          region: 'nyc',
          zipCode: address[2],
          bedrooms: beds,
          rent: unit.price,
          status: 'Active',
          updatedAt: checkedAt,
        },
        SOURCE,
      );
      return listing ? [{ ...listing, priceIncludesFees: unit.isTotalPrice === true }] : [];
    });
  });
}
