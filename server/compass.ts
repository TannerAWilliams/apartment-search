import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'compass', name: 'Compass', kind: 'feed' };
const ORIGIN = 'https://www.compass.com';
const PAGES = [
  ['new-york-ny', 'New York', 'NY', 'nyc'],
  ['white-plains-ny', 'White Plains', 'NY', 'metroNorth'],
  ['stamford-ct', 'Stamford', 'CT', 'ct'],
].map(([path, city, state, region]) => ({ url: ORIGIN + '/for-rent/' + path + '/', city, state, region }));
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/homedetails\/[^/]+\/\d+_lid\/?$/);

export const COMPASS_LIVE = {
  ...SOURCE, id: 'compass-live', marketplace: SOURCE.id, coverage: 'NYC, White Plains and Stamford',
  regions: ['nyc', 'metroNorth', 'ct'], minPages: PAGES.length, maxPages: PAGES.length, rowsPerPage: 60,
  listingUrl, load: (fetcher: FetchTransport, now: Date) => loadPublicPages(SOURCE, PAGES, parseCompassPage, fetcher, now),
};

export function parseCompassPage(html: string, market: {city:string; state:string; region:string}, checkedAt: string) {
  const state = html.match(/<script\b[^>]*>\s*\(function \(global\) \{global\.uc=(\{[\s\S]*?\});\}\)\(this\);<\/script>/i);
  const rows = state && JSON.parse(state[1])?.sharedReactAppProps?.initialResults?.lolResults?.data;
  if (!Array.isArray(rows)) throw new Error('Compass did not return a recognized rental page.');
  return rows.flatMap(({ listing: row }) => {
    const url = listingUrl(row?.pageLink);
    const title = row?.subtitles?.[0];
    const location = url?.match(/-([A-Z]{2})-(\d{5})\/(\d+)_lid\/?$/);
    const fullAddress = title?.match(/^(.+), ([^,]+), ([A-Z]{2}) (\d{5})$/);
    const address = (fullAddress?.[1] ?? title)?.match(/^(\d.+?)(?:,\s*Unit\s+|\s+#\s*)([^#,]+)$/i);
    const city = market.region === 'nyc' ? nycBorough(location?.[2] ?? '') : fullAddress?.[2];
    const badges = row?.badges?.cornerBadges ?? [];
    if (!url || !address || !city || !location || location?.[1] !== market.state ||
        (market.region !== 'nyc' && city.toLowerCase() !== market.city.toLowerCase()) || row.status !== 0 ||
        badges.some(({ displayText }: { displayText: string }) => /coming soon|application pending|rented/i.test(displayText))) return [];

    const { latitude, longitude } = row.location ?? {};
    const rent = row.title?.match(/^\$([\d,]+)$/)?.[1];
    const beds = row.subStats?.find(({ titleLabel }: { titleLabel: string }) => titleLabel === 'Bedrooms')?.subtitle;
    if (!rent || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const courtesy = row.footer?.find(({ data }: { data?: { text?: { content?: string } } }) => data?.text?.content?.startsWith('Listing Courtesy of '))?.data.text.content;
    const company = badges.some(({ displayText }: { displayText: string }) => displayText === 'Listed By Compass') ? 'Compass' :
      courtesy?.slice('Listing Courtesy of '.length);
    const listing = normalizeListing({
      id: location[3], url, address: address[1], unit: address[2].trim(), city, state: market.state,
      region: market.region, zipCode: location[2], latitude, longitude,
      neighborhood: market.region === 'nyc' ? row.subtitles[1] : '', bedrooms: beds === 'Studio' ? 0 : beds,
      rent: Number(rent.replaceAll(',', '')), company, status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}
