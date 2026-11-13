// Only public listing requests used by our adapters may leave this relay.
export function relayRequest(input: unknown): { url: string; init: RequestInit } | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (value.source === 'streeteasy') {
    if (!Number.isSafeInteger(value.page) || Number(value.page) < 1 || Number(value.page) > 2) return null;
    const range = value.lower !== undefined || value.upper !== undefined;
    if (range && (!Number.isSafeInteger(value.lower) || !Number.isSafeInteger(value.upper) ||
        Number(value.lower) < 0 || Number(value.upper) > 2147483647 || Number(value.lower) > Number(value.upper))) return null;
    const query = `query SearchRentals { searchRentals(input: {
      sorting: { attribute: LISTED_AT, direction: DESCENDING } adStrategy: NONE
      filters: { rentalStatus: ACTIVE ${range ? `price: { lowerBound: ${value.lower}, upperBound: ${value.upper} }` : ''} }
      perPage: 500 page: ${value.page}
    }) { totalCount edges { ... on OrganicRentalEdge { node {
      id street unit zipCode status bedroomCount price urlPath areaName buildingType geoPoint { latitude longitude }
    } } } } }`;
    return { url: 'https://api-v6.streeteasy.com/', init: { method: 'POST', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) } };
  }
  if (value.source === 'hotpads' && ['new-york-ny', 'jersey-city-nj', 'stamford-ct'].includes(String(value.market))) {
    return { url: `https://hotpads.com/${value.market}/condos-for-rent`, init: {
      method: 'GET', redirect: 'error', headers: { Accept: 'text/html' } } };
  }
  return null;
}
