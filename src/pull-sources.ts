import type { FetchTransport } from './fetch-type.ts';
import base64 from 'base64-js';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { checkFirstMover } from '../server/firstmover.ts';
import { loadHousingConnect } from '../server/housing.ts';

const MAX_UNCOMPRESSED = 12 * 1024 * 1024;
type PullPlan = { market?: Parameters<typeof checkFirstMover>[0] };
type PublicResult = Awaited<ReturnType<typeof checkFirstMover>> | Awaited<ReturnType<typeof loadHousingConnect>>;
const PUBLIC_READERS: Record<string, (plan: PullPlan, fetcher: FetchTransport, now: Date) => Promise<PublicResult>> = {
  firstmover: (plan, fetcher) => checkFirstMover(plan.market, fetcher),
  housingconnect: (_plan, fetcher, now) => loadHousingConnect(fetcher, now),
};

export function retryablePublicSources(check: { sources?: { id: string; status?: string; retryAt?: string | null }[] }, now = new Date()) {
  return (check.sources ?? []).filter(({ id, status, retryAt }) => Object.hasOwn(PUBLIC_READERS, id) &&
    status === 'failed' && !(Date.parse(retryAt ?? '') > now.getTime())).map(({ id }) => id);
}

export async function pullPublicSources(plan: PullPlan, fetcher: FetchTransport = fetch, now = new Date(), ids = Object.keys(PUBLIC_READERS)) {
  const results = await Promise.allSettled(ids.map((id) => PUBLIC_READERS[id](plan, fetcher, now)));
  return Object.fromEntries(results.map((result, index) => [ids[index], result.status === 'fulfilled' ? result.value : null]));
}

export function encodeSourceImport(sources: unknown) {
  return { payload: base64.fromByteArray(gzipSync(strToU8(JSON.stringify(sources)))) };
}

export function decodeSourceImport(body: unknown) {
  if (!body || typeof body !== 'object' || !('payload' in body) || typeof body.payload !== 'string') throw new Error('A compressed source import is required.');
  const bytes = base64.toByteArray(body.payload);
  if (bytes.length < 18 ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true) > MAX_UNCOMPRESSED) {
    throw new Error('The source import is invalid or too large.');
  }
  const data = JSON.parse(strFromU8(gunzipSync(bytes)));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The source import is invalid.');
  return data;
}
