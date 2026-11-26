/**
 * What each API route accepts, as Valibot schemas. A request that does not match gets a 422 with the
 * first problem; handlers receive the typed, checked value. Search filters live in src/search.ts because
 * the app checks them too.
 */
import { CommutePlaceSchema } from '../commute-place.ts';
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
    v.object({ action: v.literal('preview-rule'), rule: v.unknown() }),
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

/** POST /api/places: what has been typed so far. */
export const PlacesRequestSchema = v.object(
  { query: v.pipe(v.string('Type a place.'), v.trim(), v.minLength(3, 'Type at least three letters.'), v.maxLength(120, 'Too long.')) },
  'Type a place.',
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

/** POST /api/settings: turn the nightly resync on or off. */
/** The account's commute destination, or null to forget it. */
export const CommutePlaceRequestSchema = v.object({ place: v.nullable(CommutePlaceSchema) }, 'Send the commute destination, or null.');
/** The account's whole list of saved listings, replacing what was stored. */
export const SavedRequestSchema = v.object(
  { listings: v.array(v.unknown(), 'Send the saved listings as a list.') },
  'Send the saved listings as a list.',
);
const EMAIL = 'Give an email address.';
/** An admin putting an account on the paid plan or back on the free one. */
export const PlanRequestSchema = v.object({
  email: v.pipe(v.string(EMAIL), v.trim(), v.email(EMAIL), v.maxLength(254, EMAIL)),
  paid: v.boolean('Say whether the account is paid.'),
});
const SETTING = 'Say whether the nightly resync or the daytime checks are on.';
const ID = 'Name the apartment.';
const listingIdSchema = v.pipe(v.string(ID), v.minLength(1, ID), v.maxLength(300, ID));
/** A note left through a shared list's link, by someone without an account. */
export const GuestNoteSchema = v.object({
  id: v.pipe(v.string('Choose an apartment.'), v.minLength(1, 'Choose an apartment.'), v.maxLength(300, 'Choose an apartment.')),
  name: v.pipe(
    v.string('Say who you are.'),
    v.trim(),
    v.minLength(1, 'Say who you are.'),
    v.maxLength(40, 'Keep your name under 40 characters.'),
  ),
  text: v.pipe(v.string('Write a note.'), v.trim(), v.minLength(1, 'Write a note.'), v.maxLength(500, 'Keep notes under 500 characters.')),
});

/** A change to the signed-in account's shared list (server/households.ts). */
export const HouseholdRequestSchema = v.variant(
  'action',
  [
    v.object({ action: v.literal('invite'), email: v.pipe(v.string(EMAIL), v.trim(), v.email(EMAIL), v.maxLength(254, EMAIL)) }),
    v.object({ action: v.literal('accept') }),
    v.object({
      action: v.literal('workplace'),
      workplace: v.nullable(
        v.object(
          {
            label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(160)),
            latitude: v.pipe(v.number(), v.minValue(-90), v.maxValue(90)),
            longitude: v.pipe(v.number(), v.minValue(-180), v.maxValue(180)),
          },
          'Give a place with its coordinates.',
        ),
      ),
    }),
    v.object({ action: v.literal('leave') }),
    v.object({ action: v.literal('link') }),
    v.object({ action: v.literal('unlink') }),
    v.object({ action: v.literal('add'), listing: v.unknown() }),
    v.object({ action: v.literal('remove'), id: listingIdSchema }),
    v.object({ action: v.literal('vote'), id: listingIdSchema, vote: v.nullable(v.picklist(['yes', 'no'], 'Vote yes or no.')) }),
    v.object({
      action: v.literal('note'),
      id: listingIdSchema,
      text: v.pipe(
        v.string('Write a note.'),
        v.trim(),
        v.minLength(1, 'Write a note.'),
        v.maxLength(500, 'Keep notes under 500 characters.'),
      ),
    }),
  ],
  'Choose a shared-list action.',
);
const NAME = 'Name a neighborhood.';
export const NeighborhoodQuerySchema = v.object({ name: v.pipe(v.string(NAME), v.trim(), v.minLength(2, NAME), v.maxLength(60, NAME)) });
/** Upgrading: Stripe Checkout for a plan, or the billing portal. */
export const BillingRequestSchema = v.variant(
  'action',
  [
    v.object({ action: v.literal('checkout'), plan: v.picklist(['monthly', 'pass'], 'Choose monthly or the three-month pass.') }),
    v.object({ action: v.literal('portal') }),
  ],
  'Choose checkout or the billing portal.',
);
/** Deleting the account must be asked for in words, so a stray request cannot do it. */
export const AccountRequestSchema = v.object(
  { action: v.literal('delete', 'Say delete.'), confirm: v.literal('DELETE', 'Type DELETE to confirm.') },
  'Type DELETE to confirm.',
);
export const SettingsRequestSchema = v.pipe(
  v.object({ nightlyResync: v.optional(v.boolean(SETTING)), daytimeChecks: v.optional(v.boolean(SETTING)) }, SETTING),
  v.check((change) => change.nightlyResync !== undefined || change.daytimeChecks !== undefined, SETTING),
);

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
