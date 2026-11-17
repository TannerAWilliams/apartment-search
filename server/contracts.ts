/** Shared storage contract, including metadata-only object heads. */
export type BucketHead = { etag: string; customMetadata: Record<string, string> };
export type BucketObject = BucketHead & { arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; json(): Promise<any> };
export type Bucket = {
  get(key: string): Promise<BucketObject | null>;
  head(key: string): Promise<BucketHead | null>;
  put(key: string, body: string | Uint8Array, options?: { customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }): Promise<{ etag: string } | null>;
};
export type AppEnv = {
  BUCKET?: Bucket;
  /** Legacy settings intentionally ignored by current adapters. */
  RENTCAST_API_KEY?: string;
  GOOGLE_ROUTES_API_KEY?: string;
  PARTNER_FEEDS_JSON?: string;
  TEMPORARY_CACHE?: string; STARTUP_OPENIGLOO?: string;
  PUBLIC_APP?: string;
  APP_ACCESS_TOKEN?: string;
  FREE_PARTNER_FEEDS_JSON?: string;
  LISTING_RELAY_URL?: string;
  LISTING_RELAY_TOKEN?: string;
  LISTING_FETCH_TRANSPORT?: string;
  STREETEASY_PUBLIC_SEARCH?: string;
  TRAVELTIME_APP_ID?: string;
  TRAVELTIME_API_KEY?: string;
};
export type HousingOpportunity = { id: string; name: string; borough: string; closes: string; sizes: number[]; addresses: string[]; buildingKeys: string[]; url: string };
export type HousingSnapshot = { publishedAt: string | null; checkedAt: string | null; opportunities: HousingOpportunity[] };
export type HdcOpportunity = { id: string; name: string; url: string; address: string; borough: string; rent: string; bedrooms: string; age: string; accessibility: string };
export type HdcSnapshot = { results: HdcOpportunity[]; total: number; limited: boolean; checkedAt?: string };
export type HousingResponse = HousingSnapshot & { rerentals: HdcSnapshot | null };
