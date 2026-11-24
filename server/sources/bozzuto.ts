/**
 * Bozzuto: every available floor plan in its New York City (five boroughs) buildings, from the landlord's
 * own site. The New York page links each building; a building's page gives its street address and its
 * floor-plans page lists each plan with its lowest current price and whether it is available, both as
 * schema.org data. Plans are listed at their lowest price ("From $…"), one listing per plan. robots.txt
 * disallows /api/ and /search, which are not used.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { fetchPublicHtml, jsonLd } from './public-rentals.ts';

const SOURCE = { id: 'bozzuto', name: 'Bozzuto', kind: 'feed' };
const ORIGIN = 'https://www.bozzuto.com';
const STATE_PAGE = `${ORIGIN}/apartments-for-rent/ny`;
/** City slugs Bozzuto uses for places in the five boroughs; each building's ZIP code is checked as well. */
const NYC_CITIES = ['new-york', 'manhattan', 'brooklyn', 'bronx', 'queens', 'staten-island', 'long-island-city', 'astoria', 'flushing'];
const PROPERTY_PATH = new RegExp(`^/apartments-for-rent/ny/(?:${NYC_CITIES.join('|')})/[a-z0-9-]+$`);
const PLAN_PATH = /^\/apartments-for-rent\/ny\/[a-z0-9-]+\/[a-z0-9-]+\/floor-plans\/\d{1,12}$/;

export function bozzutoListingUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && PLAN_PATH.test(url.pathname) ? ORIGIN + url.pathname : null;
  } catch {
    return null;
  }
}

/** The New York City building pages linked from the New York page. */
export function parseBozzutoProperties(html: string): string[] {
  if (!/Apartments for Rent/i.test(html)) throw new Error('Bozzuto did not return a recognized New York page.');
  const paths = [...html.matchAll(/href="(\/apartments-for-rent\/ny\/[a-z0-9-]+\/[a-z0-9-]+)"/g)].map(([, path]) => path);
  return [...new Set(paths.filter((path) => PROPERTY_PATH.test(path)))].map((path) => ORIGIN + path);
}

/** Every schema.org object on a page, with @graph lists flattened. */
function things(html: string): Record<string, unknown>[] {
  return jsonLd(html).flatMap((thing) => (isRecord(thing) ? (Array.isArray(thing['@graph']) ? thing['@graph'] : [thing]) : []));
}

type Building = { address: string; zip: string; city: string; latitude?: unknown; longitude?: unknown };

/** A building's street address and borough, or null when it is outside the five boroughs. */
export function parseBozzutoBuilding(html: string): Building | null {
  const complex = things(html).find((thing) => isRecord(thing) && thing['@type'] === 'ApartmentComplex' && isRecord(thing.address));
  const address = complex?.address as Record<string, unknown> | undefined;
  if (!address || typeof address.streetAddress !== 'string' || typeof address.postalCode !== 'string')
    throw new Error('Bozzuto did not give a building’s address.');
  const city = nycBorough(address.postalCode);
  if (!city) return null;
  const geo = isRecord(complex?.geo) ? complex.geo : {};
  return { address: address.streetAddress, zip: address.postalCode, city, latitude: geo.latitude, longitude: geo.longitude };
}

/** The available floor plans on a building's floor-plans page, one listing each. */
export function parseBozzutoFloorPlans(html: string, building: Building, checkedAt: string) {
  const plans = things(html).filter((thing) => isRecord(thing) && thing['@type'] === 'FloorPlan');
  if (!plans.length) throw new Error('Bozzuto did not return a recognized floor-plans page.');
  return plans
    .map((plan) => {
      const offer = isRecord(plan.offers) ? plan.offers : {};
      const url = bozzutoListingUrl(plan.url);
      if (offer.availability !== 'https://schema.org/InStock' || !url) return null;
      return normalizeListing(
        {
          id: url.match(/\d+$/)![0],
          url,
          address: building.address,
          city: building.city,
          state: 'NY',
          region: 'nyc',
          zipCode: building.zip,
          latitude: building.latitude,
          longitude: building.longitude,
          bedrooms: plan.numberOfBedrooms,
          bathrooms: plan.numberOfBathroomsTotal,
          squareFeet: isRecord(plan.floorSize) ? plan.floorSize.value : undefined,
          rent: offer.price,
          company: 'Bozzuto',
          status: 'Active',
          updatedAt: checkedAt,
        },
        SOURCE,
      );
    })
    .filter((listing) => listing !== null);
}

/** Every available floor plan, reading one page at a time with a pause between; any failure stops the sync. */
export async function loadBozzuto(fetcher: FetchTransport, now: Date, intervalMs = 1000) {
  const checkedAt = now.toISOString();
  let pages = 0;
  const read = async (url: string) => {
    if (pages++ > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    return fetchPublicHtml(fetcher, url, 'Bozzuto', 15_000);
  };
  const properties = parseBozzutoProperties(await read(STATE_PAGE));
  if (!properties.length) throw new Error('Bozzuto listed no New York City buildings.');
  const listings = [];
  for (const property of properties) {
    const building = parseBozzutoBuilding(await read(property));
    if (building) listings.push(...parseBozzutoFloorPlans(await read(`${property}/floor-plans`), building, checkedAt));
  }
  if (!listings.length) throw new Error('Bozzuto returned no available New York City apartments.');
  return { listings, pages };
}

export const BOZZUTO_LIVE = {
  ...SOURCE,
  id: 'bozzuto-live',
  marketplace: SOURCE.id,
  coverage: 'every available floor plan in Bozzuto’s New York City buildings, at its lowest price, from the landlord’s own site',
  regions: ['nyc'],
  minPages: 3,
  maxPages: 41,
  rowsPerPage: 40,
  listingUrl: bozzutoListingUrl,
  load: loadBozzuto,
};
