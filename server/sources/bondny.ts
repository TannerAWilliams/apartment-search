/**
 * Bond New York: the rentals on its own site (bondnewyork.com), which runs on RealtyMX like REAL New York's
 * and is read the same way (see realny.ts): the site's rentals search, many cards a page, one page at a time,
 * with ZIP codes from the U.S. Census geocoder. robots.txt allows it for all user agents (it disallows only
 * /images/ and /admin, and some named AI crawlers this app is not).
 */
import type { FetchTransport } from '../../src/fetch-type.ts';
import { publicListingUrl } from './public-rentals.ts';
import { loadRealtyMx, type RealtyMxSite } from './realny.ts';

const SOURCE = { id: 'bondny', name: 'Bond New York', kind: 'feed' };
const ORIGIN = 'https://www.bondnewyork.com';
export const bondnyListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, /^\/[a-z0-9-]+\/[a-z-]+-for-rent\/[a-z0-9-]+\/\d+$/);
// About 3,000 rentals (13 pages of 250 cards, about 2.3 MB each) in November 2026.
const BONDNY: RealtyMxSite = { source: SOURCE, origin: ORIGIN, status: '2', rowsPerPage: 250, maxPages: 24, listingUrl: bondnyListingUrl };

export const BONDNY_LIVE = {
  ...SOURCE,
  id: 'bondny-live',
  marketplace: SOURCE.id,
  coverage:
    'every rental with a street number in Bond New York’s own rentals search (its own and shared listings) in the five boroughs; ZIP codes from the Census geocoder',
  regions: ['nyc'],
  minPages: 1,
  maxPages: BONDNY.maxPages,
  rowsPerPage: BONDNY.rowsPerPage,
  listingUrl: bondnyListingUrl,
  load: (fetcher: FetchTransport, now: Date) => loadRealtyMx(BONDNY, fetcher, now),
};
