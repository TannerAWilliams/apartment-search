import type { Route } from 'playwright';

const allowedHosts = new Set(['streeteasy.com', 'www.streeteasy.com', 'api-v6.streeteasy.com']);
const challengeSuffixes = ['.px-cloud.net', '.px-cdn.net', '.px-client.net', '.perimeterx.net'];
export function allowedBrowserUrl(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (allowedHosts.has(url.hostname) || challengeSuffixes.some(s => url.hostname.endsWith(s))); } catch { return false; }
}
export const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SESSION_BYTES = 128 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_CONCURRENT = 4;
const MAX_WAITING = 8;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Bounded server transport, NOT native browser transport. Cookies only pass to
 * the exact allowed request destination, inside this process. Never log headers.
 */
export class BrowserNetworkGuard {
  private stopped = false;
  private active = 0;
  private received = 0;
  private waiters: Array<(ok: boolean) => void> = [];
  private controllers = new Set<AbortController>();
  private readonly transport: Fetcher;
  constructor(transport: Fetcher = fetch) { this.transport = transport; }
  private async enter(): Promise<boolean> {
    if (this.stopped) return false;
    if (this.active < MAX_CONCURRENT) { this.active++; return true; }
    if (this.waiters.length >= MAX_WAITING) return false;
    return new Promise(resolve => this.waiters.push(resolve));
  }
  private leave() {
    const next = this.waiters.shift();
    if (next) next(true); else this.active--;
  }
  close() {
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    for (const waiter of this.waiters.splice(0)) waiter(false);
  }
  async route(route: Route): Promise<void> {
    const request = route.request();
    if (!allowedBrowserUrl(request.url())) { await route.abort('blockedbyclient'); return; }
    if (request.resourceType() === 'image' && !challengeSuffixes.some(s => new URL(request.url()).hostname.endsWith(s))) { await route.abort('blockedbyclient'); return; }
    if (!await this.enter()) { await route.abort('blockedbyclient'); return; }
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      if (this.stopped) throw new Error('Browser network closed');
      const body = request.postDataBuffer();
      if (body && body.length > MAX_REQUEST_BYTES) throw new Error('Request body limit');
      const headers = new Headers(await request.allHeaders());
      // Let fetch frame its own request. Never forward hop-by-hop headers.
      const nominated = (headers.get('connection') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      for (const key of ['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'proxy-connection', 'te', 'trailer', ...nominated]) headers.delete(key);
      headers.set('accept-encoding', 'identity');
      const response = await this.transport(request.url(), {
        method: request.method(), headers, body: body ? new Uint8Array(body) : undefined,
        redirect: 'manual', signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Browser redirect blocked by source policy' });
        return;
      }
      const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
      if (encoding && !['identity', 'gzip', 'deflate', 'br'].includes(encoding)) { await response.body?.cancel(); throw new Error('Unsupported response encoding'); }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_RESOURCE_BYTES) { await response.body?.cancel(); throw new Error('Resource limit'); }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        if (reader) while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength; this.received += value.byteLength;
          if (length > MAX_RESOURCE_BYTES || this.received > MAX_SESSION_BYTES) { this.close(); throw new Error('Resource budget exceeded'); }
          chunks.push(value);
        }
      } catch (error) { await reader?.cancel().catch(() => undefined); throw error; }
      if (this.stopped || controller.signal.aborted) throw new Error('Network canceled');
      const responseHeaders: Record<string, string> = Object.fromEntries(response.headers);
      // Fetch decodes content encodings. Fulfill must describe the decoded bytes.
      const responseNominated = (response.headers.get('connection') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      for (const key of ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', ...responseNominated]) delete responseHeaders[key];
      const cookies = response.headers.getSetCookie();
      if (cookies.length) responseHeaders['set-cookie'] = cookies.join('\n');
      await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.concat(chunks, length) });
    } catch { await route.abort('failed').catch(() => undefined); }
    finally { clearTimeout(timeout); this.controllers.delete(controller); this.leave(); }
  }
}
