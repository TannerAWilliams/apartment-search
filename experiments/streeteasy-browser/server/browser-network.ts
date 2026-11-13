import type { Route } from 'playwright';

const allowedHosts = new Set(['streeteasy.com', 'www.streeteasy.com', 'api-v6.streeteasy.com']);
const challengeSuffixes = ['.px-cloud.net', '.px-cdn.net', '.px-client.net', '.perimeterx.net'];
export function allowedBrowserUrl(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (allowedHosts.has(url.hostname) || challengeSuffixes.some(s => url.hostname.endsWith(s))); } catch { return false; }
}
/** Do not continue browser redirects: Playwright routes only intercept their first URL.
 * Intercepted fetches use the context request transport, not native browser transport.
 */
export async function guardBrowserRoute(route: Route): Promise<void> {
  if (!allowedBrowserUrl(route.request().url())) { await route.abort('blockedbyclient'); return; }
  if (route.request().resourceType() === 'image' && !challengeSuffixes.some(s => new URL(route.request().url()).hostname.endsWith(s))) { await route.abort('blockedbyclient'); return; }
  let response;
  try {
    response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 12000 });
    // Fail closed even for an allowed redirect. A later redirect destination must
    // never be contacted implicitly, and raw Location must not reach the browser.
    if (response.status() >= 300 && response.status() < 400) {
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Browser redirect blocked by source policy' });
      return;
    }
    await route.fulfill({ response });
  } catch { await route.abort('failed').catch(() => undefined); }
  finally { await response?.dispose(); }
}
