import type { FetchTransport } from '../src/fetch-type.ts';
import { createInterface } from 'node:readline';
import { loadStreetEasy, STREETEASY_LIVE } from '../server/streeteasy.ts';
import { encodeSourceImport } from '../src/pull-sources.ts';


export async function syncStreetEasy({ token, manual = false, origin = 'https://apartment-search-metro-nyc.adepthen22.chatgpt.site', fetcher = fetch }: { token: string; manual?: boolean; origin?: string; fetcher?: FetchTransport }) {
if (!token || /[\r\n]/.test(token)) throw new Error('An owner service credential is required.');
async function request(path: string, body?: object) {
  const response = await fetcher(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'OAI-Sites-Authorization': 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Apartment Search returned HTTP ' + response.status);
  return response.json();
}
const config = await request('/api/config');
const status = config.refresh?.sources.find(({id}) => id === STREETEASY_LIVE.id);

if (!manual && status?.transport === 'v6-daily' && ['updated','current'].includes(status.status) &&
    Date.now() - Date.parse(status.updatedAt) < 24 * 60 * 60_000) {
  return {state:'already_current',listingCount:status.listingCount};
} else {
  if (Date.parse(status?.retryAt) > Date.now()) throw new Error('StreetEasy recovery is waiting for its source retry time.');
  let data;
  for (let attempt=0; attempt<2; attempt++) {
    try { data=await loadStreetEasy(fetcher); break; }
    catch(error) {
      if(attempt || !(error instanceof Error) || !/inventory changed|incomplete inventory/.test(error.message)) throw error;
    }
  }
  const outcome=await request('/api/refresh',{...encodeSourceImport({[STREETEASY_LIVE.id]:data}),fallback:true,...(manual ? {source:STREETEASY_LIVE.id} : {})});
  if(outcome.state==='running')throw new Error('Another refresh owns the lock; retry after it finishes.');
  const saved=(await request('/api/config')).refresh?.sources.find(({id})=>id===STREETEASY_LIVE.id);
  if(saved?.status!=='updated' || saved.transport!=='v6-daily' || saved.total!==data.total ||
      saved.listingCount!==data.listings.length || Date.parse(saved.updatedAt)<Date.parse(data.checkedAt)) {
    throw new Error('The imported inventory was not verified in the hosted app.');
  }
  return {state:'updated',total:data.total,listingCount:saved.listingCount,requests:data.pages,updatedAt:saved.updatedAt};
}

}

if (import.meta.main) {
  const input = createInterface({ input: process.stdin });
  const token = await new Promise<string>((resolve, reject) => {
    input.once('line', resolve);
    input.once('close', () => reject(new Error('An owner service credential is required on stdin.')));
  });
  input.close(); process.stdin.pause();
  console.log(JSON.stringify(await syncStreetEasy({ token, manual: process.argv.includes('--manual') })));
}
