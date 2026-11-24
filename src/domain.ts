/** Shared data contracts. Unknown feed input is validated before becoming a listing. */
export interface Point {
  latitude: number;
  longitude: number;
}
export interface Workplace extends Point {
  label: string;
}
export interface SourceLink {
  id: string;
  name: string;
  url?: string | null;
  kind: string;
}
/**
 * The fields of T, each of unknown type: for values read from device storage, feeds or requests, which are
 * checked field by field before use.
 */
export type Loose<T> = { readonly [K in keyof T]?: unknown };
/** A plain object, for narrowing an unknown value before reading its fields. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** Whether a value is one of a fixed list of options. */
export const oneOf = <T>(options: readonly T[], value: unknown): value is T => options.some((option) => option === value);

export interface ListingData {
  id: string;
  address: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  region?: string;
  neighborhood?: string;
  company?: string;
  rent: number;
  bedrooms: number;
  latitude?: number | null;
  longitude?: number | null;
  seenAt?: string | null;
  kind: string;
  sources: readonly SourceLink[];
  bathrooms?: number | null;
  squareFeet?: number | null;
  petsAllowed?: boolean | null;
  laundry?: string | null;
  discoveryConflicts?: string[];
  detailsConflict?: boolean;
  miles?: number | null;
  transitSeconds?: number | null;
  drivingSeconds?: number | null;
  checkedAt?: string | null;
  priceIncludesFees?: boolean;
  companyFromSnapshot?: boolean;
  priceHistory?: unknown;
  buildingLinks?: { name: string; url: string }[];
  commuteEstimate?: { provider: string; arrivalPeriod: string; checkedAt: string; destination: Workplace };
  bestFit?: ReturnType<typeof import('./best-fit.ts').bestFit>;
  /** Comparison with similar apartments and warnings (src/insights.ts), added by the server's search. */
  insights?: import('./insights.ts').ListingInsights;
  /** Official records of the building, where they have been checked (src/insights.ts). */
  building?: import('./insights.ts').BuildingFacts;
}
export interface SearchFilters {
  region: string;
  bedrooms: number | null;
  maxRent: number | null;
  maxMiles: number | null;
  maxTransitMinutes: number | null;
  maxDrivingMinutes: number | null;
  liveOnly: boolean;
  includeCached?: boolean;
  sort: string;
  bestFitRentWeight: number;
  source: string;
  company: string;
  minBathrooms: number | null;
  minSquareFeet: number | null;
  petsRequired: boolean;
  laundry: string;
  workplace: string;
  customWorkplace: string;
  zip: string;
  offset?: number;
  includeMap?: boolean;
  includeCommute?: boolean;
  /** Only official feeds and open data: no listings read from listing sites' own pages. The App Store app sets it. */
  officialOnly?: boolean;
  /** Only listings in this neighborhood (compared without case or punctuation). */
  neighborhood?: string;
  /** Only buildings that register rent-stabilized units. */
  stabilizedOnly?: boolean;
  /** Leave out buildings graded C or D from their records. */
  goodBuildings?: boolean;
  /** Only rents at least 5% below similar apartments. */
  belowMarket?: boolean;
}
export type { SourceStatus } from './source-status.ts';
export type SearchResult = ReturnType<typeof import('./market.ts').formatSearch> & {
  commute?: boolean;
  commuteNotice?: string;
  inventoryExpiresAt?: string;
};

export type MapPoint = NonNullable<SearchResult['mapPoints']>[number];
