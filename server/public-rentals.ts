import type { ListingData } from '../src/domain.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { mergeListings } from '../src/listings.ts';

export const MAX_PUBLIC_HTML_BYTES = 5 * 1024 * 1024;

/** Parse an embedded JSON assignment without depending on its script wrapper or executing it. */
export function assignedJson(html: string, assignment: RegExp): unknown {
  const match = assignment.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  if (html[start] !== '{') return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return JSON.parse(html.slice(start, index + 1));
  }
  return null;
}

export function publicListingUrl(value: unknown, origin: string, pathPattern: RegExp) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.username && !url.password && pathPattern.test(url.pathname) ?
      origin + url.pathname : null;
  } catch {
    return null;
  }
}

export async function fetchPublicHtml(fetcher: FetchTransport, url: string, name: string, timeout = 9000) {
  const response = await fetcher(url, {
    headers: { Accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(name + ' returned HTTP ' + response.status + '.');
  if (!response.headers.get('content-type')?.includes('text/html') || !response.body ||
      Number(response.headers.get('content-length')) > MAX_PUBLIC_HTML_BYTES) {
    throw new Error(name + ' did not return a supported rental page.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return html + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_PUBLIC_HTML_BYTES) {
      await reader.cancel();
      throw new Error(name + ' returned a rental page that was too large.');
    }
    html += decoder.decode(value, { stream: true });
  }
}

/**
 * The schema.org fields listing pages publish as JSON-LD, as this app reads them. Parsers still check
 * each value, and normalizeListing validates every field it keeps.
 */
export type SchemaThing = {
  '@type'?: string; '@graph'?: SchemaThing[]; url?: string; name?: string; description?: string;
  mainEntity?: SchemaThing; itemListElement?: { item?: SchemaThing }[];
  address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string };
  geo?: { latitude?: unknown; longitude?: unknown };
  offers?: { '@type'?: string; price?: unknown; lowPrice?: unknown; highPrice?: unknown; priceCurrency?: string; availability?: string };
  potentialAction?: { '@type'?: string };
  numberOfBedrooms?: unknown;
};

export function jsonLd(html: string): (SchemaThing | null)[] {
  return [...html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map(([, json]) => JSON.parse(json) as SchemaThing | null);
}

export async function loadPublicPages<P extends { url: string }>(source: { name: string }, pages: P[], parser: (html: string, page: P, checkedAt: string) => ListingData[], fetcher: FetchTransport = fetch, now = new Date()) {
  const listings: ListingData[] = [];
  const failures: unknown[] = [];
  let completedPages = 0;
  const checkedAt = now.toISOString();
  for (let index = 0; index < pages.length; index += 3) {
    const batch = await Promise.allSettled(pages.slice(index, index + 3).map(async (page) => {
      const html = await fetchPublicHtml(fetcher, page.url, source.name);
      return parser(html, page, checkedAt);
    }));
    for (const result of batch) {
      if (result.status === 'fulfilled') { completedPages++; listings.push(...result.value); }
      else failures.push(result.reason);
    }
  }
  const unique = deduplicatePublicRentals(listings);
  if (!unique.length) throw failures[0] ?? new Error(source.name + ' returned no supported apartment listings.');
  return { listings: unique, pages: completedPages,
    ...(failures.length ? { partial: true, requestedPages: pages.length, failedPages: failures.length } : {}) };
}

export function deduplicatePublicRentals(rows: ListingData[]) {
  return mergeListings([...new Map(rows.map((listing) => [listing.id, listing])).values()]);
}
