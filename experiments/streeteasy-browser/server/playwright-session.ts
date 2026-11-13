import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserAction, BrowserDriver } from './browser-session.ts';

const MAX_RESPONSE = 8 * 1024 * 1024;
export const BROWSER_VIEWPORT = { width: 800, height: 600 };
export const browserLaunchOptions = () => ({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--js-flags=--max-old-space-size=96'] });
import { BrowserNetworkGuard } from './browser-network.ts';
export { allowedBrowserUrl } from './browser-network.ts';
export function blockedDocument(status: number | undefined): boolean { return status === undefined || status < 200 || status >= 300; }
export function recheckDeadline(retryAfter: string | undefined, now: number): number {
  const parsed = retryAfter && /^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter || '');
  return Math.max(now + 60000, Number.isFinite(parsed) ? parsed : 0);
}
export class PlaywrightDriver implements BrowserDriver {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private requestCount = 0;
  private readonly network = new BrowserNetworkGuard();
  private stopped = false;
  private documentStatus?: number;
  private nextRecheckAt = 0;
  private check() { if (this.stopped) throw new Error('Browser closed'); }
  async start() {
    // Deliberately retain Chromium sandbox. Never add --no-sandbox or stealth flags.
    this.check();
    const browser = await chromium.launch(browserLaunchOptions());
    if (this.stopped) { await browser.close(); this.check(); }
    this.browser = browser;
    this.context = await browser.newContext({ viewport: BROWSER_VIEWPORT, acceptDownloads: false, serviceWorkers: 'block' });
    this.check();
    await this.context.routeWebSocket('**/*', socket => socket.close());
    await this.context.route('**/*', async route => {
      if (++this.requestCount > 1000) { await route.abort(); return; }
      await this.network.route(route);
    });
    this.check();
    this.page = await this.context.newPage();
    this.check();
    this.context.on('page', page => { if (page !== this.page) void page.close(); });
    this.page.on('download', download => void download.cancel());
    this.page.setDefaultTimeout(15000);
    this.page.on('response', response => {
      if (response.url().startsWith('https://api-v6.streeteasy.com/') && [403, 429].includes(response.status())) {
        // Playwright sees the actual response headers, unlike CORS-filtered page fetch.
        this.nextRecheckAt = Math.max(this.nextRecheckAt, recheckDeadline(response.headers()['retry-after'], Date.now()));
      }
      if (response.request().isNavigationRequest() && response.frame() === this.page?.mainFrame()) {
        this.documentStatus = response.status();
        if (blockedDocument(this.documentStatus)) {
          const retry = response.headers()['retry-after'];
          this.nextRecheckAt = Math.max(this.nextRecheckAt, recheckDeadline(retry, Date.now()));
        }
      }
    });
    await this.page.goto('https://streeteasy.com/for-rent/nyc', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  async hasChallenge() { if (!this.page) return false; return blockedDocument(this.documentStatus) || await this.page.locator('#px-captcha, iframe[src*="captcha"], [data-testid="captcha"]').count() > 0; }
  async recheck() {
    this.check();
    if (!this.page || this.page.isClosed()) throw new Error('Browser unavailable');
    if (Date.now() < this.nextRecheckAt) throw new Error('Owner recheck cooldown');
    this.nextRecheckAt = Date.now() + 60000;
    this.documentStatus = undefined;
    // One explicit owner recheck only. Preserve cookies/context, never retry loops.
    const response = await this.page.goto('https://streeteasy.com/for-rent/nyc', { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.documentStatus = response?.status();
    if (await this.hasChallenge()) throw new Error('Source document is not ready');
  }
  async fetch(request: { url: string; init: RequestInit }) {
    if (!this.page || this.page.isClosed()) throw new Error('Browser unavailable');
    // Fetch executes inside the real page, retaining its cookies/session. No storage export.
    const result = await this.page.evaluate(async ({ url, body, max }) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 12000);
      try {
        const response = await fetch(url, { method: 'POST', body, credentials: 'include', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: abort.signal });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = []; let length = 0;
        if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new Error('Response too large'); } chunks.push(value); }
        const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return { status: response.status, body: new TextDecoder().decode(bytes), contentType: response.headers.get('Content-Type') || 'application/json', retryAfter: response.headers.get('Retry-After') || undefined };
      } finally { clearTimeout(timer); }
    }, { url: request.url, body: String(request.init.body), max: MAX_RESPONSE });
    if (result.status === 403 || result.status === 429) this.nextRecheckAt = Math.max(this.nextRecheckAt, recheckDeadline(result.retryAfter, Date.now()));
    return result;
  }
  async screenshot() { if (!this.page) throw new Error('Browser unavailable'); return this.page.screenshot({ type: 'jpeg', quality: 40, scale: 'css', timeout: 10000, clip: { x: 0, y: 0, ...BROWSER_VIEWPORT } }); }
  async action(action: BrowserAction) {
    if (!this.page) throw new Error('Browser unavailable');
    await performBrowserAction(this.page, action);
  }
  async close() { this.stopped = true; this.network.close(); await this.browser?.close(); this.browser = undefined; this.context = undefined; this.page = undefined; }
}


/** Provider-free runtime preflight. Failure prevents a healthy listening service. */
export async function verifyBrowserRuntime(): Promise<void> {
  const browser = await chromium.launch(browserLaunchOptions());
  await browser.close();
}

export async function performBrowserAction(page: Page, action: BrowserAction): Promise<void> {
  if (action.type === 'hold') {
    await page.mouse.move(action.x, action.y);
    try { await page.mouse.down(); await new Promise(resolve => setTimeout(resolve, action.durationMs)); }
    finally { await page.mouse.up(); }
  } else if (action.type === 'click') await page.mouse.click(action.x, action.y);
  else if (action.type === 'type') await page.keyboard.insertText(action.text);
  else await page.keyboard.press(action.key);
}
