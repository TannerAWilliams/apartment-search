import { createHash } from 'node:crypto';
import { safeListingUrl } from '../src/marketplaces.ts';
import { NOTE_LIMIT, VIEWING_STATUSES } from '../src/saved-notes.ts';

export type VerifiedIdentity = { issuer: string; subject: string };
export type ShortlistEntry = { key: string; label: string; url: string | null; rent: number | null; bedrooms: number | null; notes: string; status: string; compare: boolean };
type Bucket = { get(key: string): Promise<any>; put(key: string, body: string, options: any): Promise<any> };
type VerifyBearer = (token: string) => Promise<VerifiedIdentity | null>;
const MAX_ENTRIES = 100;
const MAX_BYTES = 256 * 1024;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff',
} });
function validIdentity(value: any): value is VerifiedIdentity {
  return !!value && typeof value.issuer === 'string' && value.issuer.length > 0 && value.issuer.length <= 2048 &&
    typeof value.subject === 'string' && value.subject.length > 0 && value.subject.length <= 512;
}
function keyFor(identity: VerifiedIdentity) {
  return 'private-shortlists/v1/' + createHash('sha256').update(JSON.stringify([identity.issuer, identity.subject])).digest('hex');
}
function parseEntries(value: unknown): ShortlistEntry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) throw new Error('Invalid shortlist.');
  const keys = new Set();
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || !entry.key || entry.key.length > 500 || keys.has(entry.key) ||
        typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 300 ||
        typeof entry.notes !== 'string' || entry.notes.length > NOTE_LIMIT || !VIEWING_STATUSES.includes(entry.status) || typeof entry.compare !== 'boolean' ||
        (entry.rent !== null && (!Number.isFinite(entry.rent) || entry.rent <= 0 || entry.rent > 100000)) ||
        (entry.bedrooms !== null && (!Number.isInteger(entry.bedrooms) || entry.bedrooms < 0 || entry.bedrooms > 20)) ||
        (entry.url !== null && (typeof entry.url !== 'string' || entry.url.length > 2048 || !safeListingUrl(entry.url)))) throw new Error('Invalid shortlist entry.');
    keys.add(entry.key);
    // Pick fields explicitly: discard caller identity/prototype/arbitrary metadata.
    return { key: entry.key, label: entry.label, url: entry.url === null ? null : safeListingUrl(entry.url), rent: entry.rent,
      bedrooms: entry.bedrooms, notes: entry.notes, status: entry.status, compare: entry.compare };
  });
}
async function readBounded(request: Request) {
  if (!request.body) throw new Error('Missing body.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Request too large.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Deliberately NOT mounted. A trusted issuer/audience/signature-verifying adapter is required.
 * Never implement verifyBearer by decoding an unverified JWT, trusting request IDs, or using APP_ACCESS_TOKEN.
 * Bucket must be durable and dedicated to private data before production wiring. No cookie authentication.
 */
export function createPrivateShortlistHandler({ bucket, verifyBearer }: { bucket?: Bucket; verifyBearer?: VerifyBearer } = {}) {
  return async (request: Request): Promise<Response> => {
    if (!bucket || !verifyBearer) return response({ error: 'Private sync is not configured.' }, 503);
    if (!['GET', 'PUT'].includes(request.method)) return response({ error: 'Method not allowed.' }, 405);
    const authorization = request.headers.get('Authorization') ?? '';
    if (!/^Bearer [^\s]{1,8192}$/.test(authorization)) return response({ error: 'Individual sign-in required.' }, 401);
    let identity;
    try { identity = await verifyBearer(authorization.slice(7)); } catch { return response({ error: 'Individual sign-in required.' }, 401); }
    if (!validIdentity(identity)) return response({ error: 'Individual sign-in required.' }, 401);
    const key = keyFor(identity);
    try {
      if (request.method === 'GET') {
        const object = await bucket.get(key);
        if (!object) return response({ revision: null, entries: [] });
        const stored = await object.json();
        if (stored?.version !== 1) throw new Error('Unknown stored schema.');
        return response({ revision: object.etag, entries: parseEntries(stored.entries) });
      }
      let payload, entries;
      try {
        if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('JSON required.');
        payload = await readBounded(request);
        if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'revision') ||
            (payload.revision !== null && (typeof payload.revision !== 'string' || !payload.revision || payload.revision.length > 256))) throw new Error('Revision required.');
        entries = parseEntries(payload.entries);
      } catch { return response({ error: 'Invalid shortlist. Maximum 100 entries; notes up to 2,000 characters. Include the revision from your last read.' }, 400); }
      const saved = await bucket.put(key, JSON.stringify({ version: 1, entries }), {
        onlyIf: payload.revision === null ? { etagDoesNotMatch: '*' } : { etagMatches: payload.revision },
      });
      if (!saved) return response({ error: 'Shortlist changed on another device. Reload and reconcile before saving.' }, 409);
      return response({ revision: saved.etag, entries });
    } catch { return response({ error: 'Private shortlist storage is unavailable. Your changes were not confirmed.' }, 503); }
  };
}
