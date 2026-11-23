import type { ListingData, SourceLink } from './domain.ts';
import { discoveryFacts, mergeDiscoveryFacts } from './discovery.ts';
import { MARKETPLACE_NAMES, marketplaceIdForUrl, safeListingUrl } from './marketplaces.ts';
import { regionOf } from './regions.ts';
import { isPoint } from './search.ts';

const clean = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const numeric = (value: unknown) => typeof value === 'number' ? value :
  typeof value === 'string' && value.trim() ? Number(value) : NaN;

const unitSuffix = /\s+(?:(?:unit|apt\.?|apartment|suite)\s+|#\s*)([\w-]+)$/i;
const streetTypes: Record<string, string> = {
  street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', place: 'pl',
  drive: 'dr', lane: 'ln', court: 'ct', terrace: 'ter',
};
const textKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function buildingKey(listing: Pick<ListingData, 'address' | 'state' | 'zip'>) {
  const street = textKey(listing.address.replace(unitSuffix, ''))
    .replace(/\b(north|south|east|west)(?=\s+\d)/g, (direction) => direction[0])
    .replace(/\b(street|avenue|road|boulevard|place|drive|lane|court|terrace)$/, (word) => streetTypes[word]);
  return street && listing.zip ? `${listing.state}|${listing.zip}|${street}` : null;
}

function unitKey(listing: Pick<ListingData, 'address' | 'state' | 'zip' | 'unit'>) {
  const address = buildingKey(listing);
  const unit = textKey(listing.unit || listing.address.match(unitSuffix)?.[1] || '')
    .replace(/^(unit|apt|apartment|suite) /, '');
  return address && unit ? `${address}|${unit}` : null;
}

export const listingKey = (listing: ListingData) => unitKey(listing) ?? listing.id;

// Individually checked unit URLs, keyed by the original listing rather than by building.
const VERIFIED_UNIT_LINKS = new Map<string, SourceLink[]>([
  ['https://streeteasy.com/building/one-columbus-place/s21d', [
    { id: 'brodsky', name: 'Brodsky', url: 'https://www.brodsky.com/rentals/lincoln-square/one-columbus-place/one-columbus-place-apartment-s-21d', kind: 'verified' },
    { id: 'linecity', name: 'Linecity', url: 'https://www.linecity.com/listing/3916886/One-Columbus-Place-1-Columbus-Place-Lincoln-Square-Manhattan-NY-Rent', kind: 'verified' },
  ]],
]);

export function listingWithVerifiedLinks<T extends ListingData>(listing: T): T {
  const additional = listing.sources.flatMap(({ url }) => (url ? VERIFIED_UNIT_LINKS.get(url) : undefined) ?? []);
  return additional.length ? { ...listing, sources: mergeSourceLinks(listing.sources, additional) } : listing;
}

export function orderedListingLinks(sources: readonly SourceLink[], selectedSource?: string) {
  const priority = ({ id, kind }: SourceLink) => id === selectedSource ? 0 :
    kind === 'feed' ? 1 : kind === 'verified' ? 2 : kind === 'saved' ? 3 : 4;
  return sources.filter((source): source is SourceLink & { url: string } => Boolean(source.url)).sort((first, second) => priority(first) - priority(second));
}

export function listingLinkLabel({ name, kind }: Pick<SourceLink, 'name' | 'kind'>) {
  if (kind === 'snapshot' || kind === 'cached') return 'View original on ' + name;
  return 'Open on ' + name;
}

export function sourceLink(url: unknown, kind: string, fallback: Pick<SourceLink, 'id' | 'name'> | null = null): SourceLink | null {
  const href = safeListingUrl(url);
  if (!href) return fallback ? { ...fallback, url: null, kind } : null;
  const id = marketplaceIdForUrl(href);
  return { id: id ?? fallback?.id ?? new URL(href).hostname, name: (id ? MARKETPLACE_NAMES[id] : undefined) ?? fallback?.name ?? new URL(href).hostname,
    url: href, kind };
}

export function normalizeListing(input: unknown, source: { id: string; name: string; kind: string; maxBedrooms?: number; maxRent?: number }): ListingData | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  const status = clean(row.status).toLowerCase();
  if (source.kind === 'feed' && status !== 'active') return null;
  const city = clean(row.city);
  const state = clean(row.state, 2).toUpperCase();
  const zip = clean(row.zipCode ?? row.zip, 5);
  const county = clean(row.county);
  const providedAddress = clean(row.addressLine1 ?? row.address);
  const unit = clean(row.addressLine2 ?? row.unit, 45) || providedAddress.match(unitSuffix)?.[1] || '';
  const address = providedAddress.replace(unitSuffix, '');
  const rent = numeric(row.price ?? row.rent);
  const bedrooms = numeric(row.bedrooms);
  if (!address || !city || !/^\d{5}$/.test(zip) || !['NY', 'NJ', 'CT', 'PA'].includes(state) ||
      !Number.isFinite(rent) || rent <= 0 || rent > (source.maxRent ?? 100000) || !Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > (source.maxBedrooms ?? 4)) {
    return null;
  }
  const originalUrl = row.listingUrl ?? row.url;
  const link = sourceLink(originalUrl, source.kind, { id: source.id, name: source.name });
  const point = { latitude: numeric(row.latitude), longitude: numeric(row.longitude) };
  const listing = {
    id: `${source.id}:${clean(row.id ?? row.listingId, 140) ||
      [address, unit, city, state, zip, safeListingUrl(originalUrl) || rent, bedrooms].join('|')}`,
    address, unit, city, state, zip, county, rent, bedrooms, ...point, ...discoveryFacts(row),
    region: typeof row.region === 'string' ? row.region : undefined,
    neighborhood: clean(row.neighborhood, 80),
    company: clean(row.company ?? row.brokerage),
    seenAt: Number.isFinite(Date.parse(clean(row.lastSeenDate ?? row.updatedAt))) ? clean(row.lastSeenDate ?? row.updatedAt) : null,
    sources: link ? [link] : [],
    kind: source.kind,
  };
  const region = regionOf(listing);
  return region ? { ...listing, region } : null;
}

export function mergeSourceLinks(first: readonly SourceLink[], second: readonly SourceLink[]): SourceLink[] {
  const links = new Map<string, SourceLink>();
  for (const source of [...first, ...second]) {
    const key = source.url ?? source.id;
    const existing = links.get(key);
    // A retained/historic link must not hide fresh evidence for the same URL.
    if (!existing || (existing.kind !== 'feed' && source.kind === 'feed')) links.set(key, source);
  }
  return [...links.values()];
}

function hasIndependentSources(first: ListingData, second: ListingData) {
  const identities = (listing: ListingData) => new Set((listing.sources ?? [])
    .map((source) => source.id ?? source.url)
    .filter(Boolean));
  const firstSources = identities(first);
  const secondSources = identities(second);
  if (!firstSources.size || !secondSources.size) return false;
  return [...firstSources].every((source) => !secondSources.has(source));
}

export function mergeListings(listings: ListingData[], { preferFirst = false } = {}) {
  const merged = new Map<string, ListingData>();
  const keysById = new Map<string, string>();
  for (const listing of listings) {
    const key = keysById.get(listing.id) ?? listingKey(listing);
    keysById.set(listing.id, key);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, listing);
      continue;
    }

    const currentTime = Date.parse(current.seenAt ?? '') || 0;
    const listingTime = Date.parse(listing.seenAt ?? '') || 0;
    const preferred = !preferFirst && listingTime > currentTime ? listing : current;
    const alternate = preferred === listing ? current : listing;
    const hasLocation = isPoint(preferred);
    const factsDiffer = preferred.rent !== alternate.rent || preferred.bedrooms !== alternate.bedrooms;
    merged.set(key, {
      ...preferred,
      ...mergeDiscoveryFacts(preferred, alternate),
      // A provider updating its own saved observation is history, not a disagreement between sources.
      detailsConflict: Boolean(preferred.detailsConflict || alternate.detailsConflict ||
        (factsDiffer && hasIndependentSources(preferred, alternate))),
      id: current.id,
      latitude: hasLocation ? preferred.latitude : alternate.latitude,
      longitude: hasLocation ? preferred.longitude : alternate.longitude,
      neighborhood: preferred.neighborhood || alternate.neighborhood,
      company: preferred.company || alternate.company,
      sources: mergeSourceLinks(preferred.sources, alternate.sources),
    });
  }
  return [...merged.values()];
}




/** Presentation never converts missing bedrooms to a studio or guesses from a URL. */
export function listingPresentation(listing: { bedrooms?: unknown; rent?: unknown; discoveryConflicts?: unknown[]; detailsConflict?: boolean }) {
  const bedsKnown = typeof listing.bedrooms === 'number' && Number.isInteger(listing.bedrooms) && listing.bedrooms >= 0;
  const priceKnown = typeof listing.rent === 'number' && Number.isFinite(listing.rent) && listing.rent > 0;
  const notices: string[] = [];
  if (!bedsKnown) notices.push('Bedroom count not provided. Check the listing.');
  if (!priceKnown) notices.push('Monthly price not provided. Check the listing.');
  else if (typeof listing.rent === 'number' && listing.rent < 500) notices.push('Unusually low price. Verify the monthly rent and whether this is a room or a full apartment.');
  if (listing.discoveryConflicts?.length) notices.push('Sources disagree on apartment features. Conflicting features are treated as unknown; verify with the landlord.');
  if (listing.detailsConflict) notices.push('Sources report different prices or bedroom counts. Verify details before comparing.');
  return { priceKnown, bedsLabel: !bedsKnown ? 'Beds unknown' : listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} ${listing.bedrooms === 1 ? 'bedroom' : 'bedrooms'}`, notices };
}
