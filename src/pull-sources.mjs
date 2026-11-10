import base64 from 'base64-js';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { checkFirstMover } from '../server/firstmover.mjs';
import { loadHousingConnect } from '../server/housing.mjs';

const MAX_UNCOMPRESSED = 12 * 1024 * 1024;

export async function pullPublicSources(plan, fetcher = fetch, now = new Date()) {
  const results = await Promise.allSettled([
    checkFirstMover(plan.market, fetcher),
    loadHousingConnect(fetcher, now),
  ]);
  return Object.fromEntries(results.map((result, i) => [
    i === 0 ? 'firstmover' : 'housingconnect',
    result.status === 'fulfilled' ? result.value : null,
  ]));
}

export function encodeSourceImport(sources) {
  return { payload: base64.fromByteArray(gzipSync(strToU8(JSON.stringify(sources)))) };
}

export function decodeSourceImport(body) {
  if (typeof body?.payload !== 'string') throw new Error('A compressed source import is required.');
  const bytes = base64.toByteArray(body.payload);
  if (bytes.length < 18 ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true) > MAX_UNCOMPRESSED) {
    throw new Error('The source import is invalid or too large.');
  }
  const data = JSON.parse(strFromU8(gunzipSync(bytes)));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The source import is invalid.');
  return data;
}
