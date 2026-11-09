import { parseFilters, previewSearch, matchListings, isPoint, SearchInputError } from '../src/search.mjs';
import { configuredFeeds, loadFeed, mergeListings } from './listings.mjs';
import { resolveWorkplace, fetchTransitRoutes, nextWeekdayArrival } from './commute.mjs';

const TRANSIT_LIMIT = 30;
const RESULT_LIMIT = 100;
const REQUEST_LIMIT = 4096;

export function appConfig(env) {
  const feeds = configuredFeeds(env);
  return {
    mode: feeds.length > 0 ? 'live' : 'demo',
    sources: feeds.map(({ id, name }) => ({ id, name })),
    transit: feeds.length > 0 && Boolean(env.GOOGLE_ROUTES_API_KEY),
  };
}

export async function search(rawFilters, env, fetcher = fetch) {
  const filters = parseFilters(rawFilters);
  const feeds = configuredFeeds(env);
  if (filters.maxMinutes !== null && (!feeds.length || !env.GOOGLE_ROUTES_API_KEY)) {
    throw new SearchInputError('Transit time requires a configured live listing feed and Google Routes key.');
  }
  const workplace = await resolveWorkplace(filters, fetcher);
  if (!feeds.length) return previewSearch(filters, workplace);

  const results = await Promise.allSettled(feeds.map((feed) => loadFeed(feed, filters, env, fetcher)));
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
      if (result.value.limited) notices.push(`${name} returned a partial inventory. Narrow the area, ZIP, or rent to check more precisely.`);
    }
  }
  if (sources.every(({ status }) => status === 'unavailable')) {
    throw new Error('The configured listing feeds are unavailable. Try again or open a marketplace search.');
  }

  let matches = matchListings(mergeListings(listings), filters, workplace);
  let transitArrival = null;
  if (filters.maxMinutes !== null) {
    transitArrival = nextWeekdayArrival(filters.arrival);
    const candidates = matches.filter(isPoint);
    const routes = await fetchTransitRoutes(candidates.slice(0, TRANSIT_LIMIT),
      workplace, transitArrival, env.GOOGLE_ROUTES_API_KEY, fetcher);
    matches = matches.flatMap((listing) => {
      const route = routes.get(listing.id);
      return route && route.transitSeconds <= filters.maxMinutes * 60 ? [{ ...listing, ...route }] : [];
    });
    if (candidates.length > TRANSIT_LIMIT) {
      notices.push(`Transit was checked for the ${TRANSIT_LIMIT} lowest-rent candidates with coordinates. Narrow the search to check a different set.`);
    }
    if (routes.size < candidates.slice(0, TRANSIT_LIMIT).length) {
      notices.push('Listings without a scheduled transit route were excluded.');
    }
  }
  const total = matches.length;
  if (total > RESULT_LIMIT) {
    notices.push(`Showing the ${RESULT_LIMIT} lowest-rent matches from the listings returned by the feeds.`);
  }
  return { mode: 'live', workplace, matches: matches.slice(0, RESULT_LIMIT), total, sources, notices, transitArrival };
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleApi(request, env, { requireToken = false } = {}) {
  const path = new URL(request.url).pathname;
  if (path !== '/api/config' && path !== '/api/search') return json({ error: 'Endpoint not found.' }, 404);
  if (requireToken && request.headers.get('Authorization') !== `Bearer ${env.APP_ACCESS_TOKEN}`) {
    return json({ error: 'Enter your apartment search server access token.' }, 401);
  }
  if (path === '/api/config') {
    if (request.method !== 'GET') return json({ error: 'Use GET for app configuration.' }, 405);
    try {
      return json(appConfig(env));
    } catch {
      return json({ error: 'The listing feed settings need to be corrected on the server.' }, 503);
    }
  }
  if (request.method !== 'POST') return json({ error: 'Use POST to search.' }, 405);
  if (Number(request.headers.get('Content-Length')) > REQUEST_LIMIT) {
    return json({ error: 'The search request is too large.' }, 413);
  }
  let filters;
  try {
    const text = await request.text();
    if (text.length > REQUEST_LIMIT) return json({ error: 'The search request is too large.' }, 413);
    filters = JSON.parse(text);
  } catch {
    return json({ error: 'Send the search filters as JSON.' }, 400);
  }
  try {
    return json(await search(filters, env));
  } catch (error) {
    if (error instanceof SearchInputError) return json({ error: error.message }, 422);
    return json({ error: 'A listing, address, or transit service is temporarily unavailable. Try again or browse a marketplace.' }, 502);
  }
}
