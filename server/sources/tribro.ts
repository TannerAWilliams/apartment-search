/**
 * TriBro NYC: the rentals on its own site (tribronyc.com), which runs on RealtyMX like REAL New York's and Bond
 * New York's and is read the same way (see realny.ts): the site's rentals search, 500 cards a page, one page at a
 * time, with ZIP codes from the U.S. Census geocoder. robots.txt disallows only /images/ and /admin.
 *
 * TriBro's search uses RealtyMX's "featured" card template, read here. Cards give no posting date. Cards that
 * hide the building number (about half) cannot be placed and are left out, as are apartments with an
 * application pending. Where a card advertises a net effective rent ("NER") with its concession ("1 Month Free
 * w/12 Month Lease"), the monthly rent kept is the gross one the tenant pays: the net effective rent times the
 * lease's months over the months paid.
 */
import type { FetchTransport } from '../../src/fetch-type.ts';
import { publicListingUrl } from './public-rentals.ts';
import { decodeRealtyMx, loadRealtyMx, REALTYMX_HOMES, type RealtyMxCard, type RealtyMxSite, realtyMxAddress } from './realny.ts';

const SOURCE = { id: 'tribro', name: 'TriBro NYC', kind: 'feed' };
const ORIGIN = 'https://tribronyc.com';
export const tribroListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, /^\/[a-z0-9-]+\/[a-z-]+-for-rent\/[a-z0-9-]+\/\d+$/);

/** The gross monthly rent behind a net effective one, from the card's concession; null when it states none it can read. */
export function grossRent(netEffective: number, concession: string) {
  const [, free, lease] = concession.match(/^([\d.]+) Months? Free w\/(\d+) Month Lease$/i) ?? [];
  const months = Number(lease);
  const paid = months - Number(free);
  return paid > 0 && paid < months ? Math.round((netEffective * months) / paid) : null;
}

/** A TriBro search page's listing cards and its total. Throws when the page is not a recognizable search. */
export function parseTriBroPage(html: string, listingUrl: (value: unknown) => string | null, name: string) {
  const total = Number(html.match(/<h3>\s*([\d,]+) records found\s*<\/h3>/)?.[1]?.replaceAll(',', ''));
  if (!Number.isSafeInteger(total)) throw new Error(name + ' did not return a recognized rentals search page.');
  const cards: RealtyMxCard[] = [];
  for (const card of html.split(/<div class="property-card\b/).slice(1)) {
    const id = card.match(/data-pid="(\d+)"/)?.[1];
    const url = listingUrl(card.match(/data-paction="view"[^>]*\bhref="([^"]+)"/)?.[1]);
    const area = decodeRealtyMx(card.match(/class="search-featured-card-location-label">([^<]*)</)?.[1] ?? '');
    const { street, unit } = realtyMxAddress(decodeRealtyMx(card.match(/class="search-featured-card-address">([^<]*)</)?.[1] ?? ''));
    const advertised = Number(card.match(/class="search-featured-card-price-main">\s*<span>\$([\d,]+)<\/span>/)?.[1]?.replaceAll(',', ''));
    const concession = decodeRealtyMx(card.match(/class="badge mx-concession">([^<]*)</)?.[1] ?? '');
    const rent = card.includes('class="label-ner"') ? (grossRent(advertised, concession) ?? advertised) : advertised;
    // "4 BR", "2.5 BT", "Apartment"; a studio is "Studio".
    const meta = [...(card.match(/class="search-featured-card-meta">([\s\S]*?)<\/div>/)?.[1] ?? '').matchAll(/<span>([^<]*)<\/span>/g)].map(
      ([, text]) => decodeRealtyMx(text),
    );
    const rooms = meta.find((text) => /^(?:Studio|[\d.]+ BR)$/.test(text)) ?? '';
    const bedrooms = rooms === 'Studio' ? 0 : Math.min(4, Math.floor(Number(rooms.replace(' BR', '') || Number.NaN)));
    const type = meta.at(-1) ?? '';
    if (
      !id ||
      !url ||
      !street ||
      !area ||
      card.includes('id="label-AppPending"') ||
      !REALTYMX_HOMES.has(type) ||
      !Number.isFinite(rent) ||
      !Number.isInteger(bedrooms)
    )
      continue;
    const baths = meta.find((text) => / BT$/.test(text));
    cards.push({ id, url, street, unit, area, type, rent, bedrooms, bathrooms: Number(baths?.replace(' BT', '') ?? Number.NaN) });
  }
  return { total, cards };
}

// About 630 rentals (2 pages of 500 cards, about 600 KB each) in November 2026.
const TRIBRO: RealtyMxSite = {
  source: SOURCE,
  origin: ORIGIN,
  status: '2',
  rowsPerPage: 500,
  maxPages: 4,
  listingUrl: tribroListingUrl,
  parsePage: parseTriBroPage,
};

export const TRIBRO_LIVE = {
  ...SOURCE,
  id: 'tribro-live',
  marketplace: SOURCE.id,
  coverage:
    'every available rental with a street number in TriBro NYC’s own rentals search (its own and shared listings) in the five boroughs, at the gross rent; ZIP codes from the Census geocoder',
  regions: ['nyc'],
  minPages: 1,
  maxPages: TRIBRO.maxPages,
  rowsPerPage: TRIBRO.rowsPerPage,
  listingUrl: tribroListingUrl,
  load: (fetcher: FetchTransport, now: Date) => loadRealtyMx(TRIBRO, fetcher, now),
};
