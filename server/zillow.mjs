import { normalizeListing } from '../src/listings.mjs';
import { loadPublicPages, publicListingUrl } from './public-rentals.mjs';

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
const listingUrl = (url) => publicListingUrl(url, ORIGIN, /^\/homedetails\/[^/]+\/\d+_zpid\/?$/);

export const ZILLOW_LIVE = {
  ...SOURCE, id: 'zillow-live', marketplace: SOURCE.id, coverage: 'selected NJ, Long Island, Westchester and Connecticut cities',
  regions: ['nj', 'li', 'metroNorth', 'ct'], minPages: MARKETS.length, maxPages: MARKETS.length, rowsPerPage: 60,
  listingUrl, load: (fetcher, now) => loadPublicPages(SOURCE, MARKETS, parseZillowPage, fetcher, now),
};

export function parseZillowPage(html, market, checkedAt) {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  const rows = script && JSON.parse(script[1])?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults;
  if (!Array.isArray(rows)) throw new Error('Zillow did not return a recognized rental page.');
  return rows.flatMap((row) => {
    const home = row?.hdpData?.homeInfo;
    const url = listingUrl(row?.detailUrl);
    const { latitude, longitude } = row?.latLong ?? {};
    if (!url || row.statusType !== 'FOR_RENT' || row.isBuilding || row.isUndisclosedAddress ||
        !APARTMENTS.has(home?.homeType) || /room for rent|shared housing/i.test(row.statusText ?? '') ||
        row.addressState !== market.state || row.addressCity?.toLowerCase() !== market.city.toLowerCase() ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^\d{5}$/.test(row.addressZipcode)) return [];

    const listing = normalizeListing({
      id: String(row.zpid ?? home.zpid ?? ''), url, address: row.addressStreet, city: market.city, state: market.state,
      region: market.region, zipCode: row.addressZipcode, latitude, longitude, bedrooms: row.beds,
      rent: row.unformattedPrice, company: row.brokerName, status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [{ ...listing, priceIncludesFees: row.listPriceIncludesRequiredMonthlyFees === true }] : [];
  });
}
