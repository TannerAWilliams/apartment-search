export const MARKETPLACE_NAMES = {
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
  craigslist: 'Craigslist',
  facebook: 'Facebook Marketplace',
};

const STATES = { NY: 'New-York', NJ: 'New-Jersey', CT: 'Connecticut' };
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
  const location = encodeURIComponent(city.replaceAll(' ', '_') + ',' + state);
  const realtorArea = filters.zip || titleSlug + '_' + state;
  const realtorBeds = beds > 0 ? `/beds-${beds}-${beds}` : '';
  const hotpadsPath = max === null ? 'apartments-for-rent' : `apartments-under-${max}`;
  const redfinArea = { 'New York': '30749/NY/New-York', 'Jersey City': '9168/NJ/Jersey-City' }[city];
  const craigslistZone = region === 'li' ? 'longisland' : region === 'ct' ?
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
    ['trulia', `https://www.trulia.com/for_rent/${filters.zip || location + ',' + state}/`, 'Area search'],
    ['hotpads', `https://hotpads.com/${slug}/apartments-for-rent`, 'City search'],
    ['zumper', `https://www.zumper.com/apartments-for-rent/${slug}`, 'City search'],
    ['apartmentlist', `https://www.apartmentlist.com/${stateSlug}/${citySlug}`, 'City search'],
    ['rent', `https://www.rent.com/${STATES[state].toLowerCase()}/${citySlug}-apartments`, 'City search'],
    ['apartmentguide', `https://www.apartmentguide.com/apartments/${STATES[state]}/${titleSlug}/`, 'City search'],
    ['renthop', `https://www.renthop.com/${city === 'New York' ? 'new-york-ny/apartments-for-rent' : 'apartments-for-rent/' + slug}`, 'City search'],
    ['craigslist', `https://${craigslistZone}.craigslist.org/search/apa?${craigslist}`, 'ZIP radius + filters where selected'],
    ['facebook', 'https://www.facebook.com/marketplace/category/propertyrentals/', 'Set your area in Marketplace'],
  ];
  const streetEasyArea = STREETEASY_AREAS[city];
  if (streetEasyArea) {
    const path = beds === 0 ? 'studios-for-rent' : beds === null ? 'for-rent' : `${beds}-bedroom-apartments-for-rent`;
    const price = max === null ? '' : '/' + encodeURIComponent(`price:-${max}`);
    const detail = beds !== null && max !== null ? 'Area + bedrooms + rent limit' :
      beds !== null ? 'Area + bedroom count' : max !== null ? 'Area + rent limit' : 'Area search';
    links.unshift(['streeteasy', `https://streeteasy.com/${path}/${streetEasyArea}${price}`, detail]);
  } else {
    links.push(['streeteasy', 'https://streeteasy.com/for-rent/nyc', 'Browse NYC and NJ listings']);
  }

  return links.map(([id, url, detail]) => ({ id, url, detail, name: MARKETPLACE_NAMES[id] }));
}
