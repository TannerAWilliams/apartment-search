/** Shared data contracts. Unknown feed input is validated before becoming a listing. */
export interface Point { latitude: number; longitude: number }
export interface Workplace extends Point { label: string }
export interface SourceLink { id: string; name: string; url?: string | null; kind: string }
export interface ListingData {
  id: string; address: string; unit?: string; city: string; state: string; zip: string;
  county?: string; region?: string; neighborhood?: string; company?: string;
  rent: number; bedrooms: number; latitude?: number | null; longitude?: number | null;
  seenAt?: string | null; kind: string; sources: readonly SourceLink[];
  bathrooms?: number | null; squareFeet?: number | null; petsAllowed?: boolean | null;
  laundry?: string | null; discoveryConflicts?: string[]; detailsConflict?: boolean;
  miles?: number | null; transitSeconds?: number | null; drivingSeconds?: number | null;
  checkedAt?: string | null; priceIncludesFees?: boolean; companyFromSnapshot?: boolean; priceHistory?: unknown;
  buildingLinks?: { name: string; url: string }[];
  commuteEstimate?: { provider: string; arrivalPeriod: string; checkedAt: string; destination: Workplace };
  bestFit?: ReturnType<typeof import('./best-fit.ts').bestFit>;
}
export interface SearchFilters {
  region: string; bedrooms: number | null; maxRent: number | null; maxMiles: number | null;
  maxTransitMinutes: number | null; maxDrivingMinutes: number | null; liveOnly: boolean;
  sort: string; bestFitRentWeight: number; source: string; company: string;
  minBathrooms: number | null; minSquareFeet: number | null; petsRequired: boolean; laundry: string;
  workplace: string; customWorkplace: string; zip: string; offset?: number; includeMap?: boolean; includeCommute?: boolean;
}
export type { SourceStatus } from './source-status.ts';
export type SearchResult = ReturnType<typeof import('./market.ts').formatSearch> & { commute?: boolean; commuteNotice?: string };

export type MapPoint = NonNullable<SearchResult['mapPoints']>[number];
