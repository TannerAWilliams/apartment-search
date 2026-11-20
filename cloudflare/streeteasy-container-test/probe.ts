// Runs inside the Cloudflare container. Makes the same ordinary requests as the
// home-computer sync and reports the outcome; it uploads nothing.
// A refused first request stops the loader immediately, with no retries.
import { loadStreetEasy } from '../../server/streeteasy.ts';

const started = Date.now();
let result: Record<string, unknown>;
try {
  const data = await loadStreetEasy(fetch);
  result = { ok: true, total: data.total, listings: data.listings.length, requests: data.pages };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  result = { ok: false, error: message, httpStatus: (error as { httpStatus?: number })?.httpStatus ?? null };
}
Object.assign(result, {
  ms: Date.now() - started,
  finishedAt: new Date().toISOString(),
  location: process.env.CLOUDFLARE_LOCATION ?? null,
  country: process.env.CLOUDFLARE_COUNTRY_A2 ?? null,
});
console.log(JSON.stringify(result));
try {
  await fetch('http://report.internal/', { method: 'POST', body: JSON.stringify(result), signal: AbortSignal.timeout(10000) });
} catch (error) {
  console.error('Could not report the result to the Worker:', error);
}
process.exit(result.ok ? 0 : result.httpStatus === 403 ? 3 : 1);
