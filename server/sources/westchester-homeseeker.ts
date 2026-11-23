/**
 * Westchester County's HomeSeeker: the county's official list of affordable rental opportunities (lotteries,
 * waitlists and first-come rentals), with each building's address and its application and lottery dates.
 * Eligibility, rents and units stay on the county's listing pages and are never inferred. The page embeds
 * its photos, so it is read whole, up to a size limit, and only the rentals tab is kept.
 */
import * as v from 'valibot';
import type { Bucket } from '../contracts.ts';
import type { SourceFetch } from '../refresh.ts';

export const WESTCHESTER_HOMESEEKER = { id: 'westchester-homeseeker', name: 'Westchester HomeSeeker' };
export const HOMESEEKER_ORIGIN = 'https://homeseeker.westchestergov.com';
const PAGE = HOMESEEKER_ORIGIN + '/Listings';
const KEY = 'rentals/westchester-homeseeker.json';
/** The page was 9.8 MB in November 2026, nearly all of it embedded photos. */
const MAX_BYTES = 24 * 1024 * 1024;

const WhenSchema = v.nullable(v.pipe(v.string(), v.isoTimestamp()));
const OpportunitySchema = v.object({
  id: v.pipe(v.string(), v.regex(/^\d{1,12}$/)),
  name: v.string(),
  /** The county's location line, such as "229 Willett Ave Port Chester NY 10573". */
  location: v.string(),
  zip: v.pipe(v.string(), v.regex(/^\d{5}$/)),
  /** As the county states them, in New York time; null where it says N/A. */
  applicationStart: WhenSchema,
  applicationEnd: WhenSchema,
  lottery: WhenSchema,
  url: v.string(),
});
export const HomeSeekerSnapshotSchema = v.object({
  checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  opportunities: v.array(OpportunitySchema),
  sourceUrl: v.literal(PAGE),
});
export type HomeSeekerOpportunity = v.InferOutput<typeof OpportunitySchema>;
export type HomeSeekerSnapshot = v.InferOutput<typeof HomeSeekerSnapshotSchema>;

const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** "07/30/2026 9:00 AM" in New York time, as an ISO timestamp, or null for "N/A". Throws on anything else. */
export function homeSeekerTime(text: string | undefined) {
  if (!text || /^N\/A$/i.test(text)) return null;
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/);
  if (!match) throw new Error('Westchester HomeSeeker listed a date it did not recognize.');
  const [, month, day, year, hour, minute, half] = match;
  const hours = (Number(hour) % 12) + (half === 'PM' ? 12 : 0);
  // New York is UTC-4 in summer and UTC-5 in winter: take the offset Intl gives for that day.
  // New York is UTC-4 in summer and UTC-5 in winter: try both and keep the one that reads back as stated.
  const stated = `${year}-${month}-${day} ${String(hours).padStart(2, '0')}:${minute}`;
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const at = [4, 5]
    .map((offset) => new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hours + offset, Number(minute))))
    .find((candidate) => local.format(candidate).replace(',', '') === stated);
  if (!at) throw new Error('Westchester HomeSeeker listed a date it did not recognize.');
  return at.toISOString();
}

/**
 * The rental opportunities on the listings page. Throws when the page is not recognizable or a card is not
 * fully described: an empty or changed page is unknown, never a confirmed zero.
 */
export function parseHomeSeeker(html: string, now = new Date()): HomeSeekerSnapshot {
  const slim = html.replace(/src="data:[^"]*"/g, 'src=""');
  const start = slim.indexOf('id="listings-rentals-tab-pane"');
  const end = slim.indexOf('id="listings-sales-tab-pane"');
  if (start < 0 || end < start) throw new Error('Westchester HomeSeeker did not return a recognized listings page.');
  const rentals = slim.slice(start, end);
  const cards = rentals.split(/<div class="card mt-8 h-100">/).slice(1);
  if (!cards.length) throw new Error('Westchester HomeSeeker listed no rentals; empty coverage is unconfirmed.');
  const opportunities = cards.map((card): HomeSeekerOpportunity => {
    const id = card.match(/href="\/Listings\/Details\?listingId=(\d{1,12})"/)?.[1];
    const name = plain(card.match(/<h5 class="card-title[^"]*">([\s\S]*?)<\/h5>/)?.[1] ?? '');
    const location = plain(card.match(/fa-location-dot"><\/i>([\s\S]*?)<\/p>/)?.[1] ?? '');
    const zip = location.match(/ NY (\d{5})$/)?.[1];
    const date = (label: string) => plain(card.match(new RegExp(label + ':\\s*([^<]+)<'))?.[1] ?? '');
    if (!id || !name || !zip) throw new Error('Westchester HomeSeeker listed an opportunity it did not fully describe.');
    return {
      id,
      name,
      location,
      zip,
      applicationStart: homeSeekerTime(date('Application Start Date')),
      applicationEnd: homeSeekerTime(date('Application End Date')),
      lottery: homeSeekerTime(date('Lottery Date/Time')),
      url: `${HOMESEEKER_ORIGIN}/Listings/Details?listingId=${id}`,
    };
  });
  if (new Set(opportunities.map(({ id }) => id)).size !== opportunities.length)
    throw new Error('Duplicate Westchester HomeSeeker listing.');
  return { checkedAt: now.toISOString(), opportunities, sourceUrl: PAGE };
}

/** Reads the page up to MAX_BYTES, so an unexpectedly huge page is refused rather than held in memory. */
async function fetchPage(fetcher: SourceFetch) {
  const response = await fetcher(PAGE, { headers: { Accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw Object.assign(new Error('Westchester HomeSeeker returned HTTP ' + response.status + '.'), { httpStatus: response.status });
  if (!response.headers.get('content-type')?.includes('text/html') || !response.body)
    throw new Error('Westchester HomeSeeker did not return a listings page.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return html + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Westchester HomeSeeker returned a page that was too large.');
    }
    html += decoder.decode(value, { stream: true });
  }
}

export async function loadHomeSeeker(fetcher: SourceFetch, now = new Date()) {
  return parseHomeSeeker(await fetchPage(fetcher), now);
}

/** The last saved opportunities, or null when none are saved or the saved copy is not recognized. */
export async function storedHomeSeeker(bucket: Bucket | undefined): Promise<HomeSeekerSnapshot | null> {
  const object = await bucket?.get(KEY);
  const result = v.safeParse(HomeSeekerSnapshotSchema, await object?.json().catch(() => null));
  return result.success ? result.output : null;
}

/** Checks the county's page and saves it; a failed check keeps the last good copy. */
export async function refreshHomeSeeker(bucket: Bucket, fetcher: SourceFetch, now: Date, at: string) {
  const data = await loadHomeSeeker(fetcher, now);
  await bucket.put(KEY, JSON.stringify(data));
  return { status: 'updated', updatedAt: at, listingCount: data.opportunities.length };
}
