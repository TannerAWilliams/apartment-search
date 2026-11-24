import type { D1Database } from './storage/d1-bucket.ts';
import type { HdcSnapshot, StoredHousing } from './storage/stored-documents.ts';
import type { JerseySnapshot } from './sources/jersey-affordable.ts';
import type { HomeSeekerSnapshot } from './sources/westchester-homeseeker.ts';
/** How the server fetches a source: the global fetch, or a stand-in in tests and the home sync. */
export type SourceFetch = (url: string, options?: RequestInit) => Response | Promise<Response>;
/** Shared storage contract, including metadata-only object heads. */
export type BucketHead = { etag: string; customMetadata: Record<string, string> };
export type BucketObject = BucketHead & { arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; json<T = unknown>(): Promise<T> };
/** A source's latest check: its summary (counts, transport, when), its listings and its units' price history. */
export type ListingSnapshot = { summary: Record<string, unknown>; listings: unknown[]; history: unknown[] };
/**
 * Narrows the listings read back to those a search can match: in the region (as regionOf() gives it) and at
 * or under the rent. Listings without a region or rent are always returned, so the search decides about them.
 */
export type SnapshotFilter = { region?: string; maxRent?: number; history?: boolean };
export type SnapshotStore = {
  head(key: string): Promise<{ etag: string } | null>;
  /** The snapshot, with `saved`, how many listings it holds before the filter. Price history only when asked for. */
  read(key: string, filter?: SnapshotFilter): Promise<(ListingSnapshot & { etag: string; saved: number }) | null>;
  /** Replaces the snapshot in one transaction; null when onlyIf does not hold. */
  write(
    key: string,
    snapshot: ListingSnapshot,
    onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string },
  ): Promise<{ etag: string } | null>;
};
export type Bucket = {
  get(key: string): Promise<BucketObject | null>;
  head(key: string): Promise<BucketHead | null>;
  put(
    key: string,
    body: string | Uint8Array,
    options?: { customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } },
  ): Promise<{ etag: string } | null>;
  /** Listing snapshots: one row per listing and per unit's price history in D1. */
  snapshots: SnapshotStore;
  /** The D1 database itself, for the tables that are not documents (market history); absent in memory stores. */
  database?: D1Database;
};
export type AppEnv = {
  BUCKET?: Bucket;
  PUBLIC_APP?: string;
  APP_ACCESS_TOKEN?: string;
  /** Set when email-code sign-in is on (server/auth.ts). */
  BETTER_AUTH_SECRET?: string;
  FREE_PARTNER_FEEDS_JSON?: string;
  STREETEASY_SYNC_ENABLED?: string;
  STREETEASY_PUBLIC_SEARCH?: string;
  /** Google Maps key for Street View images on listing cards (a secret); see server/street-view.ts. */
  GOOGLE_MAPS_API_KEY?: string;
  /** The most Street View images to request in a month; 9,000 when unset. */
  STREET_VIEW_MONTHLY_LIMIT?: string;
  TRAVELTIME_APP_ID?: string;
  TRAVELTIME_API_KEY?: string;
  /** Who may sign in: comma-separated email addresses. */
  ACCESS_ALLOWED_EMAILS?: string;
  /** Who may resync and change platform settings (server/roles.ts); the first allowed address when unset. */
  ADMIN_EMAILS?: string;
  /** Accounts on the paid plan besides those an admin marks paid (server/plans.ts). */
  PAID_EMAILS?: string;
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
/** NYC Housing Connect's open lotteries, with the time they were last checked. */
export type HousingSnapshot = StoredHousing & { checkedAt: string | null };
export type { HdcSnapshot };
export type HousingResponse = HousingSnapshot & {
  rerentals: HdcSnapshot | null;
  jersey: JerseySnapshot | null;
  westchester?: HomeSeekerSnapshot | null;
};
