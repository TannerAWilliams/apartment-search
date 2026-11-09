import { MARKETPLACE_NAMES } from '../src/marketplaces.mjs';
import { REGIONS, regionOf } from '../src/regions.mjs';

const PAGE_SIZE = 500;
const HOUR = 60 * 60 * 1000;
const rentcastCache = new Map();

const clean = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const numeric = (value) => typeof value === 'number' ? value :
  typeof value === 'string' && value.trim() ? Number(value) : NaN;

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2000 ?
      url.href : null;
  } catch {
    return null;
  }
}

function normalize(row, source) {
  if (!row || typeof row !== 'object') return null;
  const status = clean(row.status).toLowerCase();
  if (status !== 'active') return null;
  const city = clean(row.city);
  const state = clean(row.state, 2).toUpperCase();
  const zip = clean(row.zipCode ?? row.zip, 5);
  const county = clean(row.county);
  const address = clean(row.addressLine1 ?? row.address);
  const unit = clean(row.addressLine2 ?? row.unit, 45);
  const rent = numeric(row.price ?? row.rent);
  const bedrooms = numeric(row.bedrooms);
  if (!address || !city || !['NY', 'NJ', 'CT'].includes(state) ||
      !Number.isFinite(rent) || rent <= 0 || !Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 4) {
    return null;
  }

  const listing = {
    id: `${source.id}:${clean(row.id ?? row.listingId, 140) || [address, unit, city, state, zip, rent, bedrooms].join('|')}`,
    address,
    unit,
    city,
    state,
    zip,
    county,
    rent,
    bedrooms,
    latitude: numeric(row.latitude),
    longitude: numeric(row.longitude),
    seenAt: Number.isFinite(Date.parse(row.lastSeenDate ?? row.updatedAt)) ? row.lastSeenDate ?? row.updatedAt : null,
    sources: [{ id: source.id, name: source.name, url: safeUrl(row.listingUrl ?? row.url) }],
  };
  return regionOf(listing) ? listing : null;
}

function textKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function addressKey(listing) {
  const unitSuffix = /\s+(?:(?:unit|apt\.?|apartment|suite)\s+|#\s*)([\w-]+)$/i;
  const address = textKey(listing.address.replace(unitSuffix, ''))
    .replace(/\b(street|avenue|road|boulevard|place|drive|lane|court|terrace)$/, (word) => ({
      street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', place: 'pl',
      drive: 'dr', lane: 'ln', court: 'ct', terrace: 'ter',
    })[word]);
  const unit = textKey(listing.unit || listing.address.match(unitSuffix)?.[1] || '')
    .replace(/^(unit|apt|apartment|suite) /, '');
  return unit && listing.zip ? `${listing.state}|${listing.zip}|${address}|${unit}` : null;
}

export function mergeListings(listings) {
  const merged = new Map();
  const keysById = new Map();
  for (const listing of listings) {
    const key = keysById.get(listing.id) ?? addressKey(listing) ?? listing.id;
    keysById.set(listing.id, key);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, listing);
      continue;
    }
    const currentTime = Date.parse(current.seenAt) || 0;
    const listingTime = Date.parse(listing.seenAt) || 0;
    const newer = listingTime > currentTime ? listing : current;
    const older = newer === listing ? current : listing;
    const sources = [...newer.sources];
    for (const source of older.sources) {
      const existing = sources.findIndex((item) => item.id === source.id);
      if (existing === -1) sources.push(source);
      else if (!sources[existing].url && source.url) sources[existing] = source;
    }
    const hasLocation = Number.isFinite(newer.latitude) && Number.isFinite(newer.longitude);
    merged.set(key, {
      ...newer,
      id: current.id,
      latitude: hasLocation ? newer.latitude : older.latitude,
      longitude: hasLocation ? newer.longitude : older.longitude,
      sources,
    });
  }
  return [...merged.values()];
}

export function configuredFeeds(env) {
  const feeds = [];
  if (env.RENTCAST_API_KEY) feeds.push({ id: 'rentcast', name: 'RentCast', kind: 'rentcast' });
  if (!env.PARTNER_FEEDS_JSON) return feeds;
  let configured;
  try {
    configured = JSON.parse(env.PARTNER_FEEDS_JSON);
  } catch {
    throw new Error('The partner feed configuration is invalid.');
  }
  if (!Array.isArray(configured) || configured.length > 15) {
    throw new Error('Configure up to 15 approved partner feeds.');
  }

  const ids = new Set(feeds.map((feed) => feed.id));
  for (const feed of configured) {
    const id = clean(feed?.id, 48);
    const name = Object.hasOwn(MARKETPLACE_NAMES, id) ? MARKETPLACE_NAMES[id] : clean(feed?.name, 48);
    const url = safeUrl(feed?.url);
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id) || id === 'rentcast' || ids.has(id) || !name || !url) {
      throw new Error('A partner feed is missing a unique ID, name, or HTTPS URL.');
    }
    ids.add(id);
    feeds.push({ id, name, url, token: clean(feed.token, 4000), kind: 'partner' });
  }
  return feeds;
}

async function readRows(response) {
  if (!response.ok) throw new Error('Feed unavailable');
  const body = await response.json();
  const rows = Array.isArray(body) ? body : body?.listings;
  if (!Array.isArray(rows)) throw new Error('Invalid feed response');
  return rows;
}

export function rentcastQuery(filters) {
  const query = new URLSearchParams({
    status: 'Active',
    propertyType: 'Apartment|Condo|Multi-Family',
    bedrooms: filters.bedrooms === null ? '0:4' : String(filters.bedrooms),
    limit: String(PAGE_SIZE),
  });
  if (filters.maxRent !== null) query.set('price', `1:${filters.maxRent}`);
  if (filters.zip) {
    query.set('zipCode', filters.zip);
  } else {
    const [latitude, longitude, radius] = REGIONS[filters.region].center;
    query.set('latitude', latitude);
    query.set('longitude', longitude);
    query.set('radius', radius);
  }
  return query;
}

async function fetchRentCast(feed, filters, env, fetcher) {
  const query = rentcastQuery(filters);
  const maxPages = Math.max(1, Math.min(Number.parseInt(env.RENTCAST_MAX_PAGES, 10) || 1, 3));
  const key = `${maxPages}:${query}`;
  const now = Date.now();
  const cached = rentcastCache.get(key);
  if (cached && cached.expires > now) return cached.promise;

  const fetchPages = async () => {
    const listings = [];
    for (let page = 0; page < maxPages; page += 1) {
      if (page) query.set('offset', String(page * PAGE_SIZE));
      const response = await fetcher(`https://api.rentcast.io/v1/listings/rental/long-term?${query}`, {
        headers: { 'X-Api-Key': env.RENTCAST_API_KEY, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok && page > 0) return { listings, limited: true };
      const rows = await readRows(response);
      listings.push(...rows.map((row) => normalize(row, feed)).filter(Boolean));
      if (rows.length < PAGE_SIZE) return { listings, limited: false };
    }
    return { listings, limited: true };
  };

  // Reuse identical in-flight and recent searches, including when only the commute changes.
  if (rentcastCache.size >= 48) rentcastCache.delete(rentcastCache.keys().next().value);
  const promise = fetchPages();
  rentcastCache.set(key, { expires: now + HOUR / 4, promise });
  try {
    return await promise;
  } catch (error) {
    if (rentcastCache.get(key)?.promise === promise) rentcastCache.delete(key);
    throw error;
  }
}

export async function loadFeed(feed, filters, env, fetcher) {
  if (feed.kind === 'rentcast') return fetchRentCast(feed, filters, env, fetcher);
  const headers = { Accept: 'application/json' };
  if (feed.token) headers.Authorization = `Bearer ${feed.token}`;
  const response = await fetcher(feed.url, {
    headers, redirect: 'error', signal: AbortSignal.timeout(9000),
  });
  const rows = await readRows(response);
  return {
    listings: rows.slice(0, 5000).map((row) => normalize(row, feed)).filter(Boolean),
    limited: rows.length > 5000,
  };
}
