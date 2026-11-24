/**
 * TF Cornerstone: every listed apartment in its New York City buildings, from the data file tfc.com's own pages
 * load (cdn.tfc.com/tfc-com/initial-data.json; no key, and neither tfc.com nor its data hosts disallow it). The
 * file holds every building and unit in one page. Rent is the gross monthly rent the tenant pays; the "net
 * effective" price the site advertises (with free months spread over the lease) is not used.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'tfc', name: 'TF Cornerstone', kind: 'feed' };
const ORIGIN = 'https://tfc.com';
const FEED = 'https://cdn.tfc.com/tfc-com/initial-data.json';
const MAX_FEED_BYTES = 12 * 1024 * 1024;

export function tfcListingUrl(value: unknown) {
  return publicListingUrl(value, ORIGIN, /^\/[a-z0-9-]{1,80}-apartments\/[a-z0-9-]{1,80}\/apt-[A-Za-z0-9-]{1,20}$/);
}

async function readFeed(fetcher: FetchTransport): Promise<unknown> {
  const response = await fetcher(FEED, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.headers.get('cf-mitigated') === 'challenge') {
    throw Object.assign(new Error('TF Cornerstone answered with a browser verification challenge (bot protection).'), {
      code: 'bot_challenge',
    });
  }
  if (!response.ok) throw new Error('TF Cornerstone returned HTTP ' + response.status + '.');
  if (Number(response.headers.get('content-length')) > MAX_FEED_BYTES)
    throw new Error('TF Cornerstone returned a listings file that was too large.');
  const text = await response.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('TF Cornerstone returned a listings file that was too large.');
  return JSON.parse(text);
}

const rows = (group: unknown) => (isRecord(group) && Array.isArray(group.Data) ? group.Data.filter(isRecord) : null);

/** The file's listed apartments as listings. Throws when the file is not the buildings-and-units file. */
export function parseTfcFeed(feed: unknown, checkedAt: string) {
  const properties = isRecord(feed) ? rows(feed.Properties) : null;
  const units = isRecord(feed) ? rows(feed.Units) : null;
  if (!properties?.length || !units) throw new Error('TF Cornerstone did not return a recognized listings file.');
  const buildings = new Map(properties.map((property) => [property.MarketingPropertyCode, property]));
  return units.flatMap((unit) => {
    const building = buildings.get(unit.MarketingPropertyCode);
    const zip = typeof building?.Zip === 'string' ? building.Zip : '';
    const city = nycBorough(zip);
    const url = tfcListingUrl(unit.WebUrl);
    // The gross rent is what the tenant pays each month; Price is the advertised net effective rent.
    const rent = typeof unit.GrossRent === 'number' && unit.GrossRent > 0 ? unit.GrossRent : unit.Price;
    if (unit.IsListed !== true || !building || !city || !url || typeof unit.Apartment !== 'string' || typeof building.Address !== 'string')
      return [];
    const listing = normalizeListing(
      {
        id: unit.Code,
        url,
        address: building.Address,
        unit: unit.Apartment,
        city,
        state: 'NY',
        region: 'nyc',
        zipCode: zip,
        neighborhood: unit.Neighborhood,
        latitude: building.Latitude,
        longitude: building.Longitude,
        bedrooms: unit.NumBedrooms,
        bathrooms: unit.NumBathrooms,
        rent,
        company: 'TF Cornerstone',
        status: 'Active',
        updatedAt: checkedAt,
      },
      SOURCE,
    );
    return listing && Number.isInteger(listing.bedrooms) && listing.bedrooms <= 4 ? [listing] : [];
  });
}

export async function loadTfc(fetcher: FetchTransport, now: Date) {
  const listings = parseTfcFeed(await readFeed(fetcher), now.toISOString());
  if (!listings.length) throw new Error('TF Cornerstone returned no supported apartment listings.');
  return { listings, pages: 1 };
}

export const TFC_LIVE = {
  ...SOURCE,
  id: 'tfc-live',
  marketplace: SOURCE.id,
  coverage: 'every listed apartment in TF Cornerstone’s New York City buildings, at its gross monthly rent',
  regions: ['nyc'],
  minPages: 1,
  maxPages: 1,
  rowsPerPage: 1000,
  listingUrl: tfcListingUrl,
  load: loadTfc,
};
