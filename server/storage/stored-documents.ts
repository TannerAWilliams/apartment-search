/**
 * Schemas for the documents the Worker saves and reads back. A document is checked when it is read, so one
 * that is damaged, or was saved by an older version of the app, is reported and treated as missing instead
 * of being trusted. Large packed data (rent charts, the FirstMover snapshot) is checked by its decoders.
 */
import * as v from 'valibot';
import type { parseFilters } from '../../src/search.ts';
import { log } from '../log.ts';

/** The document's value when it matches its schema; otherwise it is logged and read as null. */
export function checkedDocument<S extends v.GenericSchema>(schema: S, value: unknown, key: string): v.InferOutput<S> | null {
  const result = v.safeParse(schema, value);
  if (result.success) return result.output;
  log.warn('stored_document_invalid', { key, issue: result.issues[0]?.message ?? 'does not match its schema' });
  return null;
}

const text = v.string();
const optionalText = v.optional(v.string());
const optionalCount = v.optional(v.number());

/** One source's status after its last check (see SourceStatus in server/refresh.ts). */
export const SourceStatusSchema = v.looseObject({
  id: text,
  name: text,
  status: text,
  checkedAt: v.nullable(text),
  updatedAt: v.nullable(text),
  transport: optionalText,
  listingCount: optionalCount,
  pages: optionalCount,
  total: optionalCount,
  sampleLimit: optionalCount,
  partial: v.optional(v.boolean()),
  requestedPages: optionalCount,
  failedPages: optionalCount,
  month: optionalText,
  revision: optionalText,
  catalogEtag: optionalText,
  csvEtag: optionalText,
  requestTransport: v.optional(v.picklist(['direct', 'import', 'partner-feed', 'public-search', 'streeteasy-complete-export-v1'])),
  marketplace: optionalText,
  retryAt: optionalText,
  retryAttempts: optionalCount,
  error: optionalText,
});

/** The refresh status document: every source's last check, and whether a refresh is running. */
export const RefreshStateSchema = v.looseObject({
  sources: v.optional(v.array(SourceStatusSchema)),
  running: v.optional(v.boolean()),
  startedAt: optionalText,
  lastCheckedAt: optionalText,
  market: v.optional(v.nullable(v.object({ revision: optionalText, catalogEtag: optionalText, csvEtag: optionalText }))),
  activeSource: v.optional(v.nullable(text)),
});

const HousingOpportunitySchema = v.object({
  id: text,
  name: text,
  borough: text,
  closes: text,
  sizes: v.array(v.number()),
  addresses: v.array(text),
  buildingKeys: v.array(text),
  url: text,
});
/** NYC Housing Connect's open lotteries, as saved (the check time is kept in the document's metadata). */
export const StoredHousingSchema = v.object({ publishedAt: v.nullable(text), opportunities: v.array(HousingOpportunitySchema) });

const HdcOpportunitySchema = v.object({
  id: text,
  name: text,
  url: text,
  address: text,
  borough: text,
  rent: text,
  bedrooms: text,
  age: text,
  accessibility: text,
});
/** NYC HDC re-rentals, as saved. */
export const HdcSnapshotSchema = v.object({
  results: v.array(HdcOpportunitySchema),
  total: v.number(),
  limited: v.boolean(),
  checkedAt: optionalText,
});

export type StoredHousing = v.InferOutput<typeof StoredHousingSchema>;
export type HdcSnapshot = v.InferOutput<typeof HdcSnapshotSchema>;

/** A saved-search alert rule. Its filters are run through parseFilters again when the rule is checked. */
export const AlertRulesSchema = v.array(
  v.object({
    id: text,
    name: text,
    filters: v.custom<ReturnType<typeof parseFilters>>((value) => typeof value === 'object' && value !== null),
    createdAt: text,
  }),
);
/** A device that turned on notifications. */
export const AlertDevicesSchema = v.array(
  v.object({ endpoint: text, keys: v.object({ p256dh: text, auth: text }), label: text, createdAt: text }),
);
/** The most recent alerts sent. */
export const RecentAlertsSchema = v.array(
  v.object({ id: text, at: text, ruleId: text, title: text, lines: v.array(text), newCount: v.number(), dropCount: v.number() }),
);
