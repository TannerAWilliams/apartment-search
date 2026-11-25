/**
 * What the app can tell about a listing beyond what its source says, from the rest of the inventory and from
 * official building records:
 * - how its rent compares with the median of similar apartments (same neighborhood, or ZIP code, and size);
 * - warnings: a price far below similar apartments, no street number, or the same unit listed at another rent;
 * - the building, when its records have been checked: whether it registers rent-stabilized units, and a grade
 *   from its open violations, recent complaints, bedbug reports and flood zone.
 */
import type { ListingData } from './domain.ts';
import { buildingKey } from './listings.ts';
import { displayPriceHistory } from './price-history.ts';
import { type NearbySubway, type Station, stationIndex } from './subway.ts';

export type BuildingFacts = {
  /** Registers rent-stabilized units with the state (DHCR); null when that could not be checked. */
  stabilized: boolean | null;
  openViolations: number | null;
  complaints: number | null;
  bedbugs: boolean | null;
  flood: boolean | null;
  checkedAt: string;
};
export type BuildingGrade = 'A' | 'B' | 'C' | 'D';
export type ListingInsights = {
  /** The median rent of similar apartments, and how many there are. */
  marketMedian?: number;
  comparedWith?: number;
  /** This rent against that median: −0.12 is 12% below. */
  vsMarket?: number;
  warnings: string[];
  /** Subway stations within a ten-minute walk, the closest first. */
  subway?: NearbySubway[];
  /** When Walkup first saw the listing, from its price history. */
  firstSeen?: string;
  /** How much the rent dropped at its last change, when it dropped. */
  priceCut?: number;
  /** Estimated door-to-door transit minutes to the search's destination (src/transit-estimate.ts). */
  transitMinutes?: number;
};

/** First seen and the last price cut, from a listing's recorded price history. */
export function freshness(history: unknown) {
  const shown = displayPriceHistory(history);
  if (!shown) return {};
  const rents = shown.observations.map(({ rent }) => rent);
  const change = rents.findLastIndex((rent, index) => index > 0 && rent !== rents[index - 1]);
  const cut = change > 0 && rents[change] < rents[change - 1] ? rents[change - 1] - rents[change] : 0;
  return {
    ...(shown.truncated ? {} : { firstSeen: shown.firstObservedAt }),
    ...(cut ? { priceCut: cut } : {}),
  };
}

/** "Listed today", "Listed 3 weeks ago" and the like, from the listing site's own posting date; null without one. */
export function listedLabel(listedAt: string | undefined, now = new Date()) {
  const posted = listedAt ? Date.parse(listedAt) : NaN;
  if (!Number.isFinite(posted)) return null;
  const days = Math.max(0, Math.floor((now.getTime() - posted) / 86_400_000));
  if (days === 0) return 'Listed today';
  if (days === 1) return 'Listed yesterday';
  if (days < 7) return `Listed ${days} days ago`;
  if (days < 60) return `Listed ${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return `Listed ${Math.floor(days / 30)} months ago`;
}
/** Whether the site posted it within the last `days` days. */
export const listedWithin = (listedAt: string | undefined, days: number, now = Date.now()) =>
  Date.parse(listedAt ?? '') >= now - days * 86_400_000;

/** Similar apartments needed before a median is shown. */
export const MIN_COMPARABLES = 5;
/** A rent this far below the median gets a warning. */
export const FAR_BELOW = -0.4;
/** A deal: a rent at least 20% below the median of similar apartments nearby. */
export const DEAL_BELOW = -0.2;
/** No whole apartment in the area rents for under this (listings.ts notes it on the card): a room, parking, a typo or a scam. */
export const IMPLAUSIBLE_RENT = 500;
/** Whether a listing's rent is below any real apartment's here (how far below similar ones is only noted, not judged). */
export const suspiciousRent = (listing: Pick<ListingData, 'rent'>) => listing.rent > 0 && listing.rent < IMPLAUSIBLE_RENT;

const placeKey = (listing: Pick<ListingData, 'neighborhood' | 'zip'>) =>
  listing.neighborhood
    ? 'n:' +
      listing.neighborhood
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    : 'z:' + listing.zip;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** The median rent and count of listings for each place and bedroom count. */
export function rentBenchmarks(listings: Pick<ListingData, 'neighborhood' | 'zip' | 'bedrooms' | 'rent'>[]) {
  const groups = new Map<string, number[]>();
  for (const listing of listings) {
    if (!(listing.rent > 0)) continue;
    const key = placeKey(listing) + '|' + listing.bedrooms;
    groups.set(key, [...(groups.get(key) ?? []), listing.rent]);
  }
  return new Map([...groups].map(([key, rents]) => [key, { median: median(rents), count: rents.length }]));
}

/** A grade from the building's records; null when nothing was checked. */
export function buildingGrade(facts: BuildingFacts | undefined): BuildingGrade | null {
  if (!facts || [facts.openViolations, facts.complaints, facts.bedbugs, facts.flood].every((value) => value === null)) return null;
  const violations = facts.openViolations ?? 0;
  const complaints = facts.complaints ?? 0;
  const points =
    (violations > 20 ? 3 : violations > 5 ? 2 : violations > 0 ? 1 : 0) +
    (complaints > 10 ? 2 : complaints > 2 ? 1 : 0) +
    (facts.bedbugs ? 1 : 0) +
    (facts.flood ? 1 : 0);
  return points === 0 ? 'A' : points <= 2 ? 'B' : points <= 4 ? 'C' : 'D';
}

const money = (rent: number) => '$' + rent.toLocaleString('en-US');
const unitOf = (listing: ListingData) => {
  const building = buildingKey(listing);
  const unit = (listing.unit ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return building && unit ? building + '|' + unit : null;
};

/**
 * Each listing with its insights, and its building's facts where they are known. Benchmarks come from the whole
 * inventory given, so pass every listing, not one page of results.
 */
export function withInsights<T extends ListingData>(
  listings: T[],
  buildings: Record<string, BuildingFacts> = {},
  { registry = {}, stations = [] }: { registry?: Record<string, number>; stations?: Station[] } = {},
) {
  const benchmarks = rentBenchmarks(listings);
  const near = stationIndex(stations);
  const rentsByUnit = new Map<string, Set<number>>();
  for (const listing of listings) {
    const unit = unitOf(listing);
    if (unit) rentsByUnit.set(unit, (rentsByUnit.get(unit) ?? new Set()).add(listing.rent));
  }
  return listings.map((listing) => {
    const warnings: string[] = [];
    const benchmark = benchmarks.get(placeKey(listing) + '|' + listing.bedrooms);
    const compared = benchmark && benchmark.count >= MIN_COMPARABLES ? benchmark : null;
    const vsMarket = compared ? Math.round(((listing.rent - compared.median) / compared.median) * 100) / 100 : undefined;
    if (vsMarket !== undefined && vsMarket <= FAR_BELOW)
      warnings.push(`Priced ${Math.round(-vsMarket * 100)}% below similar apartments nearby.`);
    if (!/^\s*\d/.test(listing.address)) warnings.push('No street number is given. Ask for the exact address before you tour.');
    const unit = unitOf(listing);
    const others = unit ? [...(rentsByUnit.get(unit) ?? [])].filter((rent) => rent !== listing.rent) : [];
    if (others.length)
      warnings.push(
        `This unit is also listed at ${others
          .sort((a, b) => a - b)
          .map(money)
          .join(' and ')}.`,
      );
    const key = buildingKey(listing);
    const checked = key ? buildings[key] : undefined;
    // The state's registry says a building is rent-stabilized even before its other records are checked.
    const registered = key !== null && key in registry;
    const building: BuildingFacts | undefined = registered
      ? {
          ...(checked ?? { openViolations: null, complaints: null, bedbugs: null, flood: null, checkedAt: new Date().toISOString() }),
          stabilized: true,
        }
      : checked;
    const subway = listing.region === 'nyc' ? near(listing.latitude, listing.longitude) : [];
    const insights: ListingInsights = {
      ...(compared ? { marketMedian: compared.median, comparedWith: compared.count, vsMarket } : {}),
      warnings,
      ...(subway.length ? { subway } : {}),
      ...freshness(listing.priceHistory),
    };
    return { ...listing, insights, ...(building ? { building } : {}) };
  });
}

/** The badge text for a rent against similar apartments, or null when it is within 5%. */
export function marketBadge(insights: ListingInsights | undefined) {
  const delta = insights?.vsMarket;
  if (delta === undefined || Math.abs(delta) < 0.05) return null;
  const percent = Math.round(Math.abs(delta) * 100);
  return delta < 0 ? `${percent}% below similar` : `${percent}% above similar`;
}
