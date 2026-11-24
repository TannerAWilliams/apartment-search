/**
 * Keller Williams NYC rentals (kwnyc.com/rental). The site runs on Luxury Presence, like serhant.com, and its pages
 * read listings from the same kind of GraphQL endpoint on the site itself (/api-gw/graphql; robots.txt disallows
 * only /api/). Most of the company's thousand or so New York "for lease" records hide their address ("Call For
 * Address") and are left out; the rest, about 50 in the five boroughs in November 2026, are kept.
 */
import { luxuryPresenceSource } from './serhant.ts';

const SOURCE = { id: 'kw', name: 'Keller Williams NYC', kind: 'feed' };

// About 1,020 New York rentals marked for lease in November 2026: 11 pages of 100.
export const KW_LIVE = luxuryPresenceSource(
  { source: SOURCE, origin: 'https://kwnyc.com', companyId: 'd36fff22-1ea6-464a-8fbd-aee2a2b71bb2', maxPages: 15 },
  'every New York rental on kwnyc.com, from the site’s own listings feed; five-borough monthly apartment rentals with a published address are kept',
);
