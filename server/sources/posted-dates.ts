/**
 * Listing sites' own posting dates from a search page's structured data (schema.org RealEstateListing, which Trulia
 * and Zumper publish for search engines): each listing's link, and the date the site says it was posted.
 */
import { isRecord } from '../../src/domain.ts';

/** A link's path, without case or a trailing slash, so the same listing matches however it is written. */
export const pathKey = (url: unknown) => {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url, 'https://example.com').pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
};

/** Each listing's posting date on the page, by the path of its link. */
export function postedDates(html: string) {
  const dates = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isRecord(value)) return;
    if (value['@type'] === 'RealEstateListing' && typeof value.datePosted === 'string') {
      const offers = Array.isArray(value.offers) ? value.offers : [value.offers];
      for (const url of [value.url, value['@id'], ...offers.map((offer) => (isRecord(offer) ? offer.url : null))]) {
        const key = pathKey(url);
        if (key && !dates.has(key)) dates.set(key, value.datePosted);
      }
      return;
    }
    Object.values(value).forEach(visit);
  };
  for (const [, body] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      visit(JSON.parse(body!));
    } catch {
      // A malformed block is skipped; the listings simply have no posting date.
    }
  }
  return dates;
}
