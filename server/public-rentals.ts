import type { ListingData } from '../src/domain.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { mergeListings } from '../src/listings.ts';

const MAX_HTML_BYTES = 5 * 1024 * 1024;

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

export async function fetchPublicHtml(fetcher: FetchTransport, url: string, name: string) {
  const response = await fetcher(url, {
    headers: { Accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(name + ' returned HTTP ' + response.status + '.');
  if (!response.headers.get('content-type')?.includes('text/html') || !response.body ||
      Number(response.headers.get('content-length')) > MAX_HTML_BYTES) {
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
    if (bytes > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error(name + ' returned a rental page that was too large.');
    }
    html += decoder.decode(value, { stream: true });
  }
}

export function jsonLd(html: string) {
  return [...html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map(([, json]) => JSON.parse(json));
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
