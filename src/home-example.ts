/**
 * The apartment the home page shows as its example: a real one from the listings in hand, chosen because it
 * shows the most of what Walkup adds to a listing (its rent against similar apartments, its building's grade,
 * the sites that carry it).
 */
import type { ListingData } from './domain.ts';
import { buildingGrade, marketBadge } from './insights.ts';
import { formatRent } from './search.ts';

export type HomeExample = {
  id: string;
  title: string;
  place: string;
  rent: string;
  /** "18% below similar", when the rent is clearly below what similar apartments ask. */
  below: string | null;
  grade: string | null;
  /** The sites that list it, when more than one does. */
  sites: string[];
};

function example(listing: ListingData): HomeExample {
  const badge = marketBadge(listing.insights);
  const sites = [...new Set(listing.sources.filter(({ url }) => url).map(({ name }) => name))];
  return {
    id: listing.id,
    title: listing.unit ? `${listing.address}, ${listing.unit.startsWith('#') ? listing.unit : 'Unit ' + listing.unit}` : listing.address,
    place: [listing.neighborhood, listing.city].filter((part, index, all) => part && all.indexOf(part) === index).join(', '),
    rent: formatRent(listing.rent),
    below: badge?.endsWith('below similar') ? badge : null,
    grade: buildingGrade(listing.building),
    sites: sites.length > 1 ? sites : [],
  };
}

/** The listing that shows the most; nothing when none shows anything. */
export function homeExample(listings: ListingData[]): HomeExample | null {
  let best: HomeExample | null = null;
  let most = 0;
  for (const listing of listings) {
    const candidate = example(listing);
    const shows = Number(Boolean(candidate.below)) + Number(Boolean(candidate.grade)) + Number(candidate.sites.length > 0);
    if (shows > most) [best, most] = [candidate, shows];
    if (most === 3) break;
  }
  return best;
}
