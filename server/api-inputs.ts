/**
 * What each API route accepts, as Valibot schemas. A request that does not match gets a 422 with the
 * first problem; handlers receive the typed, checked value. Search filters live in src/search.ts because
 * the app checks them too.
 */
import * as v from 'valibot';
import { RENT_GROUPINGS } from '../src/market.ts';
import { REGIONS } from '../src/regions.ts';
import { VITAL_NAMES } from '../src/web-vitals-report.ts';

/** GET /api/market */
export const MarketQuery = v.object({
  region: v.optional(v.picklist(Object.keys(REGIONS), 'Choose a valid region and grouping.'), 'all'),
  grouping: v.optional(v.picklist(Object.keys(RENT_GROUPINGS), 'Choose a valid region and grouping.'), 'neighborhood'),
});

/** GET /api/dashboard: the catalog, or one file from it. */
export const DashboardQuery = v.object({ file: v.optional(v.string()) });

/** One Core Web Vitals measurement. A report's invalid measurements are skipped, not refused. */
export const VitalMetric = v.object({
  name: v.picklist(VITAL_NAMES),
  value: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(600_000)),
  rating: v.picklist(['good', 'needs-improvement', 'poor']),
  navigationType: v.fallback(v.optional(v.pipe(v.string(), v.transform((type) => type.slice(0, 20)))), undefined),
});

/** POST /api/vitals: the open tab and up to one of each measurement. */
export const VitalsReport = v.object({
  page: v.fallback(v.pipe(v.string(), v.regex(/^[a-z-]{1,20}$/)), 'other'),
  metrics: v.fallback(v.array(v.unknown()), []),
}, 'Send Core Web Vitals measurements.');

/** A check the app asks for: every source, or one. Anyone may send this to a public app. */
export const RefreshCheck = v.strictObject({
  check: v.literal('now'),
  source: v.optional(v.string('Unknown or disconnected refresh source.')),
  /** Sent by pages loaded before the app stopped checking on open; nothing is fetched. */
  sessionStart: v.optional(v.boolean()),
}, 'Public refresh cannot import listing data.');

/** Saved inventory uploaded by a script with the app token, such as the StreetEasy home sync. */
export const SourceImport = v.object({
  payload: v.string('Send a valid compressed source import.'),
  source: v.optional(v.literal('streeteasy-live', 'Unknown refresh source.')),
  /** Use the upload only for sources whose own check failed. */
  fallback: v.optional(v.boolean()),
});

/** POST /api/refresh */
export const RefreshRequest = v.union([v.object(RefreshCheck.entries), SourceImport], 'Send a source check or a valid compressed source import.');

/** POST /api/alerts: the details of each action are checked by server/alerts.ts. */
export const AlertRequest = v.variant('action', [
  v.object({ action: v.literal('add-rule'), rule: v.unknown() }),
  v.object({ action: v.literal('delete-rule'), id: v.string('Choose an alert to remove.') }),
  v.object({ action: v.literal('add-device'), subscription: v.unknown(), label: v.optional(v.string()) }),
  v.object({ action: v.literal('remove-device'), endpoint: v.string('Choose a device to remove.') }),
  v.object({ action: v.literal('test') }),
], 'Unknown alert action.');

/** POST /api/geocode */
export const GeocodeRequest = v.object({
  address: v.pipe(v.string('Enter a full street address with city, state and ZIP.'), v.check((address) => address.trim().length >= 4 && address.length <= 160,
    'Enter a full street address with city, state and ZIP.')),
}, 'Enter a full street address with city, state and ZIP.');

/** POST /api/building-report: whether this is one exact NYC building is decided by server/building-records.ts. */
export const BuildingAddress = v.object({
  address: v.optional(v.string()), city: v.optional(v.string()), county: v.optional(v.string()),
  state: v.optional(v.string()), zip: v.optional(v.string()),
}, 'Send the building’s street address and ZIP.');
