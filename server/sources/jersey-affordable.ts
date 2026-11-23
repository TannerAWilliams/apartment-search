/**
 * Jersey City's official affordable housing postings: application notices for income-restricted buildings,
 * never market-rate unit listings. The city page lists each building with the apartments it describes by
 * bedroom count; rents, eligibility and deadlines stay on the city's pages and are never inferred.
 */
import * as v from 'valibot';
import type { Bucket } from '../contracts.ts';
import { fetchPublicHtml } from './public-rentals.ts';
import type { SourceFetch } from '../contracts.ts';

export const JERSEY_AFFORDABLE = { id: 'jersey-affordable', name: 'Jersey City affordable housing' };
export const JERSEY_PAGE =
  'https://www.jerseycitynj.gov/CityHall/HousingAndDevelopment/affordable_housing/recent_affordable_housing_postings';
export const JERSEY_APPLICATION = 'https://affordablehousingjc.com/';
const KEY = 'rentals/jersey-affordable.json';
const SIZES = ['studio', 'one-bedroom', 'two-bedroom', 'three-bedroom', 'four-bedroom'] as const;
const COUNT = /(\d+|a) (studio|one-bedroom|two-bedroom|three-bedroom|four-bedroom) apartments?/gi;

const JerseyNoticeSchema = v.object({
  id: v.string(),
  name: v.string(),
  address: v.string(),
  /** Apartments described for each size: studio, 1, 2, 3 and 4 bedrooms. */
  sizes: v.pipe(v.array(v.pipe(v.number(), v.integer(), v.minValue(0))), v.length(SIZES.length)),
  total: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
export const JerseySnapshotSchema = v.object({
  /** The city's "Updated" date, as YYYY-MM-DD. */
  revision: v.pipe(v.string(), v.isoDate()),
  checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  notices: v.array(JerseyNoticeSchema),
  total: v.pipe(v.number(), v.integer(), v.minValue(0)),
  sourceUrl: v.literal(JERSEY_PAGE),
  applicationUrl: v.literal(JERSEY_APPLICATION),
});
export type JerseyNotice = v.InferOutput<typeof JerseyNoticeSchema>;
export type JerseySnapshot = v.InferOutput<typeof JerseySnapshotSchema>;

const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The apartments one notice describes by size. Throws on wording it does not recognize, rather than guess. */
function sizesOf(text: string) {
  const sizes = SIZES.map(() => 0);
  const counts = [...text.matchAll(COUNT)];
  if (!counts.length || text.replace(COUNT, '').replace(/\band\b|[,\s]/gi, '')) throw new Error('Unrecognized Jersey City bedroom counts.');
  for (const [, amount, size] of counts) {
    const index = SIZES.indexOf(size.toLowerCase() as (typeof SIZES)[number]);
    const count = amount.toLowerCase() === 'a' ? 1 : Number(amount);
    if (sizes[index] || !Number.isSafeInteger(count) || count < 1 || count > 10_000) throw new Error('Invalid Jersey City bedroom count.');
    sizes[index] = count;
  }
  return sizes;
}

/**
 * Reads the "Current Affordable Housing Postings" section. A page without it, without a revision date or
 * without recognizable notices throws: an empty or changed page is unknown, never a confirmed zero.
 */
export function parseJerseyAffordable(html: string, now = new Date()): JerseySnapshot {
  const section = html.match(
    /<h4\b[^>]*>(?:\s|<span\b[^>]*>)*Current Affordable Housing Postings(?:\s|<\/span>|<span\b[^>]*>)*<\/h4>([\s\S]*?)<\/div>/i,
  )?.[1];
  if (!section?.includes(JERSEY_APPLICATION)) throw new Error('Jersey City postings structure is unavailable.');
  const date = plain(section).match(/Updated (\d{2})-(\d{2})-(\d{4});/);
  if (!date) throw new Error('Jersey City revision is unavailable.');
  const revision = `${date[3]}-${date[1]}-${date[2]}`;
  const parsed = new Date(revision + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== revision || parsed > now)
    throw new Error('Invalid Jersey City revision.');
  const paragraphs = [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(([, body]) => plain(body))
    .filter((text) => /is located at|This building has/i.test(text));
  if (!paragraphs.length) throw new Error('No recognized Jersey City notices; empty coverage is unconfirmed.');
  const notices = paragraphs.map((text): JerseyNotice => {
    const match = text.match(/"([^"<>]{1,160})" is located at (.{1,200}?, Jersey City, NJ \d{5})\. This building has (.+?) available\./i);
    if (!match) throw new Error('Unrecognized Jersey City notice.');
    const [, name, address, counts] = match;
    const sizes = sizesOf(counts);
    return { id: address.toLowerCase(), name, address, sizes, total: sizes.reduce((sum, count) => sum + count, 0) };
  });
  if (new Set(notices.map(({ id }) => id)).size !== notices.length) throw new Error('Duplicate Jersey City notice.');
  return {
    revision,
    checkedAt: now.toISOString(),
    notices,
    total: notices.reduce((sum, { total }) => sum + total, 0),
    sourceUrl: JERSEY_PAGE,
    applicationUrl: JERSEY_APPLICATION,
  };
}

export async function loadJerseyAffordable(fetcher: SourceFetch, now = new Date()) {
  return parseJerseyAffordable(await fetchPublicHtml(fetcher, JERSEY_PAGE, 'Jersey City', 12_000), now);
}

/** The last saved postings, or null when none are saved or the saved copy is not recognized. */
export async function storedJerseyAffordable(bucket: Bucket | undefined): Promise<JerseySnapshot | null> {
  const object = await bucket?.get(KEY);
  const result = v.safeParse(JerseySnapshotSchema, await object?.json().catch(() => null));
  return result.success ? result.output : null;
}

/** Checks the city page and saves it. A failed check, or an older revision than the saved one, keeps the last good copy. */
export async function refreshJerseyAffordable(bucket: Bucket, fetcher: SourceFetch, now: Date, at: string) {
  const data = await loadJerseyAffordable(fetcher, now);
  const prior = await storedJerseyAffordable(bucket);
  if (prior && data.revision < prior.revision) throw new Error('Jersey City returned an older revision.');
  await bucket.put(KEY, JSON.stringify(data));
  return { status: 'updated', updatedAt: at, listingCount: data.notices.length };
}
