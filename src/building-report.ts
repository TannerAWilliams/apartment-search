import { regionOf } from './regions.ts';

const JUSTFIX_WHO_OWNS_WHAT = 'https://whoownswhat.justfix.org/en';
export const JUSTFIX_RENT_HISTORY_URL = 'https://app.justfix.org/en/rh/splash';

export function justFixOwnershipUrl(bbl?: string | null): string {
  return bbl && /^[1-5]\d{9}$/.test(bbl)
    ? `${JUSTFIX_WHO_OWNS_WHAT}/bbl/${bbl}`
    : JUSTFIX_WHO_OWNS_WHAT;
}

export const BUILDING_SOURCES = [
  { name: 'HPD Online', url: 'https://www.nyc.gov/site/hpd/about/hpd-online.page', purpose: 'Housing maintenance complaints, issued violations, registration and other building records.' },
  { name: 'DOB building history', url: 'https://www.nyc.gov/site/buildings/tenant/get-building-history.page', purpose: 'Official instructions for BIS and DOB NOW. Check both systems for complaints, violations, permits and inspections.' },
  { name: 'HPD violations dataset', url: 'https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5/about_data', purpose: 'Agency-issued housing-code violations; records and status may lag current conditions.' },
  { name: 'HPD complaints and problems dataset', url: 'https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Complaint-Problems/ygpa-z7cr', purpose: 'Public reports of housing conditions. One complaint can include several problems; row counts are not complaint counts.' },
  { name: 'NYC 311 service requests', url: 'https://data.cityofnewyork.us/d/erm2-nwe9', purpose: 'Service requests by problem, agency, and location.' },
  { name: 'NYC recorded deeds and property documents', url: 'https://www.nyc.gov/site/finance/property/acris.page', purpose: 'Use the borough, block, and lot to check the relevant deed records.' },
  { name: 'NYS HCR rent registration', url: 'https://hcr.ny.gov/office-rent-administration-ora', purpose: 'State rent-regulated building search and registration data.' },
  { name: 'Request rent history from HCR', url: 'https://portal.hcr.ny.gov/app/ask', purpose: 'Tenants can request their own apartment’s rent history or ask about its stabilization status.' },
  { name: 'HPD bedbug annual reporting', url: 'https://www.nyc.gov/site/hpd/services-and-information/bedbugs.page', purpose: 'Review the owner-filed annual report period and history in HPD Online. A filing is not an independent inspection or a guarantee of current conditions.' },
  { name: 'NYC flood maps', url: 'https://www.nyc.gov/site/floodmaps/maps/your-risk.page', purpose: 'Look up the exact property on official flood maps; distinguish map editions and risk scenarios. No flood-zone result has been checked here.' },
] as const;
export function buildingReport(listing: any) {
  const location = Object.fromEntries(['state', 'county', 'zip', 'city'].map(key => [key, typeof listing?.[key] === 'string' ? listing[key] : ''])) as { state: string; county: string; zip: string; city: string };
  const nyc = location.state === 'NY' && regionOf(location) === 'nyc';
  return {
    address: [listing?.address, listing?.city, listing?.state, listing?.zip].filter(value => typeof value === 'string' && value.trim()).join(', '),
    scope: nyc ? 'NYC official-record review' : 'NYC jurisdiction not established',
    nyc,
    identity: 'Not matched to an official building identifier',
    complaints: null, violations: null, checkedAt: null,
    sources: nyc ? BUILDING_SOURCES : [],
    notice: 'No official building records have been fetched or matched in this report. Unknown does not mean zero, clear, safe, or violation-free. A complaint is an allegation/report, not an issued violation. Verify dates, status and building identity in the official records.',
  };
}
