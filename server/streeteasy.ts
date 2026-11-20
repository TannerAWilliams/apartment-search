import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { NJ_ZIPS, nycBorough } from './firstmover.ts';
import { assignedJson, deduplicatePublicRentals, fetchPublicHtml, jsonLd, publicListingUrl } from './public-rentals.ts';

const MAX_STREETEASY_RENT = 2_147_483_647;
const SOURCE = { id: 'streeteasy', name: 'StreetEasy', kind: 'feed', maxBedrooms: 100, maxRent: MAX_STREETEASY_RENT };
const ORIGIN = 'https://streeteasy.com';
export const STREETEASY_API_URL = 'https://api-v6.streeteasy.com/';
const PAGE_SIZE = 500;
const MAX_PAGES = 160;
const RESULT_WINDOW = 1000;
const MAX_INVENTORY = 20000;
type PriceRange = { lower: number; upper: number };
const searchQuery = (page: number, range?: PriceRange) => `query SearchRentals {
  searchRentals(input: {
    sorting: { attribute: LISTED_AT, direction: DESCENDING }
    adStrategy: NONE
    filters: { rentalStatus: ACTIVE
      ${range ? `price: { lowerBound: ${range.lower}, upperBound: ${range.upper} }` : ''} }
    perPage: ${PAGE_SIZE}
    page: ${page}
  }) {
    totalCount
    edges {
      ... on OrganicRentalEdge {
        node {
          id street unit zipCode status bedroomCount price urlPath areaName buildingType
          geoPoint { latitude longitude }
        }
      }
    }
  }
}`;
export const STREETEASY_LIVE = {
  ...SOURCE, id: 'streeteasy-live', marketplace: SOURCE.id,
  coverage: 'all active rentals returned by StreetEasy across its markets',
  // Preserve support for previously imported NYC and NJ batches.
  regions: ['nyc', 'nj', 'li', 'metroNorth', 'ct'], minPages: 1, maxPages: MAX_PAGES,
  rowsPerPage: PAGE_SIZE, listingUrl: streetEasyListingUrl, load: loadStreetEasy,
};
const MULTIFAMILY = new Set(['TWOFAMILY', 'THREEFAMILY', 'MULTIFAMILY']);

export function streetEasyListingUrl(value: unknown) {
  return publicListingUrl(value, ORIGIN, /^\/(?:rental\/\d+|building\/[^/]+\/(?:[^/]+|rental\/\d+))$/);
}

type LegacyRental = { address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string }; url?: string; name?: string; additionalProperty?: { name?: string; value?: string }[]; '@type'?: string; offers?: { availability?: string }; numberOfBedrooms?: number; geo?: { latitude?: number; longitude?: number } };
function normalizeRental(row: LegacyRental, state: string, bedrooms: number, checkedAt: string) {
  const { streetAddress, addressLocality, addressRegion, postalCode } = row.address ?? {};
  const url = streetEasyListingUrl(row.url);
  const unit = typeof row.name === 'string' ? row.name.match(/\s#\s*([^#]+)$/)?.[1] : '';
  const properties = Array.isArray(row.additionalProperty) ? row.additionalProperty : [];
  const property = (name: string) => properties.find((entry) => entry?.name === name)?.value;
  const buildingType = property('Building Type');
  const isApartment = row['@type'] === 'Apartment' || (unit && MULTIFAMILY.has(buildingType ?? ''));
  const availability = row.offers?.availability ?? property('Status');
  if (!isApartment || !url || typeof streetAddress !== 'string' ||
      addressRegion !== state || typeof postalCode !== 'string' || !/^\d{5}$/.test(postalCode) || row.numberOfBedrooms !== bedrooms ||
      (availability && !/^(?:active|available|(?:https?:\/\/schema\.org\/)?instock)$/i.test(availability))) return null;

  const rentText = property('Monthly Rent');
  const rent = typeof rentText === 'string' ? rentText.match(/^\$([\d,]+(?:\.\d{2})?)\/mo$/)?.[1] : null;
  const { latitude, longitude } = row.geo ?? {};
  if (!rent || typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < 40 || latitude > 42 || longitude < -75 || longitude > -72) return null;

  const [njCity, county] = NJ_ZIPS[postalCode] ?? [];
  const city = state === 'NY' ? nycBorough(postalCode) :
    postalCode === '07093' && addressLocality === 'Guttenberg' ? 'Guttenberg' : njCity ?? addressLocality;
  const path = new URL(url).pathname;
  const rentalId = path.match(/\/rental\/(\d+)$/)?.[1];
  return normalizeListing({
    id: rentalId ?? path, url, address: streetAddress, unit, city, county, state, zipCode: postalCode,
    region: state === 'NY' ? 'nyc' : 'nj', neighborhood: addressLocality, latitude, longitude,
    bedrooms, rent: Number(rent.replaceAll(',', '')), status: 'Active', updatedAt: checkedAt,
  }, SOURCE);
}

export function parseStreetEasyPage(html: string, state: string, bedrooms: number, checkedAt: string) {
  const rentals = jsonLd(html).flatMap((schema) => Array.isArray(schema?.['@graph']) ?
    (schema['@graph'] as LegacyRental[]).filter((row) => row?.address?.postalCode && row.url) : []);
  if (!rentals.length) throw new Error('StreetEasy did not return a recognized rental page.');
  return rentals.map((row) => normalizeRental(row, state, bedrooms, checkedAt)).filter((listing) => listing !== null);
}

export const STREETEASY_PUBLIC_TRANSPORT = 'public-search';
export const STREETEASY_PUBLIC_COVERAGE = 'first page of the public NYC and New Jersey rental search';
export const STREETEASY_PUBLIC_SEARCH_URL = ORIGIN + '/for-rent/nyc';
const PUBLIC_PAGE_LIMIT = 50;

type SearchRental = {
  id?: string;
  street?: string;
  unit?: string;
  zipCode?: string;
  status?: string;
  bedroomCount?: number;
  price?: number;
  urlPath?: string;
  areaName?: string;
  buildingType?: string;
  geoPoint?: { latitude?: number; longitude?: number };
};

async function fetchPage(fetcher: FetchTransport, page: number, range?: PriceRange, signal?: AbortSignal) {
  const response = await fetcher(STREETEASY_API_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: searchQuery(page, range) }),
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(9000)]) : AbortSignal.timeout(9000),
  });
  if (!response.ok) throw Object.assign(new Error('StreetEasy returned HTTP ' + response.status + '.'), { httpStatus: response.status });
  const payload = await response.json() as {
    errors?: unknown[];
    data?: { searchRentals?: { totalCount: number; edges: { node?: SearchRental }[] } };
  };
  const result = payload?.data?.searchRentals;
  if (!result || payload?.errors?.length || !Number.isSafeInteger(result?.totalCount) || result.totalCount < 0 ||
      !Array.isArray(result?.edges) || result.edges.length > PAGE_SIZE) {
    throw new Error('StreetEasy v6 did not return rental results.');
  }
  return result;
}

export async function loadStreetEasy(fetcher: FetchTransport = fetch, now = new Date()) {
  const controller = new AbortController();
  let failure: unknown;
  let pages = 0;
  let active = 0;
  const waiting: (() => void)[] = [];
  async function page(number: number, range?: PriceRange) {
    if (failure) throw failure;
    if (++pages > MAX_PAGES) throw new Error('StreetEasy inventory exceeds the sync request limit.');
    if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      if (failure) throw failure;
      return await fetchPage(fetcher, number, range, controller.signal);
    } catch (error) {
      failure ??= error;
      controller.abort();
      throw error;
    }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  }
  const first = await page(1);
  if (first.totalCount > MAX_INVENTORY) throw new Error('StreetEasy inventory exceeds the sync limit.');
  type Result = Awaited<ReturnType<typeof fetchPage>>;
  function complete(edges: Result['edges'], total: number) {
    const unique = new Map<string, Result['edges'][number]>();
    for (const edge of edges) {
      if (!edge.node?.id) throw new Error('StreetEasy returned a rental without an ID.');
      const prior = unique.get(edge.node.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(edge)) {
        throw new Error('StreetEasy inventory changed during the sync.');
      }
      unique.set(edge.node.id, edge);
    }
    if (unique.size !== total) throw new Error('StreetEasy returned incomplete inventory.');
    return [...unique.values()];
  }
  async function collect(range: PriceRange, result: Result): Promise<Result['edges']> {
    if (result.totalCount <= RESULT_WINDOW) {
      let edges = result.edges;
      if (result.totalCount > PAGE_SIZE) {
        const second = await page(2, result === first ? undefined : range);
        if (second.totalCount !== result.totalCount) throw new Error('StreetEasy inventory changed during the sync.');
        edges = [...edges, ...second.edges];
      }
      // A leaf must contain distinct rows, not a repeated page.
      if (edges.length !== result.totalCount) throw new Error('StreetEasy returned incomplete inventory.');
      return complete(edges, result.totalCount);
    }
    if (range.lower === range.upper) throw new Error('StreetEasy has too many rentals at one price to verify a complete sync.');
    const prices = result.edges.map(({ node }) => node?.price)
      .filter((price): price is number => Number.isSafeInteger(price) && price! >= range.lower && price! <= range.upper)
      .sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const middle = median !== undefined && median < range.upper ? median : Math.floor((range.lower + range.upper) / 2);
    const ranges = [{ lower: range.lower, upper: middle }, { lower: middle + 1, upper: range.upper }];
    const children = await Promise.all(ranges.map(async (child) => collect(child, await page(1, child))));
    // StreetEasy can match both gross and discounted rent, so ranges overlap by
    // listing ID. Deduplicate the union before comparing it with the parent count.
    return complete(children.flat(), result.totalCount);
  }
  let edges: Result['edges'];
  try { edges = await collect({ lower: 0, upper: MAX_STREETEASY_RENT }, first); }
  catch (error) {
    failure ??= error;
    controller.abort();
    throw error;
  }
  const checkedAt = now.toISOString();
  const rows = activeRentals(edges, checkedAt);
  if (rows.length !== edges.length) {
    throw new Error('StreetEasy returned ' + (edges.length - rows.length) + ' rentals that could not be saved.');
  }
  // Preserve provider listing IDs in storage. Search can merge listings for the same unit for display.
  return { listings: rows, pages, total: first.totalCount, rawCount: edges.length, checkedAt, transport: 'v6-daily' };
}

function activeRentals(edges: { node?: SearchRental }[], checkedAt: string) {
  return edges.flatMap(({ node }) => {
    if (node?.status !== 'ACTIVE') return [];
    const url = streetEasyListingUrl(node.urlPath);
    const zip = node.zipCode ?? '';
    const borough = nycBorough(zip);
    const nj = NJ_ZIPS[zip];
    const state = borough ? 'NY' : /^0[78]\d{3}$/.test(zip) ? 'NJ' : /^06\d{3}$/.test(zip) ? 'CT' : /^1\d{4}$/.test(zip) ? 'NY' : null;
    if (!url || !state) return [];
    const listing = normalizeListing({
      id: node.id, url, address: node.street, unit: node.unit?.replace(/^#\s*/, ''), zipCode: node.zipCode,
      city: borough ?? nj?.[0] ?? (state === 'NJ' ? 'New Jersey' : state === 'CT' ? 'Connecticut' : 'New York State'),
      state, county: nj?.[1], region: state === 'NJ' ? 'nj' : state === 'CT' ? 'ct' : undefined,
      neighborhood: node.areaName, bedrooms: node.bedroomCount, rent: node.price,
      latitude: node.geoPoint?.latitude, longitude: node.geoPoint?.longitude,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}

export async function parseStreetEasyPublicSearch(html: string, now: Date) {
  const payload: string[] = [];
  let script = '';
  const parsed = new HTMLRewriter().on('script', {
    element(element) {
      script = '';
      element.onEndTag(() => {
        const args = script.match(/^\s*self\.__next_f\.push\(([\s\S]*)\)\s*;?\s*$/)?.[1];
        if (!args) return;
        const chunk: unknown = JSON.parse(args);
        if (Array.isArray(chunk) && chunk[0] === 1 && typeof chunk[1] === 'string') payload.push(chunk[1]);
      });
    },
    text(chunk) {
      script += chunk.text;
    },
  }).transform(new Response(html));
  await parsed.body?.pipeTo(new WritableStream());

  const page = assignedJson(payload.join(''), /"listingData":\s*(?=\{)/);
  if (page?.search?.criteria !== 'area:1|status:open' || !Number.isSafeInteger(page.totalCount) ||
      !Array.isArray(page.edges) || page.edges.length > PUBLIC_PAGE_LIMIT || page.totalCount < page.edges.length ||
      !page.edges.every((entry: unknown) => entry !== null && typeof entry === 'object')) {
    throw new Error('StreetEasy did not return its public active rental search.');
  }
  const checkedAt = now.toISOString();
  const listings = deduplicatePublicRentals(activeRentals(page.edges, checkedAt));
  if (!listings.length && page.totalCount !== 0) throw new Error('StreetEasy public search returned no supported rentals.');
  return { listings, pages: 1, total: page.totalCount as number, checkedAt, sampleLimit: PUBLIC_PAGE_LIMIT,
    limited: true, transport: STREETEASY_PUBLIC_TRANSPORT };
}

export async function loadStreetEasyPublicSearch(fetcher: FetchTransport, now: Date) {
  return parseStreetEasyPublicSearch(await fetchPublicHtml(fetcher, STREETEASY_PUBLIC_SEARCH_URL, SOURCE.name), now);
}
