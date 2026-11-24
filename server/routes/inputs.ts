/**
 * What each API route accepts, as Valibot schemas. A request that does not match gets a 422 with the
 * first problem; handlers receive the typed, checked value. Search filters live in src/search.ts because
 * the app checks them too.
 */
import * as v from 'valibot';
import { RENT_GROUPINGS } from '../../src/market.ts';
import { REGIONS } from '../../src/regions.ts';
import { VITAL_NAMES } from '../../src/web-vitals-report.ts';
import { DASHBOARD_FILES } from '../../src/dashboard-data.ts';

/** GET /api/market */
const REGION_AND_GROUPING = 'Choose a valid region and grouping.';
export const MarketQuerySchema = v.object({
  region: v.optional(v.picklist(Object.keys(REGIONS), REGION_AND_GROUPING), 'all'),
  grouping: v.optional(v.picklist(Object.keys(RENT_GROUPINGS), REGION_AND_GROUPING), 'neighborhood'),
});

/** A month as YYYY-MM. */
const MonthSchema = v.pipe(v.string(), v.regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/, 'Use months written as YYYY-MM.'));
/** Comma-separated values: at least one, at most `max`, no repeats. */
const list = <T extends v.GenericSchema<string, unknown>>(item: T, max: number, message: string) =>
  v.pipe(
    v.string(),
    v.transform((text) => text.split(',')),
    v.array(item),
    v.minLength(1, message),
    v.maxLength(max, message),
    v.check((items) => new Set(items).size === items.length, message),
  );
const SeriesNameSchema = v.picklist(DASHBOARD_FILES, 'Choose series from the market history catalog.');
const AreaIdSchema = v.pipe(
  v.string(),
  v.regex(/^\d{1,4}$/, 'Choose areas from the market history catalog.'),
  v.transform(Number),
  v.integer(),
  v.minValue(1, 'Choose areas from the market history catalog.'),
  v.maxValue(9999, 'Choose areas from the market history catalog.'),
);

/** GET /api/history/values: up to six series for up to eight areas, over a range of months. */
export const HistoryValuesQuerySchema = v.pipe(
  v.object({
    series: list(SeriesNameSchema, 6, 'Choose one to six series from the market history catalog.'),
    areas: list(AreaIdSchema, 8, 'Choose one to eight areas from the market history catalog.'),
    from: MonthSchema,
    to: MonthSchema,
  }),
  v.check(({ from, to }) => from <= to, 'The first month must not be after the last.'),
);

/** GET /api/history/month: every area's value for one series in one month. */
export const HistoryMonthQuerySchema = v.object({ series: SeriesNameSchema, month: MonthSchema });

/** One Core Web Vitals measurement. A report's invalid measurements are skipped, not refused. */
export const VitalMetricSchema = v.object({
  name: v.picklist(VITAL_NAMES),
  value: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(600_000)),
  rating: v.picklist(['good', 'needs-improvement', 'poor']),
  /** Kept when it is text, cut to 20 characters; anything else is dropped. */
  navigationType: v.fallback(
    v.optional(
      v.pipe(
        v.string(),
        v.transform((type) => type.slice(0, 20)),
      ),
    ),
    undefined,
  ),
});

/** POST /api/vitals: the open tab and up to one of each measurement. */
export const VitalsReportSchema = v.object(
  {
    page: v.fallback(v.pipe(v.string(), v.regex(/^[a-z-]{1,20}$/)), 'other'),
    metrics: v.fallback(v.array(v.unknown()), []),
  },
  'Send Core Web Vitals measurements.',
);

/** A check the app asks for: every source, or one. Anyone may send this to a public app. */
export const RefreshCheckSchema = v.strictObject(
  {
    check: v.literal('now'),
    source: v.optional(v.string('Unknown or disconnected refresh source.')),
    /** Sent by pages loaded before the app stopped checking on open; nothing is fetched. */
    sessionStart: v.optional(v.boolean()),
  },
  'Public refresh cannot import listing data.',
);

/** Saved inventory uploaded by a script with the app token, such as the StreetEasy home sync. */
const SourceImportSchema = v.object({
  payload: v.string('Send a valid compressed source import.'),
  source: v.optional(v.literal('streeteasy-live', 'Unknown refresh source.')),
  /** Use the upload only for sources whose own check failed. */
  fallback: v.optional(v.boolean()),
});

/** POST /api/refresh */
export const RefreshRequestSchema = v.union(
  [v.object(RefreshCheckSchema.entries), SourceImportSchema],
  'Send a source check or a valid compressed source import.',
);

/** POST /api/alerts: the details of each action are checked by server/alerts.ts. */
export const AlertRequestSchema = v.variant(
  'action',
  [
    v.object({ action: v.literal('add-rule'), rule: v.unknown() }),
    v.object({ action: v.literal('delete-rule'), id: v.string('Choose an alert to remove.') }),
    v.object({ action: v.literal('add-device'), subscription: v.unknown(), label: v.optional(v.string()) }),
    v.object({ action: v.literal('remove-device'), endpoint: v.string('Choose a device to remove.') }),
    v.object({ action: v.literal('test') }),
  ],
  'Unknown alert action.',
);

/** POST /api/geocode */
const FULL_ADDRESS = 'Enter an address or place name of 4 to 160 characters.';
export const GeocodeRequestSchema = v.object(
  {
    address: v.pipe(
      v.string(FULL_ADDRESS),
      v.check((address) => address.trim().length >= 4 && address.length <= 160, FULL_ADDRESS),
    ),
  },
  FULL_ADDRESS,
);

/** POST /api/building-report: whether this is one exact NYC building is decided by server/building-records.ts. */
/** A point for a Street View image, rounded to about a meter so cards in one building share a browser-cached image. */
const coordinate = (min: number, max: number) =>
  v.pipe(
    v.string('Give a latitude and longitude.'),
    v.transform(Number),
    v.number('Give a latitude and longitude.'),
    v.minValue(min, 'Give a latitude and longitude.'),
    v.maxValue(max, 'Give a latitude and longitude.'),
    v.transform((value) => Math.round(value * 1e5) / 1e5),
  );
export const StreetViewQuerySchema = v.object({ lat: coordinate(-90, 90), lng: coordinate(-180, 180) });

export const BuildingAddressSchema = v.object(
  {
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    county: v.optional(v.string()),
    state: v.optional(v.string()),
    zip: v.optional(v.string()),
  },
  'Send the building’s street address and ZIP.',
);
