import { matchCompany, NYC_COMPANIES } from './companies.mjs';

export const MARKETPLACE_NAMES = {
  ...Object.fromEntries(NYC_COMPANIES.map(({ id, name }) => [id, name])),
  streeteasy: 'StreetEasy',
  zillow: 'Zillow',
  apartments: 'Apartments.com',
  realtor: 'Realtor.com',
  redfin: 'Redfin',
  trulia: 'Trulia',
  hotpads: 'HotPads',
  zumper: 'Zumper',
  apartmentlist: 'Apartment List',
  rent: 'Rent.',
  apartmentguide: 'Apartment Guide',
  renthop: 'RentHop',
  linecity: 'Linecity',
  craigslist: 'Craigslist',
  facebook: 'Facebook Marketplace',
  openigloo: 'Openigloo',
  affordablehousing: 'AffordableHousing.com',
};

const STATES = { NY: 'New-York', NJ: 'New-Jersey', CT: 'Connecticut', PA: 'Pennsylvania' };
const STREETEASY_AREAS = {
  'New York': 'nyc', Manhattan: 'manhattan', Brooklyn: 'brooklyn',
  Queens: 'queens', Bronx: 'bronx', 'Staten Island': 'staten-island',
  'Jersey City': 'jersey-city',
};

export function marketplaceLinks(market, filters) {
  const { city, state, region } = market;
  const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const stateSlug = state.toLowerCase();
  const titleSlug = city.replaceAll(' ', '-');
  const slug = `${citySlug}-${stateSlug}`;
  const zip = filters.zip || market.zip;
  const beds = filters.bedrooms;
  const max = filters.maxRent;
  const apartmentBeds = beds === null ? '' : beds === 0 ? 'studios' : `${beds}-bedrooms`;
  const apartmentFilters = [apartmentBeds, max === null ? '' : `under-${max}`].filter(Boolean).join('-');
  const apartmentArea = filters.zip || slug;
  const location = encodeURIComponent(city.replaceAll(' ', '_')) + ',' + state;
  const realtorArea = filters.zip || titleSlug + '_' + state;
  const realtorBeds = beds > 0 ? `/beds-${beds}-${beds}` : '';
  const hotpadsPath = max === null ? 'apartments-for-rent' : `apartments-under-${max}`;
  const redfinArea = { 'New York': '30749/NY/New-York', 'Jersey City': '9168/NJ/Jersey-City' }[city];
  const craigslistZone = region === 'pa' ? (
    ['Philadelphia', 'Doylestown'].includes(city) ? 'philadelphia' : city === 'Stroudsburg' ? 'poconos' : 'allentown'
  ) : region === 'li' ? 'longisland' : region === 'ct' ?
    city === 'New Haven' ? 'newhaven' : 'newyork' : region === 'nj' ?
      ['New Brunswick', 'Trenton'].includes(city) ? 'cnj' : 'newjersey' : 'newyork';
  const craigslist = new URLSearchParams({ postal: zip, search_distance: '12', sort: 'priceasc' });
  if (beds !== null) {
    craigslist.set('min_bedrooms', String(beds));
    craigslist.set('max_bedrooms', String(beds));
  }
  if (max !== null) craigslist.set('max_price', String(max));

  const links = [
    ['apartments', `https://www.apartments.com/${apartmentArea}/${apartmentFilters ? apartmentFilters + '/' : ''}`,
      apartmentFilters ? 'Area + rent and bedroom filters where selected' : 'Area search'],
    ['zillow', `https://www.zillow.com/${filters.zip || slug}/rentals/`, 'Area search'],
    ['realtor', `https://www.realtor.com/apartments/${filters.zip || city.replaceAll(' ', '-') + '_' + state}`, 'Area search'],
    ['redfin', 'https://www.redfin.com/rentals', 'Choose your city on Redfin'],
    ['trulia', `https://www.trulia.com/for_rent/${filters.zip || location}/`, 'Area search'],
    ['hotpads', `https://hotpads.com/${slug}/apartments-for-rent`, 'City search'],
    ['zumper', `https://www.zumper.com/apartments-for-rent/${slug}`, 'City search'],
    ['apartmentlist', `https://www.apartmentlist.com/${stateSlug}/${citySlug}`, 'City search'],
    ['rent', `https://www.rent.com/${STATES[state].toLowerCase()}/${citySlug}-apartments`, 'City search'],
    ['apartmentguide', `https://www.apartmentguide.com/apartments/${STATES[state]}/${titleSlug}/`, 'City search'],
    ['renthop', `https://www.renthop.com/${city === 'New York' ? 'new-york-ny/apartments-for-rent' : 'apartments-for-rent/' + slug}`, 'City search'],
    ['craigslist', `https://${craigslistZone}.craigslist.org/search/apa?${craigslist}`, 'ZIP radius + filters where selected'],
    ['facebook', 'https://www.facebook.com/marketplace/category/propertyrentals/', 'Set your area in Marketplace'],
    ['affordablehousing', `https://www.affordablehousing.com/${slug}/`, 'Browse rentals and voucher listings'],
    ['openigloo', 'https://www.openigloo.com/apartments', 'NYC rentals and building reviews'],
  ];
  const streetEasyArea = STREETEASY_AREAS[city];
  if (streetEasyArea) {
    const constraints = [beds === null ? '' : 'beds:' + beds, max === null ? '' : 'price:-' + max].filter(Boolean);
    const path = constraints.length ? '/' + encodeURIComponent(constraints.join('|')) : '';
    const detail = beds !== null && max !== null ? 'Area + bedrooms + rent limit' :
      beds !== null ? 'Area + bedroom count' : max !== null ? 'Area + rent limit' : 'Area search';
    links.unshift(['streeteasy', `https://streeteasy.com/for-rent/${streetEasyArea}${path}?sort_by=price_asc`, detail]);
  } else {
    links.push(['streeteasy', 'https://streeteasy.com/for-rent/nyc', 'Browse NYC and NJ listings']);
  }

  return links.map(([id, url, detail]) => ({ id, url, detail, name: MARKETPLACE_NAMES[id] }));
}

export const MARKETPLACE_DOMAINS = {
  streeteasy: 'streeteasy.com', zillow: 'zillow.com', apartments: 'apartments.com',
  realtor: 'realtor.com', redfin: 'redfin.com', trulia: 'trulia.com', hotpads: 'hotpads.com',
  zumper: 'zumper.com', apartmentlist: 'apartmentlist.com', rent: 'rent.com',
  apartmentguide: 'apartmentguide.com', renthop: 'renthop.com', linecity: 'linecity.com', craigslist: 'craigslist.org',
  facebook: 'facebook.com',
  openigloo: 'openigloo.com', affordablehousing: 'affordablehousing.com',
};

export function safeListingUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2000 ?
      url.href : null;
  } catch {
    return null;
  }
}

export function marketplaceIdForUrl(value) {
  const url = safeListingUrl(value);
  if (!url) return null;
  const hostname = new URL(url).hostname;
  const matches = (domain) => hostname === domain || hostname.endsWith('.' + domain);
  return Object.entries(MARKETPLACE_DOMAINS).find(([, domain]) => matches(domain))?.[0] ??
    NYC_COMPANIES.find(({ domain }) => matches(domain))?.id ?? null;
}

export function marketplaceAddressSearches(listing, sources = listing.sources) {
  const linked = new Set(sources.filter(({ url }) => url).map(({ id }) => id));
  const address = listing.address.replace(/"/g, '');
  const unit = listing.unit.replace(/"/g, '').replace(/^(?:unit|apt\.?|suite|#)\s*/i, '');
  const location = listing.zip || [listing.city, listing.state].filter(Boolean).join(' ');
  if (!address) return [];

  const company = matchCompany(listing.company);
  const sites = Object.entries(MARKETPLACE_DOMAINS);
  if (company) sites.unshift([company.id, company.domain]);
  return sites.filter(([id]) => !linked.has(id) && (id !== 'openigloo' || listing.region === 'nyc')).map(([id, domain]) => {
    const query = [`site:${domain}`, `"${address}"`, unit && `"${unit}"`, location, 'for rent'].filter(Boolean).join(' ');
    return { id, name: MARKETPLACE_NAMES[id], url: `https://www.google.com/search?${new URLSearchParams({ q: query })}` };
  });
}
