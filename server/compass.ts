import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { assignedJson, loadPublicPages, publicListingUrl } from './public-rentals.ts';

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

/** The listing card data Compass embeds in its search page, as far as this parser reads it. Anything else fails the page. */
type CompassRow = {
  pageLink?: string; subtitles?: string[]; status?: number; title?: string;
  badges?: { cornerBadges?: { displayText: string }[] }; location?: { latitude?: number; longitude?: number };
  subStats?: { titleLabel: string; subtitle?: string | number }[]; footer?: { data?: { text?: { content?: string } } }[];
};
type CompassPage = { sharedReactAppProps?: { initialResults?: { lolResults?: { data?: { listing?: CompassRow }[] } } } };

export function parseCompassPage(html: string, market: {city:string; state:string; region:string}, checkedAt: string) {
  const state = assignedJson(html, /\bglobal\.uc\s*=\s*(?=\{)/) as CompassPage | null;
  const rows = state?.sharedReactAppProps?.initialResults?.lolResults?.data;
  if (!Array.isArray(rows)) return parseRenderedRentals(html, market, checkedAt);
  return rows.flatMap(({ listing: row }) => {
    if (!row) return [];
    const url = listingUrl(row.pageLink);
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
    const courtesy = row.footer?.find(({ data }: { data?: { text?: { content?: string } } }) => data?.text?.content?.startsWith('Listing Courtesy of '))?.data?.text?.content;
    const company = badges.some(({ displayText }: { displayText: string }) => displayText === 'Listed By Compass') ? 'Compass' :
      courtesy?.slice('Listing Courtesy of '.length);
    const listing = normalizeListing({
      id: location[3], url, address: address[1], unit: address[2].trim(), city, state: market.state,
      region: market.region, zipCode: location[2], latitude, longitude,
      neighborhood: market.region === 'nyc' ? row.subtitles?.[1] ?? '' : '', bedrooms: beds === 'Studio' ? 0 : beds,
      rent: Number(rent.replaceAll(',', '')), company, status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}

function parseRenderedRentals(html: string, market: {city:string; state:string; region:string}, checkedAt: string) {
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1];
  const expected = PAGES.find((page) => page.city === market.city && page.state === market.state && page.region === market.region);
  const cards = html.split('data-testid="cx-react-listingCard"').slice(1);
  if (!canonical || canonical !== expected?.url || !cards.length) {
    throw new Error('Compass did not return a recognized rental page.');
  }
  const text = (value: string) => value.replace(/<[^>]*>/g, '').replace(/&(?:amp|#x27|#39|quot);/g,
    (entity) => entity === '&amp;' ? '&' : entity === '&quot;' ? '"' : "'").trim();

  return cards.flatMap((card) => {
    const anchor = card.match(/<a\s+data-testid="cx-react-listingCard-subtitlesAnchor"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const url = listingUrl(anchor?.[1]);
    const location = url?.match(/-([A-Z]{2})-(\d{5})\/(\d+)_lid\/?$/);
    const subtitles = [...(anchor?.[2] ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(([, value]) => text(value));
    const fullAddress = subtitles[0]?.match(/^(.+), ([^,]+), ([A-Z]{2}) (\d{5})$/);
    const address = (fullAddress?.[1] ?? subtitles[0])?.match(/^(\d.+?)(?:,\s*Unit\s+|\s+#\s*)([^#,]+)$/i);
    const city = market.region === 'nyc' ? nycBorough(location?.[2] ?? '') : fullAddress?.[2];
    const badges = [...card.matchAll(/<span\b[^>]*class="[^"]*\bcx-react-listingBadge\b[^"]*"[^>]*>([^<]*)<\/span>/g)]
      .map(([, value]) => text(value));
    if (!url || !location || location[1] !== market.state || !city || !address ||
        (market.region !== 'nyc' && city.toLowerCase() !== market.city.toLowerCase()) ||
        badges.some((badge) => /coming soon|pending|in contract|rented|off.market|sold|unavailable/i.test(badge))) return [];

    const rent = card.match(/data-testid="cx-react-listingCard-title">\$([\d,]+)<\//)?.[1];
    const beds = card.match(/<dd\b[^>]*><span class="cx-screenReaderOnly">(\d+|Studio)<\/span>[^]*?<\/dd><dt\b[^>]*><span class="cx-screenReaderOnly">Bedrooms<\/span>/i)?.[1];
    if (!rent || !beds) return [];

    const listing = normalizeListing({
      id: location[3], url, address: address[1], unit: address[2], city, state: market.state,
      region: market.region, zipCode: location[2], neighborhood: market.region === 'nyc' ? subtitles[1] : '',
      bedrooms: /^Studio$/i.test(beds) ? 0 : Number(beds), rent: Number(rent.replaceAll(',', '')),
      company: badges.find((badge) => badge.startsWith('Listed By '))?.slice('Listed By '.length),
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}
