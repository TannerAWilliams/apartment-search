import type { FetchTransport } from '../src/fetch-type.ts';
import type { ListingData } from '../src/domain.ts';
import { normalizeListing } from '../src/listings.ts';
import { NJ_ZIPS, nycBorough } from './firstmover.ts';
import { assignedJson, fetchPublicHtml, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'cityrealty', name: 'CityRealty', kind: 'feed', maxBedrooms: 20, maxRent: 200_000 };
const ORIGIN = 'https://www.cityrealty.com';
const SEARCH = ORIGIN + '/rpc/search/get-rental-listings';
const ROWS_PER_PAGE = 52;
const MAX_PAGES = 100;
export const CITYREALTY_ID = 'cityrealty-live';
export const CITYREALTY_TRANSPORT = 'complete-cityrealty-search';
export const CITYREALTY_COVERAGE = 'All active rentals returned by CityRealty’s public rental search';
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/nyc\/[\w-]+\/[\w-]+\/\d+\/[\w.-]+\/[A-Za-z0-9]+$/);

export const CITYREALTY_LIVE = {
  ...SOURCE, id: CITYREALTY_ID, marketplace: SOURCE.id, coverage: CITYREALTY_COVERAGE,
  regions: ['nyc', 'nj'], minPages: 1, maxPages: MAX_PAGES, rowsPerPage: ROWS_PER_PAGE, load: loadCityRealty, listingUrl,
};

type Candidate = {
  id: string;
  url: string;
  mask: string;
  address: string;
  unit: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
};

function parseListing(html: string, candidate: Candidate, checkedAt: string) {
  const details = assignedJson(html, /window\.dataLayer\.push\(\s*(?=\{"utype":[^\r\n]*?"ptype":"listing")/);
  const zip = Number.isInteger(details?.lzip) ? String(details.lzip).padStart(5, '0') : '';
  const state = details?.lzone === 'new jersey' ? 'NJ' : 'NY';
  const [city, county] = state === 'NJ' ? NJ_ZIPS[zip] ?? [] : [nycBorough(zip), undefined];
  const providerAddress = typeof details?.laddress === 'string' ? details.laddress.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  const street = candidate.address.replace(/\s+/g, ' ').toLowerCase();
  if (details?.lid !== candidate.mask || details?.ltype !== 'rent' || details?.lstatus !== 'active' ||
      !city || (providerAddress !== street && !providerAddress.endsWith(', ' + street)) ||
      !Number.isInteger(details.lbeds) || !Number.isFinite(details.lprice)) {
    throw new Error(`CityRealty could not verify active listing ${candidate.id} and its address. The saved inventory was kept.`);
  }

  const listing = normalizeListing({
    ...candidate, status: 'Active', city, county, state, zip,
    bedrooms: details.lbeds, bathrooms: details.lbaths, rent: details.lprice,
    updatedAt: checkedAt,
  }, SOURCE);
  if (!listing) throw new Error('CityRealty returned a listing outside the supported inventory format.');
  return listing;
}

async function searchPage(fetcher: FetchTransport, page: number) {
  const url = page === 1 ? SEARCH : SEARCH + '?page=' + page;
  const response = await fetcher(url, {
    headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('CityRealty returned HTTP ' + response.status + '.');
  if (!response.headers.get('content-type')?.includes('application/json') ||
      Number(response.headers.get('content-length')) > 10 * 1024 * 1024) {
    await response.body?.cancel();
    throw new Error('CityRealty did not return recognizable rental search results.');
  }
  const payload = await response.json();
  const { total, currentPage, rowsPerPage } = payload?.tableTools?.pagination ?? {};
  const rows = payload?.items;
  if (Number(currentPage) !== page || rowsPerPage !== ROWS_PER_PAGE || !Number.isSafeInteger(total) ||
      total < 0 || total > MAX_PAGES * ROWS_PER_PAGE || !Array.isArray(rows) ||
      rows.length !== Math.min(ROWS_PER_PAGE, Math.max(0, total - (page - 1) * ROWS_PER_PAGE))) {
    throw new Error('CityRealty rental search returned an unexpected page or result count.');
  }
  return { rows, total };
}

export async function loadCityRealty(fetcher: FetchTransport, now: Date) {
  const first = await searchPage(fetcher, 1);
  const { total } = first;
  const pages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  const seen = new Set<number>();
  const candidates: Candidate[] = [];
  const collect = ({ rows, total: pageTotal }: Awaited<ReturnType<typeof searchPage>>) => {
    if (pageTotal !== total) throw new Error('CityRealty inventory changed while reading search pages. Please try again.');
    for (const row of rows) {
      const id = row?.listing_id;
      if (!Number.isSafeInteger(id) || seen.has(id)) {
        throw new Error('CityRealty returned a missing or repeated listing ID across search pages.');
      }
      seen.add(id);
      if (row.active === false || row.rented === true || row.out_of_market === true ||
          row.in_contract === true || row.isPublic === false) continue;
      const url = listingUrl(row.url_listing);
      const address = typeof row.building_address === 'string' ? row.building_address.trim() : '';
      if (!url || typeof row.mask_id !== 'string' || !url.endsWith('/' + row.mask_id) || !/^\d/.test(address) ||
          row.active !== true || row.rented !== false || row.out_of_market !== false ||
          row.sale_or_rent !== 2 || row.isPublic !== true) {
        throw new Error('CityRealty returned an active search result without verifiable listing details.');
      }
      candidates.push({ id: String(id), url, mask: row.mask_id, address,
        unit: typeof row.unit === 'string' ? row.unit : '',
        neighborhood: typeof row.hood === 'string' ? row.hood : '',
        latitude: row.lat, longitude: row.lng });
    }
  };
  collect(first);
  for (let page = 2; page <= pages; page += 4) {
    const batch = Array.from({ length: Math.min(4, pages - page + 1) }, (_, index) => page + index);
    (await Promise.all(batch.map(number => searchPage(fetcher, number)))).forEach(collect);
  }
  if (seen.size !== total) throw new Error('CityRealty returned fewer unique listings than its search count.');

  const listings: ListingData[] = [];
  const checkedAt = now.toISOString();
  for (let index = 0; index < candidates.length; index += 5) {
    const verified = await Promise.all(candidates.slice(index, index + 5).map(async candidate =>
      parseListing(await fetchPublicHtml(fetcher, candidate.url, SOURCE.name), candidate, checkedAt)));
    listings.push(...verified);
  }
  return { listings, pages, total, rawCount: seen.size, transport: CITYREALTY_TRANSPORT };
}
