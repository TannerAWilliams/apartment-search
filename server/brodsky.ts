/**
 * Brodsky: every available apartment in The Brodsky Organization's Manhattan and Brooklyn buildings, from
 * the landlord's own rentals page. The page embeds the whole list (it has no pages), and each building's
 * page gives its street address. Brodsky publishes no separate total, so the check is that every listing
 * is fully described and every building's address is read; otherwise nothing is saved. Its /api/ is
 * disallowed by robots.txt and is not used.
 */
import { isRecord } from '../src/domain.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { fetchPublicHtml } from './public-rentals.ts';

const SOURCE = { id: 'brodsky', name: 'Brodsky', kind: 'feed' };
const ORIGIN = 'https://www.brodsky.com';
export const BRODSKY_TRANSPORT = 'brodsky-rentals-page';
const SLUG = /^[a-z0-9-]{1,80}$/;

export function brodskyListingUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, ORIGIN);
    const parts = url.pathname.split('/').filter(Boolean);
    return url.origin === ORIGIN && parts.length === 4 && parts[0] === 'rentals' && parts.slice(1).every((part) => SLUG.test(part))
      ? ORIGIN + url.pathname
      : null;
  } catch {
    return null;
  }
}

/** The text of a Next.js page's embedded data (its flight chunks). */
function flightText(html: string) {
  return [...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)]
    .map((match) => {
      const chunk: unknown = JSON.parse(match[1]);
      return Array.isArray(chunk) && typeof chunk[1] === 'string' ? chunk[1] : '';
    })
    .join('');
}

/** The JSON object starting at `start`, read up to its closing brace, minding braces inside strings. */
function objectAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error('Brodsky returned a rentals page that ended early.');
}

export type BrodskyUnit = {
  uid: string;
  propertyUid: string;
  neighborhoodUid: string;
  url: string;
  apartmentName: string;
  beds: number;
  baths: number;
  minimumRent: number;
  zipCode: string;
  latitude: number;
  longitude: number;
  marketingPrice?: string;
};

/** The apartments embedded in the rentals page. Throws when it holds none or one is not fully described. */
export function parseBrodskyRentals(html: string): BrodskyUnit[] {
  const flight = flightText(html);
  const units = new Map<string, BrodskyUnit>();
  for (const match of flight.matchAll(/\{"uid":"[^"]+","propertyUid":/g)) {
    const unit = objectAt(flight, match.index);
    if (
      !isRecord(unit) ||
      typeof unit.uid !== 'string' ||
      typeof unit.propertyUid !== 'string' ||
      typeof unit.neighborhoodUid !== 'string' ||
      !SLUG.test(unit.propertyUid) ||
      !SLUG.test(unit.neighborhoodUid) ||
      typeof unit.url !== 'string' ||
      typeof unit.apartmentName !== 'string' ||
      !Number.isInteger(unit.beds) ||
      !Number.isFinite(unit.minimumRent) ||
      typeof unit.zipCode !== 'string'
    ) {
      throw new Error('Brodsky listed an apartment it did not fully describe.');
    }
    // Checked field by field above; the rest are optional numbers read by normalizeListing.
    units.set(unit.uid, unit as BrodskyUnit);
  }
  if (!units.size) throw new Error('Brodsky did not return a recognized rentals page.');
  return [...units.values()];
}

/** A building page's street address and city, from its structured data. */
export function parseBrodskyBuilding(html: string) {
  const address = html.match(/"streetAddress"\s*:\s*"([^"]{3,80})"/)?.[1];
  const city = html.match(/"addressLocality"\s*:\s*"([^"]{3,40})"/)?.[1];
  if (!address || !city) throw new Error('Brodsky did not give a building’s address.');
  return { address, city: city === 'New York' ? 'Manhattan' : city };
}

export async function loadBrodsky(fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const units = parseBrodskyRentals(await fetchPublicHtml(fetcher, ORIGIN + '/rentals', 'Brodsky', 15_000));
  const buildings = new Map<string, { address: string; city: string }>();
  // One building page at a time, as a person would browse them.
  for (const unit of units) {
    if (buildings.has(unit.propertyUid)) continue;
    const page = await fetchPublicHtml(fetcher, `${ORIGIN}/rentals/${unit.neighborhoodUid}/${unit.propertyUid}`, 'Brodsky', 15_000);
    buildings.set(unit.propertyUid, parseBrodskyBuilding(page));
  }
  const listings = units
    .map((unit) => {
      const building = buildings.get(unit.propertyUid)!;
      return normalizeListing(
        {
          id: unit.uid,
          url: brodskyListingUrl(unit.url),
          address: building.address,
          unit: unit.apartmentName,
          city: building.city,
          state: 'NY',
          region: 'nyc',
          zipCode: unit.zipCode,
          latitude: unit.latitude,
          longitude: unit.longitude,
          bedrooms: unit.beds,
          bathrooms: unit.baths,
          rent: unit.minimumRent,
          company: 'Brodsky',
          status: 'Active',
          updatedAt: checkedAt,
        },
        SOURCE,
      );
    })
    .filter((listing) => listing !== null);
  return { listings, pages: 1 + buildings.size, total: units.length, rawCount: units.length, transport: BRODSKY_TRANSPORT, checkedAt };
}

export const BRODSKY_LIVE = {
  ...SOURCE,
  id: 'brodsky-live',
  marketplace: SOURCE.id,
  coverage: 'every apartment on The Brodsky Organization’s own rentals page (it lists all of them on one page and gives no separate total)',
  regions: ['nyc'],
  minPages: 2,
  maxPages: 80,
  rowsPerPage: 40,
  listingUrl: brodskyListingUrl,
  load: loadBrodsky,
};
