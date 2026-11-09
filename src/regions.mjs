export const WORKPLACES = {
  rockefeller: { label: 'Rockefeller Center', latitude: 40.75874, longitude: -73.97867 },
  grandCentral: { label: 'Grand Central Terminal', latitude: 40.75273, longitude: -73.97724 },
  penn: { label: 'Penn Station', latitude: 40.75061, longitude: -73.99357 },
  worldTrade: { label: 'World Trade Center', latitude: 40.71274, longitude: -74.01338 },
};

export const REGIONS = {
  all: { label: 'All regions', center: [40.81, -73.53, 99], color: '#27604f' },
  nyc: { label: 'New York City', center: [40.70, -73.96, 24], color: '#27725a' },
  nj: { label: 'New Jersey', center: [40.70, -74.44, 58], color: '#a4482b' },
  li: { label: 'Long Island', center: [40.87, -72.90, 65], color: '#2c6196' },
  metroNorth: { label: 'Metro-North NY', center: [41.30, -73.91, 56], color: '#68519a' },
  ct: { label: 'Connecticut', center: [41.23, -73.27, 51], color: '#815e16' },
};

export const MARKETS = [
  ['New York City', 'New York', 'NY', '10001', 'nyc'],
  ['Manhattan', 'Manhattan', 'NY', '10001', 'nyc'],
  ['Brooklyn', 'Brooklyn', 'NY', '11201', 'nyc'],
  ['Queens', 'Queens', 'NY', '11101', 'nyc'],
  ['The Bronx', 'Bronx', 'NY', '10451', 'nyc'],
  ['Staten Island', 'Staten Island', 'NY', '10301', 'nyc'],
  ['Jersey City', 'Jersey City', 'NJ', '07302', 'nj'],
  ['Hoboken', 'Hoboken', 'NJ', '07030', 'nj'],
  ['Newark', 'Newark', 'NJ', '07102', 'nj'],
  ['Harrison', 'Harrison', 'NJ', '07029', 'nj'],
  ['Union City', 'Union City', 'NJ', '07087', 'nj'],
  ['Hackensack', 'Hackensack', 'NJ', '07601', 'nj'],
  ['Rahway', 'Rahway', 'NJ', '07065', 'nj'],
  ['New Brunswick', 'New Brunswick', 'NJ', '08901', 'nj'],
  ['Trenton', 'Trenton', 'NJ', '08608', 'nj'],
  ['Mineola', 'Mineola', 'NY', '11501', 'li'],
  ['Hempstead', 'Hempstead', 'NY', '11550', 'li'],
  ['Hicksville', 'Hicksville', 'NY', '11801', 'li'],
  ['Huntington', 'Huntington', 'NY', '11743', 'li'],
  ['Ronkonkoma', 'Ronkonkoma', 'NY', '11779', 'li'],
  ['Yonkers', 'Yonkers', 'NY', '10701', 'metroNorth'],
  ['New Rochelle', 'New Rochelle', 'NY', '10801', 'metroNorth'],
  ['Mount Vernon', 'Mount Vernon', 'NY', '10550', 'metroNorth'],
  ['White Plains', 'White Plains', 'NY', '10601', 'metroNorth'],
  ['Tarrytown', 'Tarrytown', 'NY', '10591', 'metroNorth'],
  ['Beacon', 'Beacon', 'NY', '12508', 'metroNorth'],
  ['Poughkeepsie', 'Poughkeepsie', 'NY', '12601', 'metroNorth'],
  ['Stamford', 'Stamford', 'CT', '06902', 'ct'],
  ['Greenwich', 'Greenwich', 'CT', '06830', 'ct'],
  ['Norwalk', 'Norwalk', 'CT', '06854', 'ct'],
  ['Bridgeport', 'Bridgeport', 'CT', '06604', 'ct'],
  ['New Haven', 'New Haven', 'CT', '06510', 'ct'],
].map(([label, city, state, zip, region]) => ({ label, city, state, zip, region }));

const COUNTIES = {
  NY: {
    nyc: ['new york', 'kings', 'queens', 'bronx', 'richmond'],
    li: ['nassau', 'suffolk'],
    metroNorth: ['westchester', 'rockland', 'putnam', 'dutchess', 'orange'],
  },
  NJ: {
    nj: ['bergen', 'essex', 'hudson', 'hunterdon', 'mercer', 'middlesex', 'monmouth',
      'morris', 'passaic', 'somerset', 'sussex', 'union', 'warren'],
  },
  CT: { ct: ['fairfield', 'new haven', 'western connecticut', 'greater bridgeport',
    'south central connecticut', 'naugatuck valley'] },
};

const REGION_STATES = { nyc: 'NY', nj: 'NJ', li: 'NY', metroNorth: 'NY', ct: 'CT' };

export function regionOf({ city = '', state, county = '', zip = '', region }) {
  if (region && REGION_STATES[region] === state) return region;
  const normalizedCounty = county.toLowerCase().trim().replace(/ (county|planning region)$/, '');
  const stateRegions = COUNTIES[state] ?? {};
  for (const [region, counties] of Object.entries(stateRegions)) {
    if (counties.includes(normalizedCounty)) return region;
  }
  if (normalizedCounty) return null;

  const knownMarket = MARKETS.find((market) => market.state === state &&
    market.city.toLowerCase() === city.toLowerCase());
  if (knownMarket) return knownMarket.region;

  const prefix = Number(zip.slice(0, 3));
  if (state === 'NY') {
    if ([100, 101, 102, 103, 104, 111, 112, 113, 114, 116].includes(prefix) ||
        /^1100[45]$/.test(zip)) return 'nyc';
    if ([110, 115, 117, 118, 119].includes(prefix)) return 'li';
    if ([105, 106, 107, 108, 109, 125, 126].includes(prefix)) return 'metroNorth';
  }
  return null;
}
