const companies = [
  ['compass', 'Compass', 'compass.com', '/homes-for-rent/new-york-ny/', 'Brokerage'],
  ['serhant', 'SERHANT.', 'serhant.com', '/', 'Brokerage'],
  ['corcoran', 'Corcoran', 'corcoran.com', '/', 'Brokerage'],
  ['elliman', 'Douglas Elliman', 'elliman.com', '/', 'Brokerage'],
  ['bhs', 'Brown Harris Stevens', 'www.bhsusa.com', '/for-rent/new-york-city', 'Brokerage'],
  ['nooklyn', 'Nooklyn', 'nooklyn.com', '/', 'Brokerage'],
  ['realny', 'REAL New York', 'realnyproperties.com', '/', 'Brokerage'],
  ['livingny', 'Living New York', 'livingny.com', '/', 'Brokerage'],
  ['bondny', 'Bond New York', 'bondnewyork.com', '/', 'Brokerage'],
  ['mns', 'MNS', 'mns.com', '/', 'Brokerage'],
  ['nestseekers', 'Nest Seekers', 'nestseekers.com', '/', 'Brokerage'],
  ['kw', 'Keller Williams NYC', 'kwnyc.com', '/', 'Brokerage'],
  ['tribro', 'TriBro NYC', 'tribronyc.com', '/', 'Brokerage'],
  ['equity', 'Equity Residential', 'equityapartments.com', '/new-york-city', 'Owner or manager'],
  ['avalonbay', 'AvalonBay', 'avaloncommunities.com', '/', 'Owner or manager'],
  ['bozzuto', 'Bozzuto', 'bozzuto.com', '/', 'Owner or manager'],
  ['rose', 'Rose Associates', 'rosenyc.com', '/', 'Owner or manager'],
  ['related', 'Related Rentals', 'relatedrentals.com', '/', 'Owner or manager'],
  ['glenwood', 'Glenwood', 'glenwoodnyc.com', '/', 'Owner or manager'],
  ['brodsky', 'Brodsky', 'brodsky.com', '/', 'Owner or manager'],
  ['tfc', 'TF Cornerstone', 'tfc.com', '/', 'Owner or manager'],
  ['rockrose', 'Rockrose', 'rockrose.com', '/', 'Owner or manager'],
  ['twotrees', 'Two Trees', 'twotreesny.com', '/', 'Owner or manager'],
  ['stonehenge', 'Stonehenge NYC', 'www.stonehengenyc.com', '/apartments', 'Owner or manager'],
  ['durst', 'Durst Organization', 'durst.org', '/', 'Owner or manager'],
  ['greystar', 'Greystar', 'greystar.com', '/', 'Owner or manager'],
  ['udr', 'UDR', 'udr.com', '/', 'Owner or manager'],
  ['stuytown', 'StuyTown', 'www.stuytown.com', '/nyc-apartments-for-rent', 'Owner or manager'],
];

const companyText = (name: unknown) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');

export const NYC_COMPANIES = companies.map(([id, name, domain, path, type]) => ({
  id,
  name,
  domain: domain.replace(/^www\./, ''),
  type,
  url: 'https://' + domain + path,
}));

export function matchCompany(name: unknown) {
  const value = companyText(name);
  return NYC_COMPANIES.find((company) => {
    const base = companyText(company.name);
    return value === base || value.startsWith(base + ' ');
  });
}

export function companyMatches(company: unknown, query: unknown) {
  const requested = companyText(query);
  return !requested || companyText(company).includes(requested);
}

export function companyCounts(listings: { company?: string }[]) {
  const groups = new Map<string, number>();
  for (const { company } of listings) {
    if (company) groups.set(company, (groups.get(company) ?? 0) + 1);
  }
  const counts: Record<string, number> = {};
  for (const [name, count] of groups) {
    const company = matchCompany(name);
    if (company) counts[company.id] = (counts[company.id] ?? 0) + count;
  }
  return counts;
}
