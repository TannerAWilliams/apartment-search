import base64 from 'base64-js';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { isRecord } from './domain.ts';

const MAX_UNCOMPRESSED = 12 * 1024 * 1024;

export function encodeSourceImport(sources: unknown) {
  return { payload: base64.fromByteArray(gzipSync(strToU8(JSON.stringify(sources)))) };
}

export function decodeSourceImport(body: unknown) {
  if (!body || typeof body !== 'object' || !('payload' in body) || typeof body.payload !== 'string')
    throw new Error('A compressed source import is required.');
  const bytes = base64.toByteArray(body.payload);
  if (
    bytes.length < 18 ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true) > MAX_UNCOMPRESSED
  ) {
    throw new Error('The source import is invalid or too large.');
  }
  const data = JSON.parse(strFromU8(gunzipSync(bytes)));
  if (!isRecord(data)) throw new Error('The source import is invalid.');
  return data;
}
