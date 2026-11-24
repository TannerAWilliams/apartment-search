/**
 * Building facts kept from official records, so listing cards can show a building's grade and whether it registers
 * rent-stabilized units without asking the city again. A building is recorded when someone opens its records in
 * Details, and the sync Workflow checks a few more listed New York City buildings each night.
 */
import * as v from 'valibot';
import type { BuildingFacts } from '../src/insights.ts';
import type { ListingData } from '../src/domain.ts';
import { buildingKey } from '../src/listings.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { parseFilters } from '../src/search.ts';
import { retrieveBuildingRecords } from './building-records.ts';
import { checkedDocument } from './storage/stored-documents.ts';

const FACTS_KEY = 'buildings/facts.json';
/** The most buildings kept; the oldest checks are dropped first. */
export const MAX_BUILDINGS = 12_000;
/** A building's facts are checked again after this long. */
const STALE_AFTER_DAYS = 90;
const nullable = <T extends v.GenericSchema>(schema: T) => v.nullable(schema);
const FactsSchema = v.record(
  v.string(),
  v.object({
    stabilized: nullable(v.boolean()),
    openViolations: nullable(v.number()),
    complaints: nullable(v.number()),
    bedbugs: nullable(v.boolean()),
    flood: nullable(v.boolean()),
    checkedAt: v.string(),
  }),
);

export async function readBuildingFacts(bucket: Bucket): Promise<Record<string, BuildingFacts>> {
  const object = await bucket.get(FACTS_KEY);
  return (object && checkedDocument(FactsSchema, await object.json().catch(() => null), FACTS_KEY)) ?? {};
}

async function writeBuildingFacts(bucket: Bucket, facts: Record<string, BuildingFacts>) {
  const kept = Object.entries(facts)
    .sort(([, a], [, b]) => b.checkedAt.localeCompare(a.checkedAt))
    .slice(0, MAX_BUILDINGS);
  await bucket.put(FACTS_KEY, JSON.stringify(Object.fromEntries(kept)));
}

type Report = Awaited<ReturnType<typeof retrieveBuildingRecords>>;

/** What a building report says, kept short; null when it found no building to describe. */
export function summarizeReport(report: Report): BuildingFacts | null {
  if (report.status !== 'matched' && report.status !== 'partial') return null;
  const bedbugs = report.bedbugs as { infested?: number; reinfested?: number } | null;
  const flood = 'flood' in report ? (report.flood as { intersects?: boolean } | null) : null;
  return {
    stabilized: report.rentRegistration ? report.rentRegistration.matched : null,
    openViolations: report.openViolations,
    complaints: report.complaintsLast365Days,
    bedbugs: bedbugs ? Boolean(bedbugs.infested || bedbugs.reinfested) : null,
    flood: flood ? flood.intersects === true : null,
    checkedAt: report.checkedAt,
  };
}

/** Keeps one building's facts from a report someone just opened. */
export async function recordBuildingReport(bucket: Bucket, address: Pick<ListingData, 'address' | 'state' | 'zip'>, report: Report) {
  const key = buildingKey(address);
  const facts = summarizeReport(report);
  if (!key || !facts) return;
  await writeBuildingFacts(bucket, { ...(await readBuildingFacts(bucket)), [key]: facts });
}

/**
 * Checks up to `limit` listed New York City buildings whose facts are missing or old, one at a time, and keeps
 * what was found. Returns how many were checked.
 */
export async function fillBuildingFacts(
  bucket: Bucket,
  listings: ListingData[],
  fetcher: FetchTransport,
  { limit = 40, now = new Date() }: { limit?: number; now?: Date } = {},
) {
  const facts = await readBuildingFacts(bucket);
  const staleBefore = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString();
  const wanted = new Map<string, ListingData>();
  for (const listing of listings) {
    const key = buildingKey(listing);
    if (listing.region !== 'nyc' || !key || wanted.has(key)) continue;
    if (facts[key] && facts[key].checkedAt >= staleBefore) continue;
    wanted.set(key, listing);
    if (wanted.size >= limit) break;
  }
  let checked = 0;
  for (const [key, listing] of wanted) {
    // A report never throws: an unreachable city service reads as an unmatched building, checked again later.
    const summary = summarizeReport(await retrieveBuildingRecords(listing, fetcher, now));
    // A building the city has no unique record for is remembered too, so it is not asked about every night.
    facts[key] = summary ?? {
      stabilized: null,
      openViolations: null,
      complaints: null,
      bedbugs: null,
      flood: null,
      checkedAt: now.toISOString(),
    };
    checked++;
  }
  if (checked) await writeBuildingFacts(bucket, facts);
  return checked;
}

/** Checks the next listed New York City buildings from saved inventory (see fillBuildingFacts). */
export async function fillBuildingFactsFromInventory(env: AppEnv & { BUCKET: Bucket }, fetcher: FetchTransport, limit = 40) {
  const { search, offline } = await import('./search.ts');
  const filters = parseFilters({ region: 'nyc', bedrooms: null, maxRent: null });
  const { matches } = await search(filters, env, offline, true);
  return fillBuildingFacts(env.BUCKET, matches, fetcher, { limit });
}
