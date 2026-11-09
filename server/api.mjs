import { parseFilters, SearchInputError } from '../src/search.mjs';
import { localSearch, snapshotSearch, SNAPSHOT_MONTH } from '../src/market.mjs';
import { mergeListings } from '../src/listings.mjs';
import { configuredFeeds, loadFeed } from './listings.mjs';
import { geocodeAddress, resolveWorkplace } from './commute.mjs';

const REQUEST_LIMIT = 4096;
const API_PATHS = new Set(['/api/config', '/api/search', '/api/geocode']);

export function appConfig(env) {
  const feeds = configuredFeeds(env);
  return {
    mode: feeds.length > 0 ? 'live' : 'snapshot',
    snapshotMonth: SNAPSHOT_MONTH,
    sources: feeds.map(({ id, name }) => ({ id, name })),
  };
}

export async function search(rawFilters, env, fetcher = fetch) {
  const filters = parseFilters(rawFilters);
  const feeds = configuredFeeds(env);
  const workplace = await resolveWorkplace(filters, fetcher);
  if (!feeds.length) return snapshotSearch(filters, workplace);

  const results = await Promise.allSettled(feeds.map((feed) => loadFeed(feed, fetcher)));
  const listings = [];
  const sources = [];
  const notices = [];
  for (const [index, result] of results.entries()) {
    const { id, name } = feeds[index];
    if (result.status === 'rejected') {
      sources.push({ id, name, status: 'unavailable' });
      notices.push(`${name} could not be reached. Its listings are missing from this search.`);
    } else {
      sources.push({ id, name, status: 'searched' });
      listings.push(...result.value.listings);
      if (result.value.limited) notices.push(`${name} returned partial inventory.`);
    }
  }

  if (sources.every(({ status }) => status === 'unavailable')) {
    const fallback = snapshotSearch(filters, workplace);
    return { ...fallback, sources: [...fallback.sources, ...sources], notices: [...notices, ...fallback.notices] };
  }
  return localSearch(mergeListings(listings), filters, workplace, 'live', sources, notices);
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleApi(request, env, { requireToken = false } = {}) {
  const path = new URL(request.url).pathname;
  if (!API_PATHS.has(path)) return json({ error: 'Endpoint not found.' }, 404);
  if (requireToken && request.headers.get('Authorization') !== `Bearer ${env.APP_ACCESS_TOKEN}`) {
    return json({ error: 'Enter your apartment search server access token.' }, 401);
  }
  if (path === '/api/config') {
    if (request.method !== 'GET') return json({ error: 'Use GET for app configuration.' }, 405);
    try {
      return json(appConfig(env));
    } catch {
      return json({ error: 'The free feed settings need to be corrected on the server.' }, 503);
    }
  }
  if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.' }, 405);
  if (Number(request.headers.get('Content-Length')) > REQUEST_LIMIT) {
    return json({ error: 'The request is too large.' }, 413);
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > REQUEST_LIMIT) return json({ error: 'The request is too large.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Send a JSON request.' }, 400);
  }
  try {
    return json(path === '/api/geocode' ? await geocodeAddress(body?.address) : await search(body, env));
  } catch (error) {
    if (error instanceof SearchInputError) return json({ error: error.message }, 422);
    return json({ error: 'The address or listing feed could not be reached. Try again or use a workplace preset.' }, 502);
  }
}
