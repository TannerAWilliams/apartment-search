/**
 * What the public pages show, worked out once when the inventory is built and kept beside it: each New York City
 * neighborhood's rents and buildings, each borough's rents, and every listed building that has a grade. A public
 * page then reads this one small document. Before, each page read every listing from the database, which took
 * two to six seconds on a Worker that had not just answered a search: too slow for a search engine's crawler.
 */
import type { AppEnv } from './contracts.ts';
import { summarizeNeighborhood } from './neighborhoods.ts';
import { offline, search } from './search.ts';
import type { ListingData } from '../src/domain.ts';
import { openingSearchBody } from '../src/early-requests.ts';
import { type BuildingFacts, buildingGrade } from '../src/insights.ts';
import { buildingKey } from '../src/listings.ts';
import { parseFilters } from '../src/search.ts';

export const SUMMARY_KEY = 'public:summary';
const FORMAT = 1;
export const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
/** A neighborhood with fewer listings has no page: its medians would say little. */
const MIN_LISTINGS = 5;
const MAX_BUILDINGS = 12_000;

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

type Sizes = ReturnType<typeof summarizeNeighborhood>['sizes'];
export type NeighborhoodSummary = {
  /** Its page's address under /rents: "brooklyn/park-slope". */
  path: string;
  name: string;
  borough: string;
  count: number;
  sizes: Sizes;
  /** The ZIP code most of its listings are in, for the year's 311 complaints. */
  zip: string | null;
  buildings: ReturnType<typeof summarizeNeighborhood>['buildings'];
};
export type BuildingSummary = {
  /** Its page's address under /building: "100-w-86th-st-10024". */
  slug: string;
  address: string;
  zip: string;
  borough: string;
  neighborhood: string;
  grade: NonNullable<ReturnType<typeof buildingGrade>>;
  facts: Pick<
    BuildingFacts,
    'openViolations' | 'complaints' | 'bedbugs' | 'rats' | 'evictions' | 'courtCases' | 'stabilized' | 'vacate'
  > & {
    checkedAt: string;
  };
  /** Apartments listed there now, and the lowest rent among them. */
  listed: number;
  fromRent: number;
};
export type PublicSummary = {
  format: number;
  builtAt: string;
  listings: number;
  /** How many listing sites the apartments came from. */
  sites: number;
  boroughs: { name: string; count: number; sizes: Sizes }[];
  neighborhoods: NeighborhoodSummary[];
  buildings: BuildingSummary[];
};

/** The summary of these listings: New York City's, by borough, neighborhood and graded building. */
export function summarizePublic(listings: ListingData[], now = new Date()): PublicSummary {
  const city = listings.filter((listing) => BOROUGHS.includes(listing.city));
  const places = new Map<string, ListingData[]>();
  const buildings = new Map<string, BuildingSummary>();
  for (const listing of city) {
    if (listing.neighborhood) {
      const path = slug(listing.city) + '/' + slug(listing.neighborhood);
      const own = places.get(path);
      if (own) own.push(listing);
      else places.set(path, [listing]);
    }
    const grade = buildingGrade(listing.building);
    const key = buildingKey(listing);
    // A graded building at a street number: an address without one ("1st Ave") is not one building.
    if (!grade || !key || !listing.building || !/^\d/.test(listing.address)) continue;
    const known = buildings.get(key);
    if (known) {
      known.listed++;
      if (listing.rent > 0) known.fromRent = known.fromRent ? Math.min(known.fromRent, listing.rent) : listing.rent;
      continue;
    }
    const { openViolations, complaints, bedbugs, rats, evictions, courtCases, stabilized, vacate, checkedAt } = listing.building;
    buildings.set(key, {
      slug: slug(`${listing.address} ${listing.zip}`),
      address: listing.address,
      zip: listing.zip,
      borough: listing.city,
      neighborhood: listing.neighborhood ?? '',
      grade,
      facts: { openViolations, complaints, bedbugs, rats, evictions, courtCases, stabilized, vacate, checkedAt },
      listed: 1,
      fromRent: Math.max(0, listing.rent),
    });
  }
  return {
    format: FORMAT,
    builtAt: now.toISOString(),
    listings: city.length,
    sites: new Set(city.flatMap(({ sources }) => sources.filter(({ url }) => url).map(({ id }) => id))).size,
    boroughs: BOROUGHS.map((name) => {
      const own = city.filter((listing) => listing.city === name);
      return { name, count: own.length, sizes: summarizeNeighborhood(own).sizes };
    }).filter(({ count }) => count > 0),
    neighborhoods: [...places]
      .filter(([, own]) => own.length >= MIN_LISTINGS)
      .map(([path, own]) => {
        const { sizes, zips, buildings: checked } = summarizeNeighborhood(own);
        return {
          path,
          name: own[0]!.neighborhood!,
          borough: own[0]!.city,
          count: own.length,
          sizes,
          zip: zips[0] ?? null,
          buildings: checked,
        };
      })
      .sort((a, b) => BOROUGHS.indexOf(a.borough) - BOROUGHS.indexOf(b.borough) || a.name.localeCompare(b.name)),
    // One page per address; two spellings of one address keep the first.
    buildings: [...new Map([...buildings.values()].map((building) => [building.slug, building])).values()]
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .slice(0, MAX_BUILDINGS),
  };
}

/** The summary kept beside the inventory; worked out from the listings where there is none (a new deploy, a test). */
export async function publicSummary(env: AppEnv, now = new Date()): Promise<PublicSummary> {
  const text = env.INVENTORY ? await env.INVENTORY.get(SUMMARY_KEY, { type: 'text', cacheTtl: 60 }).catch(() => null) : null;
  if (text) {
    try {
      const stored = JSON.parse(text) as PublicSummary;
      if (stored.format === FORMAT) return stored;
    } catch {
      // Unreadable: worked out below.
    }
  }
  // The apartments people can search (the inventory's own); where there is none yet, the recorded ones.
  const { listings } = await search(parseFilters(JSON.parse(openingSearchBody())), env, offline, true, { scored: true });
  const live = summarizePublic(listings, now);
  if (live.listings) return live;
  const { matches } = await search(parseFilters({ region: 'nyc', bedrooms: null, maxRent: null }), env, offline, true, { kept: true });
  return summarizePublic(matches, now);
}
