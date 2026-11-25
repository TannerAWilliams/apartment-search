/**
 * A neighborhood at a glance, for its page: how many apartments are listed and the median rent by size, what is
 * known about its buildings, and its 311 complaints over the last year (noise, heat and hot water, rodents) in
 * the ZIP code where most of its listings are. 311 figures come from NYC Open Data and are kept for a week.
 */
import * as v from 'valibot';
import type { ListingData } from '../src/domain.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { buildingGrade } from '../src/insights.ts';
import { parseFilters } from '../src/search.ts';
import { readRows } from './building-records.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { offline, search } from './search.ts';
import { checkedDocument } from './storage/stored-documents.ts';

/** The 311 complaint types counted, by the label shown for them. */
export const COMPLAINT_GROUPS: [string, RegExp][] = [
  ['Noise', /^noise/i],
  ['Heat and hot water', /heat|hot water/i],
  ['Rodents', /rodent/i],
  ['Building conditions', /^(?:plumbing|paint|water leak|door|unsanitary|general construction|electric|flooring|safety)/i],
];
const CACHE_DAYS = 7;
const ComplaintsSchema = v.object({ zip: v.string(), checkedAt: v.string(), counts: v.record(v.string(), v.number()) });

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Rents, sizes and buildings of a neighborhood's listings. */
export function summarizeNeighborhood(listings: ListingData[]) {
  const sizes = [0, 1, 2, 3, 4].map((bedrooms) => {
    const rents = listings.filter((listing) => Math.min(4, listing.bedrooms) === bedrooms).map(({ rent }) => rent);
    return { bedrooms, count: rents.length, median: rents.length ? median(rents) : null };
  });
  const zips = new Map<string, number>();
  for (const { zip } of listings) if (zip) zips.set(zip, (zips.get(zip) ?? 0) + 1);
  const buildings = new Map<string, ListingData['building']>();
  for (const listing of listings) if (listing.building) buildings.set(listing.address + '|' + listing.zip, listing.building);
  const known = [...buildings.values()];
  const grades = { A: 0, B: 0, C: 0, D: 0 };
  for (const facts of known) {
    const grade = buildingGrade(facts);
    if (grade) grades[grade]++;
  }
  return {
    listings: listings.length,
    borough: listings[0]?.city ?? null,
    zips: [...zips].sort((a, b) => b[1] - a[1]).map(([zip]) => zip),
    sizes,
    buildings: { known: known.length, stabilized: known.filter((facts) => facts?.stabilized).length, grades },
  };
}

/** A ZIP code's 311 complaints over the last year, by group, from storage when checked within a week. */
export async function zipComplaints(bucket: Bucket | undefined, zip: string, fetcher: FetchTransport, now = new Date()) {
  const key = `areas/311/${zip}.json`;
  const stored = bucket ? await bucket.get(key) : null;
  const cached = stored && checkedDocument(ComplaintsSchema, await stored.json().catch(() => null), key);
  if (cached && Date.parse(cached.checkedAt) > now.getTime() - CACHE_DAYS * 86_400_000) return cached;
  const since = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00';
  const rows = await readRows(
    'erm2-nwe9',
    {
      $select: 'complaint_type,count(*) as count',
      $where: `incident_zip='${zip}' AND created_date >= '${since}'`,
      $group: 'complaint_type',
      $limit: '500',
    },
    fetcher,
    AbortSignal.timeout(20_000),
  );
  const counts: Record<string, number> = Object.fromEntries(COMPLAINT_GROUPS.map(([label]) => [label, 0]));
  for (const row of rows) {
    const type = typeof row.complaint_type === 'string' ? row.complaint_type : '';
    const count = Number(row.count);
    const group = COMPLAINT_GROUPS.find(([, pattern]) => pattern.test(type));
    if (group && Number.isFinite(count)) counts[group[0]] += count;
  }
  const result = { zip, checkedAt: now.toISOString(), counts };
  if (bucket) await bucket.put(key, JSON.stringify(result));
  return result;
}

/** The neighborhood's page: its listings summarized, and 311 complaints where they can be read. */
export async function neighborhoodReport(env: AppEnv, name: string, fetcher: FetchTransport) {
  const filters = parseFilters({ region: 'nyc', bedrooms: null, maxRent: null, neighborhood: name });
  const { matches } = await search(filters, env, offline, true, { kept: true });
  const summary = summarizeNeighborhood(matches);
  let complaints = null;
  if (summary.zips[0]) {
    try {
      complaints = await zipComplaints(env.BUCKET, summary.zips[0], fetcher);
    } catch (cause) {
      log.warn('neighborhood_311_failed', { zip: summary.zips[0], message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { name, ...summary, complaints };
}
