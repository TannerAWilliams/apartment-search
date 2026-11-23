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
  PUBLIC_APP?: string;
  APP_ACCESS_TOKEN?: string;
  FREE_PARTNER_FEEDS_JSON?: string;
  STREETEASY_SYNC_ENABLED?: string;
  STREETEASY_PUBLIC_SEARCH?: string;
  TRAVELTIME_APP_ID?: string;
  TRAVELTIME_API_KEY?: string;
  /** Who may sign in through Cloudflare Access; alert emails go to the same addresses. */
  ACCESS_ALLOWED_EMAILS?: string;
  /** The app's address, for links in alerts. */
  APP_ORIGIN?: string;
  /** Cloudflare Email Service binding and the sender on an Email Routing domain. */
  ALERT_EMAIL?: { send(message: { from: string; to: string[]; subject: string; text: string; html: string }): Promise<unknown> };
  ALERT_EMAIL_FROM?: string;
  /** Web Push keys: the public key and subject are variables, the private key a secret. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};
export type HousingOpportunity = { id: string; name: string; borough: string; closes: string; sizes: number[]; addresses: string[]; buildingKeys: string[]; url: string };
export type HousingSnapshot = { publishedAt: string | null; checkedAt: string | null; opportunities: HousingOpportunity[] };
export type HdcOpportunity = { id: string; name: string; url: string; address: string; borough: string; rent: string; bedrooms: string; age: string; accessibility: string };
export type HdcSnapshot = { results: HdcOpportunity[]; total: number; limited: boolean; checkedAt?: string };
export type HousingResponse = HousingSnapshot & { rerentals: HdcSnapshot | null };
