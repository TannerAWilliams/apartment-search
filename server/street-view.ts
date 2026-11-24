/**
 * Street-level photos for listing cards, from the Google Street View Static API, kept free of charge:
 * - Google's metadata check, which is free, runs first; an image is requested only where Street View has one.
 * - Every image counts against a monthly cap (STREET_VIEW_MONTHLY_LIMIT, 9,000 by default) kept in D1, safely below
 *   Google's free monthly allowance. Past it the route answers 429 and cards show their map instead.
 * - Images pass straight through to the browser, which may keep them a day; nothing is stored on the server, as
 *   Google's terms require. The key stays a Worker secret and never reaches the page.
 * Set a daily quota on the key in Google Cloud too, so no bug here can go past the free allowance.
 */
import type { SourceFetch } from './contracts.ts';
import type { D1Database } from './storage/d1-bucket.ts';

export const STREET_VIEW_DEFAULT_MONTHLY_LIMIT = 9000;
const ENDPOINT = 'https://maps.googleapis.com/maps/api/streetview';

/** The monthly cap: STREET_VIEW_MONTHLY_LIMIT when it is a whole number from 0 to 100,000, else the default. */
export function streetViewLimit(value: string | undefined) {
  const limit = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isSafeInteger(limit) && limit >= 0 && limit <= 100_000
    ? limit
    : STREET_VIEW_DEFAULT_MONTHLY_LIMIT;
}

/** Counts one image against the month, in one statement; false once the month has reached the cap. */
export async function reserveStreetViewImage(database: D1Database, month: string, limit: number) {
  if (limit <= 0) return false;
  const row = await database
    .prepare(
      `INSERT INTO street_view_usage (month, images) VALUES (?1, 1)
       ON CONFLICT(month) DO UPDATE SET images = images + 1 WHERE images < ?2
       RETURNING images`,
    )
    .bind(month, limit)
    .first<{ images: number }>();
  return row !== null;
}

type StreetViewResult = { status: 200; body: ReadableStream | null; contentType: string } | { status: 404 | 429 | 502; error: string };

/** The Street View image at a point, or why there is none. */
export async function streetViewImage(
  { key, database, limit }: { key: string; database: D1Database; limit: number },
  { latitude, longitude }: { latitude: number; longitude: number },
  fetcher: SourceFetch,
  now = new Date(),
): Promise<StreetViewResult> {
  const location = `${latitude},${longitude}`;
  const query = new URLSearchParams({ location, source: 'outdoor', key });
  const metadata = await fetcher(`${ENDPOINT}/metadata?${query}`, { signal: AbortSignal.timeout(8000) });
  const found = metadata.ok ? ((await metadata.json().catch(() => null)) as { status?: unknown } | null) : null;
  if (found?.status !== 'OK') return { status: 404, error: 'Street View has no image here.' };
  if (!(await reserveStreetViewImage(database, now.toISOString().slice(0, 7), limit)))
    return { status: 429, error: 'This month’s free Street View images are used up; maps are shown instead.' };
  query.set('size', '640x400');
  query.set('return_error_code', 'true');
  const image = await fetcher(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(10_000) });
  const contentType = image.headers.get('content-type') ?? '';
  if (!image.ok || !contentType.startsWith('image/')) return { status: 502, error: 'Street View did not return an image.' };
  return { status: 200, body: image.body, contentType };
}
