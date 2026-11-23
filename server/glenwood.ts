/**
 * Glenwood: every available apartment in its Manhattan and Riverdale buildings, from the landlord's own
 * search at glenwoodnyc.com. The "all apartments" search lists them on one page; it must equal the
 * one- to four-bedroom searches combined (convertible apartments appear under two sizes), or nothing is saved.
 * Listing cards name the building but not its street address, so the buildings are kept here, with addresses
 * from Glenwood's listing pages and ZIP codes and coordinates from the U.S. Census geocoder (November 2026).
 */
import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { fetchPublicHtml } from './public-rentals.ts';

const SOURCE = { id: 'glenwood', name: 'Glenwood', kind: 'feed' };
const ORIGIN = 'https://www.glenwoodnyc.com';
export const GLENWOOD_TRANSPORT = 'glenwood-search-all';
const searchUrl = (bedroom: number) => `${ORIGIN}/search-result/?bedroom=${bedroom}&nhood=&price=`;
/** "All apartments", then each size Glenwood's search offers (0 is studio). */
const SEARCHES = [-1, 0, 1, 2, 3, 4];

type Building = { address: string; zip: string; latitude: number; longitude: number; city?: string };
export const GLENWOOD_BUILDINGS: Readonly<Record<string, Building>> = {
  'barclay-tower': { address: '10 Barclay Street', zip: '10007', latitude: 40.712032, longitude: -74.008324 },
  'briar-hill': { address: '600 West 246th Street', zip: '10471', latitude: 40.892575, longitude: -73.909957, city: 'Bronx' },
  'crystal-green': { address: '330 West 39th Street', zip: '10018', latitude: 40.755657, longitude: -73.99211 },
  'emerald-green': { address: '320 West 38th Street', zip: '10018', latitude: 40.754919, longitude: -73.992288 },
  'grand-tier': { address: '1930 Broadway', zip: '10023', latitude: 40.772424, longitude: -73.982111 },
  'hampton-court': { address: '333 East 102nd Street', zip: '10029', latitude: 40.787773, longitude: -73.943484 },
  'hawthorn-park': { address: '160 West 62nd Street', zip: '10023', latitude: 40.771893, longitude: -73.985425 },
  'liberty-plaza': { address: '10 Liberty Street', zip: '10005', latitude: 40.707641, longitude: -74.008258 },
  'paramount-tower': { address: '240 East 39th Street', zip: '10016', latitude: 40.748279, longitude: -73.974598 },
  'the-andover': { address: '1675 York Avenue', zip: '10128', latitude: 40.77735, longitude: -73.94617 },
  'the-bamford': { address: '333 East 56th Street', zip: '10022', latitude: 40.758426, longitude: -73.965137 },
  'the-barclay': { address: '1755 York Avenue', zip: '10128', latitude: 40.779442, longitude: -73.944659 },
  'the-belmont': { address: '320 East 46th Street', zip: '10017', latitude: 40.752253, longitude: -73.970199 },
  'the-bristol': { address: '300 East 56th Street', zip: '10022', latitude: 40.758554, longitude: -73.965754 },
  'the-brittany': { address: '1775 York Avenue', zip: '10128', latitude: 40.77991, longitude: -73.944372 },
  'the-cambridge': { address: '500 East 85th Street', zip: '10028', latitude: 40.775168, longitude: -73.947595 },
  'the-encore': { address: '175 West 60th Street', zip: '10023', latitude: 40.770794, longitude: -73.986382 },
  'the-fairmont': { address: '300 East 75th Street', zip: '10021', latitude: 40.770675, longitude: -73.956912 },
  'the-lucerne': { address: '350 East 79th Street', zip: '10075', latitude: 40.772593, longitude: -73.953444 },
  'the-marlowe': { address: '145 East 81st Street', zip: '10028', latitude: 40.776235, longitude: -73.957686 },
  'the-pavilion': { address: '500 East 77th Street', zip: '10162', latitude: 40.769995, longitude: -73.951368 },
  'the-regent': { address: '45 West 60th Street', zip: '10023', latitude: 40.769578, longitude: -73.983534 },
  'the-sage': { address: '329 West 38th Street', zip: '10018', latitude: 40.755112, longitude: -73.992434 },
  'the-somerset': { address: '1365 York Avenue', zip: '10021', latitude: 40.767355, longitude: -73.953469 },
  'the-stratford': { address: '1385 York Avenue', zip: '10021', latitude: 40.76797, longitude: -73.95302 },
  'tribeca-bridge-tower': { address: '450 North End Avenue', zip: '10282', latitude: 40.717276, longitude: -74.013983 },
};

export function glenwoodListingUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const id = url.searchParams.get('lid');
    return url.origin === ORIGIN && url.pathname === '/listing-detail/' && id && /^\d{1,9}$/.test(id)
      ? `${ORIGIN}/listing-detail/?lid=${id}`
      : null;
  } catch {
    return null;
  }
}

type Card = { id: string; building: string; bedrooms: number; bathrooms: number; rent: number };
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The listing cards on a Glenwood search page. Throws when the page is not a recognizable search result. */
export function parseGlenwoodSearch(html: string): Card[] {
  if (!/Search Result:/.test(html)) throw new Error('Glenwood did not return a recognized search page.');
  const cards = html.split(/<div class="col-md-4 col-sm-6" id="(?=\d+")/).slice(1);
  return cards.map((card) => {
    const id = card.match(/^(\d+)"/)?.[1];
    const building = card.match(/href="https:\/\/www\.glenwoodnyc\.com\/properties\/[a-z-]+\/([a-z0-9-]+)\/?"/)?.[1];
    const plain = text(card);
    const bedrooms = Number(plain.match(/Bedrooms (\d+)/)?.[1]);
    const bathrooms = Number(plain.match(/Bathrooms ([\d.]+)/)?.[1]);
    const rent = Number(plain.match(/Monthly Price \$\s?([\d,]+)/)?.[1]?.replaceAll(',', ''));
    if (!id || !building || !Number.isInteger(bedrooms) || !Number.isFinite(rent))
      throw new Error('Glenwood listed an apartment it did not fully describe.');
    return { id, building, bedrooms, bathrooms, rent };
  });
}

export function glenwoodListing(card: Card, checkedAt: string) {
  const building = GLENWOOD_BUILDINGS[card.building];
  if (!building) return null;
  return normalizeListing(
    {
      id: card.id,
      url: `${ORIGIN}/listing-detail/?lid=${card.id}`,
      address: building.address,
      city: building.city ?? 'Manhattan',
      state: 'NY',
      region: 'nyc',
      zipCode: building.zip,
      latitude: building.latitude,
      longitude: building.longitude,
      bedrooms: card.bedrooms,
      bathrooms: Number.isFinite(card.bathrooms) ? card.bathrooms : undefined,
      rent: card.rent,
      company: 'Glenwood',
      status: 'Active',
      updatedAt: checkedAt,
    },
    SOURCE,
  );
}

/** Every available apartment. Throws unless the all-apartments search equals the size searches combined. */
export async function loadGlenwood(fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const pages: Card[][] = [];
  // One page at a time, as a person would browse the search.
  for (const bedroom of SEARCHES) pages.push(parseGlenwoodSearch(await fetchPublicHtml(fetcher, searchUrl(bedroom), 'Glenwood', 15_000)));
  const [all, ...sizes] = pages;
  const ids = new Set(all.map(({ id }) => id));
  const bySize = new Set(sizes.flat().map(({ id }) => id));
  if (ids.size !== all.length || ids.size !== bySize.size || [...bySize].some((id) => !ids.has(id))) {
    throw new Error(`Glenwood's all-apartments search (${ids.size}) did not match its size searches (${bySize.size}).`);
  }
  const unknown = [...new Set(all.filter(({ building }) => !GLENWOOD_BUILDINGS[building]).map(({ building }) => building))];
  if (unknown.length) throw new Error('Glenwood listed apartments in buildings this app does not know yet: ' + unknown.join(', ') + '.');
  const listings = all.map((card) => glenwoodListing(card, checkedAt)).filter((listing) => listing !== null);
  return { listings, pages: SEARCHES.length, total: ids.size, rawCount: all.length, transport: GLENWOOD_TRANSPORT, checkedAt };
}

export const GLENWOOD_LIVE = {
  ...SOURCE,
  id: 'glenwood-live',
  marketplace: SOURCE.id,
  coverage: 'every available apartment in Glenwood’s Manhattan and Riverdale buildings, from the landlord’s own search',
  regions: ['nyc'],
  minPages: SEARCHES.length,
  maxPages: SEARCHES.length,
  rowsPerPage: 200,
  listingUrl: glenwoodListingUrl,
  load: loadGlenwood,
};
