import type { FetchTransport } from '../../src/fetch-type.ts';
import { isRecord } from '../../src/domain.ts';
import { normalizeListing } from '../../src/listings.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'zillow', name: 'Zillow', kind: 'feed' };
const ORIGIN = 'https://www.zillow.com';
const MARKETS = [
  ['jersey-city-nj', 'Jersey City', 'NJ', 'nj'],
  ['newark-nj', 'Newark', 'NJ', 'nj'],
  ['hicksville-ny', 'Hicksville', 'NY', 'li'],
  ['mineola-ny', 'Mineola', 'NY', 'li'],
  ['yonkers-ny', 'Yonkers', 'NY', 'metroNorth'],
  ['white-plains-ny', 'White Plains', 'NY', 'metroNorth'],
  ['stamford-ct', 'Stamford', 'CT', 'ct'],
  ['norwalk-ct', 'Norwalk', 'CT', 'ct'],
].map(([path, city, state, region]) => ({ url: ORIGIN + '/' + path + '/cheap-apartments/', city, state, region }));
const APARTMENTS = new Set(['APARTMENT', 'CONDO', 'COOP', 'CO_OP']);
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/homedetails\/[^/]+\/\d+_zpid\/?$/);

export const ZILLOW_LIVE = {
  ...SOURCE,
  id: 'zillow-live',
  marketplace: SOURCE.id,
  coverage: 'selected NJ, Long Island, Westchester and Connecticut cities',
  regions: ['nj', 'li', 'metroNorth', 'ct'],
  minPages: MARKETS.length,
  maxPages: MARKETS.length,
  rowsPerPage: 60,
  listingUrl,
  load: (fetcher: FetchTransport, now: Date) => loadPublicPages(SOURCE, MARKETS, parseZillowPage, fetcher, now),
};

/** A Zillow search result as this parser reads it; normalizeListing checks every field it keeps. */
type ZillowRow = {
  zpid?: unknown;
  detailUrl?: unknown;
  statusType?: unknown;
  statusText?: string;
  isBuilding?: unknown;
  isUndisclosedAddress?: unknown;
  addressStreet?: unknown;
  addressCity?: string;
  addressState?: unknown;
  addressZipcode?: string;
  beds?: unknown;
  unformattedPrice?: unknown;
  brokerName?: unknown;
  listPriceIncludesRequiredMonthlyFees?: unknown;
  latLong?: { latitude?: unknown; longitude?: unknown };
  hdpData?: { homeInfo?: { homeType?: string; zpid?: unknown } };
};
type ZillowPage = { props?: { pageProps?: { searchPageState?: { cat1?: { searchResults?: { listResults?: unknown } } } } } } | null;

export function parseZillowPage(html: string, market: { city: string; state: string; region: string }, checkedAt: string) {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  const rows = script ? (JSON.parse(script[1]) as ZillowPage)?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults : null;
  if (!Array.isArray(rows)) throw new Error('Zillow did not return a recognized rental page.');
  return (rows.filter(isRecord) as ZillowRow[]).flatMap((row) => {
    const home = row.hdpData?.homeInfo;
    const url = listingUrl(row.detailUrl);
    const { latitude, longitude } = row.latLong ?? {};
    if (
      !url ||
      row.statusType !== 'FOR_RENT' ||
      row.isBuilding ||
      row.isUndisclosedAddress ||
      !APARTMENTS.has(home?.homeType ?? '') ||
      /room for rent|shared housing/i.test(row.statusText ?? '') ||
      row.addressState !== market.state ||
      row.addressCity?.toLowerCase() !== market.city.toLowerCase() ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !/^\d{5}$/.test(row.addressZipcode ?? '')
    )
      return [];

    const listing = normalizeListing(
      {
        id: String(row.zpid ?? home?.zpid ?? ''),
        url,
        address: row.addressStreet,
        city: market.city,
        state: market.state,
        region: market.region,
        zipCode: row.addressZipcode,
        latitude,
        longitude,
        bedrooms: row.beds,
        rent: row.unformattedPrice,
        company: row.brokerName,
        status: 'Active',
        updatedAt: checkedAt,
      },
      SOURCE,
    );
    return listing ? [{ ...listing, priceIncludesFees: row.listPriceIncludesRequiredMonthlyFees === true }] : [];
  });
}
