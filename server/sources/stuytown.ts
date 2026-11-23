/**
 * StuyTown (Stuyvesant Town and Peter Cooper Village): every available apartment, from the landlord's own
 * listings feed, the one stuytown.com's search page reads. Its count endpoint gives the total, and a check
 * is saved only when every apartment in it was read.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';

const SOURCE = { id: 'stuytown', name: 'StuyTown', kind: 'feed' };
const ORIGIN = 'https://www.stuytown.com';
const API = 'https://units.stuytown.com/api/units';
const PROPERTIES = 'Stuyvesant Town_Peter Cooper Village';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
/** USPS ZIP codes of the two properties, which the feed leaves out. */
const ZIP_BY_PROPERTY: Record<string, string> = { 'Stuyvesant Town': '10009', 'Peter Cooper Village': '10010' };
export const STUYTOWN_TRANSPORT = 'stuytown-units-api';

/** A unit's page on stuytown.com, the link each listing opens. */
export function stuyTownListingUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const unit = url.searchParams.get('unitSpk');
    return url.origin === ORIGIN && url.pathname === '/nyc-apartments-for-rent/unit' && unit && /^[\w~-]{1,80}$/.test(unit)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function readJson(fetcher: FetchTransport, url: string): Promise<unknown> {
  const response = await fetcher(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Object.assign(new Error('StuyTown returned HTTP ' + response.status + '.'), { httpStatus: response.status });
  return response.json();
}

const query = (params: Record<string, string>) => new URLSearchParams({ Order: 'low-price', PropertyName: PROPERTIES, ...params });

/** One unit from the feed as a listing, or null when it is not an available, fully described apartment. */
export function stuyTownListing(unit: unknown, checkedAt: string) {
  if (!isRecord(unit) || unit.isAvailable !== true || typeof unit.unitSpk !== 'string') return null;
  const building = isRecord(unit.building) ? unit.building : {};
  const property = isRecord(unit.property) && typeof unit.property.name === 'string' ? unit.property.name : '';
  const zip = ZIP_BY_PROPERTY[property];
  if (!zip || typeof building.address !== 'string') return null;
  const url = stuyTownListingUrl(`${ORIGIN}/nyc-apartments-for-rent/unit?unitSpk=${encodeURIComponent(unit.unitSpk)}`);
  const listing = normalizeListing(
    {
      id: unit.unitSpk,
      url,
      address: building.address.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
      unit: unit.unitNumber,
      city: 'Manhattan',
      state: 'NY',
      region: 'nyc',
      zipCode: zip,
      neighborhood: property,
      latitude: building.latitude,
      longitude: building.longitude,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      squareFeet: unit.sqft,
      rent: unit.price,
      company: 'StuyTown',
      status: 'Active',
      updatedAt: checkedAt,
    },
    SOURCE,
  );
  return listing && url ? listing : null;
}

/** Every available apartment. Throws unless the units read add up to the total the feed reports. */
export async function loadStuyTown(fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const total = Number(await readJson(fetcher, `${API}/units-filter/count?${query({ itemsOnPage: '10000' })}`));
  if (!Number.isSafeInteger(total) || total < 0 || total > PAGE_SIZE * MAX_PAGES)
    throw new Error('StuyTown did not report a usable apartment count.');
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const units = new Map<string, unknown>();
  for (let page = 0; page < pages; page++) {
    const data = await readJson(fetcher, `${API}?${query({ page: String(page), itemsOnPage: String(PAGE_SIZE) })}`);
    const rows = isRecord(data) && Array.isArray(data.unitModels) ? data.unitModels : null;
    if (!rows) throw new Error('StuyTown did not return a recognized apartment list.');
    for (const row of rows) if (isRecord(row) && typeof row.unitSpk === 'string') units.set(row.unitSpk, row);
  }
  if (units.size !== total) throw new Error(`StuyTown listed ${units.size} of the ${total} apartments it reported.`);
  const listings = [...units.values()].map((unit) => stuyTownListing(unit, checkedAt)).filter((listing) => listing !== null);
  return { listings, pages, total, rawCount: units.size, transport: STUYTOWN_TRANSPORT, checkedAt };
}

export const STUYTOWN_LIVE = {
  ...SOURCE,
  id: 'stuytown-live',
  marketplace: SOURCE.id,
  coverage: 'every available apartment in Stuyvesant Town and Peter Cooper Village, from the landlord’s own listings',
  regions: ['nyc'],
  minPages: 1,
  maxPages: MAX_PAGES,
  rowsPerPage: PAGE_SIZE,
  listingUrl: stuyTownListingUrl,
  load: loadStuyTown,
};
