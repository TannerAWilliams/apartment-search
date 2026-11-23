/**
 * The Worker runs on Cloudflare's runtime (workerd), not Bun. Where workerd refuses a fetch option that Bun
 * accepts, test fetches refuse it too, so code that would fail in production fails its tests. Each rule
 * here was seen in production.
 */
export function checkWorkersFetchInit(init: RequestInit | undefined) {
  // Workers Logs, 2026-11-23: 'Invalid redirect value, must be one of "follow" or "manual"'.
  if (init?.redirect === 'error') throw new TypeError('Invalid redirect value, must be one of "follow" or "manual" (Cloudflare Workers)');
}
