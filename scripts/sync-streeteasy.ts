import type { FetchTransport } from '../src/fetch-type.ts';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { loadStreetEasy, STREETEASY_LIVE } from '../server/streeteasy.ts';
import { encodeSourceImport } from '../src/source-import.ts';

/** The deployed Worker rejects authenticated /api/refresh bodies larger than this. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

type SourceStatus = { id: string; transport?: string; status?: string; updatedAt?: string; retryAt?: string; listingCount?: number; total?: number };
type AppResponse = { state?: string; refresh?: { sources: SourceStatus[] } };

export function appOrigin(value: string | undefined) {
  if (!value) throw new Error('Set APARTMENT_SEARCH_ORIGIN to the apartment-search Worker URL, for example https://apartment-search.<subdomain>.workers.dev.');
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('APARTMENT_SEARCH_ORIGIN must use HTTPS.');
  return url.origin;
}

/** Encodes the import exactly as uploaded, refusing bodies the Worker would reject. */
export function importBody(data: unknown, manual = false, limit = MAX_IMPORT_BYTES) {
  const body = JSON.stringify({ ...encodeSourceImport({ [STREETEASY_LIVE.id]: data }), fallback: true, ...(manual ? { source: STREETEASY_LIVE.id } : {}) });
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > limit) {
    throw new Error(`The StreetEasy import is ${bytes} bytes, above the Worker's ${limit}-byte upload limit. Saved listings are unchanged.`);
  }
  return { body, bytes };
}

export async function syncStreetEasy({ token, manual = false, origin, fetcher = fetch }: { token: string; manual?: boolean; origin: string; fetcher?: FetchTransport }) {
  if (!token || /[\r\n]/.test(token)) throw new Error('The app access token is required.');
  async function request(path: string, body?: string) {
    const response = await fetcher(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body, redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('Apartment Search returned HTTP ' + response.status + ' for ' + path + '.');
    return await response.json() as AppResponse;
  }
  const streetEasyStatus = (data: AppResponse) => data.refresh?.sources.find(({ id }) => id === STREETEASY_LIVE.id);

  const status = streetEasyStatus(await request('/api/config'));
  if (!manual && status?.transport === 'v6-daily' && ['updated', 'current'].includes(status.status ?? '') &&
      Date.now() - Date.parse(status.updatedAt ?? '') < 24 * 60 * 60_000) {
    return { state: 'already_current', listingCount: status.listingCount };
  }
  if (Date.parse(status?.retryAt ?? '') > Date.now()) throw new Error('StreetEasy recovery is waiting for its source retry time.');

  let data;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { data = await loadStreetEasy(fetcher); break; }
    catch (error) {
      if (attempt || !(error instanceof Error) || !/inventory changed|incomplete inventory/.test(error.message)) throw error;
    }
  }
  if (!data) throw new Error('StreetEasy did not return an inventory.');

  const { body, bytes } = importBody(data, manual);
  const outcome = await request('/api/refresh', body);
  if (outcome.state === 'running') throw new Error('Another refresh owns the lock; retry after it finishes.');

  const saved = streetEasyStatus(await request('/api/config'));
  const savedAt = Date.parse(saved?.updatedAt ?? '');
  const checkedAt = Date.parse(data.checkedAt);
  if (saved?.status !== 'updated' || saved.transport !== 'v6-daily' || saved.total !== data.total ||
      saved.listingCount !== data.listings.length || !Number.isFinite(savedAt) || !Number.isFinite(checkedAt) || savedAt < checkedAt) {
    throw new Error('The imported inventory was not verified in the hosted app.');
  }
  return { state: 'updated', total: data.total, listingCount: saved.listingCount, requests: data.pages, uploadBytes: bytes, updatedAt: saved.updatedAt };
}

/** The command line: reads the app access token from stdin, syncs, and prints a JSON summary. */
export async function main({ argv = process.argv, env = process.env, input = process.stdin as Readable, sync = syncStreetEasy, log = console.log }: {
  argv?: string[]; env?: Record<string, string | undefined>; input?: Readable;
  sync?: typeof syncStreetEasy; log?: (line: string) => void;
} = {}) {
  const flag = argv.find((value) => value.startsWith('--origin='));
  const origin = appOrigin(flag?.slice('--origin='.length) ?? env.APARTMENT_SEARCH_ORIGIN);
  const lines = createInterface({ input });
  const token = await new Promise<string>((resolve, reject) => {
    lines.once('line', (line) => resolve(line.trim()));
    lines.once('close', () => reject(new Error('Pass the app access token on stdin.')));
  });
  lines.close(); input.pause();
  log(JSON.stringify({ at: new Date().toISOString(), ...await sync({ token, origin, manual: argv.includes('--manual') }) }));
}

if (import.meta.main) await main();
