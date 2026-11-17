import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { marketplaceIdForUrl } from '../src/marketplaces.ts';
import { searchBorough } from '../src/regions.ts';
import { geocodeRentalAddresses } from './geocode-rentals.ts';

export const OPENIGLOO = { id: 'openigloo', name: 'Openigloo', kind: 'feed' };
const ENDPOINT = 'https://mcp.openigloo.com/mcp';
const SAMPLE_LIMIT = 10;
const BOROUGHS = ['Manhattan', 'Brooklyn'];
const SEARCHES = BOROUGHS.flatMap((area) => [1, 2].map((bedrooms) => ({ area, bedrooms })));
export const OPENIGLOO_SAMPLE_LIMIT = SAMPLE_LIMIT * SEARCHES.length;
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
  return Promise.all(SEARCHES.map(async ({ area, bedrooms }, index) => {
    const result = await request({ id: index + 2, method: 'tools/call', params: {
      name: 'search_apartments', arguments: { area, bedrooms: [bedrooms], limit: SAMPLE_LIMIT },
    } });
    if (result?.isError || !Array.isArray(result?.structuredContent?.apartments)) {
      throw new Error('Openigloo did not return listing results.');
    }
    return { ...result.structuredContent, area, bedrooms };
  }));
}

export async function loadOpenigloo(fetcher: FetchTransport = fetch, now = new Date()) {
  const results = await searchMcp(fetcher);
  const listings = results.flatMap(({ area, bedrooms, apartments }) => apartments.slice(0, SAMPLE_LIMIT).flatMap((row) => {
    if (typeof row?.address !== 'string') return [];
    const parts = row.address.match(/^(.+),\s*([^,]+),\s*NY\s+(\d{5})$/i);
    if (!parts || row.status !== 'for_rent' || marketplaceIdForUrl(row.url) !== OPENIGLOO.id ||
        !row.url.includes('/unit/nyc/') || searchBorough({ state: 'NY', zip: parts[3] }) !== area.toLowerCase() ||
        row.bedrooms !== bedrooms) return [];
    const listing = normalizeListing({
      id: row.id, address: parts[1].trim().replace(/\s+/g, ' '), city: area,
      state: 'NY', zipCode: parts[3], region: 'nyc', neighborhood: row.neighborhood,
      bedrooms: row.bedrooms, rent: row.rent_per_month, url: row.url, status: 'Active', updatedAt: now.toISOString(),
    }, OPENIGLOO);
    return listing ? [listing] : [];
  }));
  const total = results.reduce((sum, { total_matches }) => sum + (Number(total_matches) || 0), 0);
  return { listings: await geocodeRentalAddresses(listings, fetcher).catch(() => listings),
    total: Math.max(listings.length, total), sampleLimit: OPENIGLOO_SAMPLE_LIMIT };
}
