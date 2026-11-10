import { MARKETPLACE_NAMES, safeListingUrl } from '../src/marketplaces.mjs';
import { normalizeListing } from '../src/listings.mjs';

export function configuredFeeds(env) {
  if (!env.FREE_PARTNER_FEEDS_JSON) return [];
  let configured;
  try {
    configured = JSON.parse(env.FREE_PARTNER_FEEDS_JSON);
  } catch {
    throw new Error('The free feed configuration is invalid.');
  }
  if (!Array.isArray(configured) || configured.length > 15) {
    throw new Error('Configure up to 15 authorized free feeds.');
  }

  const ids = new Set();
  return configured.map((feed) => {
    const id = feed?.id;
    const name = Object.hasOwn(MARKETPLACE_NAMES, id) ? MARKETPLACE_NAMES[id] : feed?.name?.trim();
    const url = safeListingUrl(feed?.url);
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(id) || ['firstmover', 'housingconnect'].includes(id) || ids.has(id) || !name || !url) {
      throw new Error('A free feed is missing a unique ID, name, or HTTPS URL.');
    }
    ids.add(id);
    return { id, name: name.slice(0, 48), url, token: feed.token, kind: 'feed' };
  });
}

export async function loadFeed(feed, fetcher) {
  const headers = { Accept: 'application/json' };
  if (feed.token) headers.Authorization = `Bearer ${feed.token}`;
  const response = await fetcher(feed.url, {
    headers, redirect: 'error', signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error('Feed unavailable');
  const body = await response.json();
  const rows = Array.isArray(body) ? body : body?.listings;
  if (!Array.isArray(rows)) throw new Error('Invalid feed response');
  return {
    listings: rows.slice(0, 5000).map((row) => normalizeListing(row, feed)).filter(Boolean),
    limited: rows.length > 5000,
  };
}
