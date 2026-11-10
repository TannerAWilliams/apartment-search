import { normalizeListing } from '../src/listings.mjs';
import { marketplaceIdForUrl } from '../src/marketplaces.mjs';
import { DEFAULT_FILTERS } from '../src/search.mjs';
import { geocodeRentalAddresses } from './geocode-rentals.mjs';

export const OPENIGLOO = { id: 'openigloo', name: 'Openigloo', kind: 'feed' };
const ENDPOINT = 'https://mcp.openigloo.com/mcp';
const SAMPLE_LIMIT = 10;
const MAX_RENT = DEFAULT_FILTERS.maxRent;
const PROTOCOL = '2025-11-25';

async function searchMcp(fetcher) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  async function request(payload) {
    const response = await fetcher(ENDPOINT, {
      method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...payload }),
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('Openigloo returned HTTP ' + response.status + '.');
    const session = response.headers.get('Mcp-Session-Id');
    if (session) headers['Mcp-Session-Id'] = session;
    if (response.status === 202 || response.status === 204) return null;
    const data = await response.text();
    const message = response.headers.get('Content-Type')?.includes('text/event-stream') ?
      data.split(/\r?\n/).filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6))).find((event) => event.id === payload.id) : JSON.parse(data);
    if (message?.error || (payload.id && message?.id !== payload.id)) throw new Error('The Openigloo request failed.');
    return message?.result;
  }
  const handshake = await request({ id: 1, method: 'initialize', params: {
    protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Apartment Search', version: '1.0' },
  } });
  if (handshake?.protocolVersion !== PROTOCOL) throw new Error('The Openigloo protocol changed.');
  headers['MCP-Protocol-Version'] = PROTOCOL;
  await request({ method: 'notifications/initialized' });
  const result = await request({ id: 2, method: 'tools/call', params: {
    name: 'search_apartments', arguments: { limit: SAMPLE_LIMIT, max_rent: MAX_RENT },
  } });
  if (result?.isError || !Array.isArray(result?.structuredContent?.apartments)) {
    throw new Error('Openigloo did not return listing results.');
  }
  return result.structuredContent;
}

export async function loadOpenigloo(fetcher = fetch, now = new Date()) {
  const result = await searchMcp(fetcher);
  const listings = result.apartments.slice(0, SAMPLE_LIMIT).flatMap((row) => {
    if (typeof row?.address !== 'string') return [];
    const parts = row.address.match(/^(.+),\s*([^,]+),\s*NY\s+(\d{5})$/i);
    if (!parts || row.status !== 'for_rent' || marketplaceIdForUrl(row.url) !== OPENIGLOO.id ||
        !row.url.includes('/unit/nyc/') || Number(row.rent_per_month) > MAX_RENT) return [];
    const listing = normalizeListing({
      id: row.id, address: parts[1].trim().replace(/\s+/g, ' '), city: row.borough || parts[2].trim(),
      state: 'NY', zipCode: parts[3], region: 'nyc', neighborhood: row.neighborhood,
      bedrooms: row.bedrooms, rent: row.rent_per_month, url: row.url, status: 'Active', updatedAt: now.toISOString(),
    }, OPENIGLOO);
    return listing ? [listing] : [];
  });
  return { listings: await geocodeRentalAddresses(listings, fetcher).catch(() => listings),
    total: Math.max(listings.length, Number(result.total_matches) || 0), sampleLimit: SAMPLE_LIMIT, rentLimit: MAX_RENT };
}
