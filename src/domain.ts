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
  /** Listed on Walkup by its owner, who pays any broker; renters pay no fee (server/direct-listings.ts). */
  noFee?: boolean;
  /** How to reach the owner of a Walkup direct listing, with when it is free and their description. */
  contact?: { email: string; phone?: string; available?: string; description?: string };
  /** A photo of the building from the landlord that listed it, from an allowed image host (src/listings.ts). */
  photo?: string;
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
  /** The longest estimated transit commute to the destination (no routing service needed); listings without an estimate are left out. */
  maxCommuteMinutes?: number | null;
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
  /** Only listings within a ten-minute walk of one of these subway lines. */
  subwayLines?: string[];
  /** Only listings within a ten-minute walk of a subway station. */
  nearSubway?: boolean;
  /** Only listings within a ten-minute walk of a fully accessible (step-free) station. */
  accessibleSubway?: boolean;
  /** Only listings Walkup first saw within this many days. */
  newWithinDays?: number;
  /** Only buildings that register rent-stabilized units. */
  stabilizedOnly?: boolean;
  /** Leave out buildings graded C or D from their records. */
  goodBuildings?: boolean;
  /** Only rents at least 20% below similar apartments (a deal). */
  belowMarket?: boolean;
  /** Any of these bedroom counts (0 is a studio, 4 is four or more); overrides `bedrooms` when given. */
  bedroomOptions?: number[];
  /** Any of these bathroom counts: 1 (1 to 1.5), 2 (2 to 2.5) or 3 (three or more). */
  bathroomOptions?: number[];
}
export type { SourceStatus } from './source-status.ts';
export type SearchResult = ReturnType<typeof import('./market.ts').formatSearch> & {
  commute?: boolean;
  commuteNotice?: string;
  inventoryExpiresAt?: string;
};

export type MapPoint = NonNullable<SearchResult['mapPoints']>[number];
