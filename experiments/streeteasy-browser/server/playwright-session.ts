import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserAction, BrowserDriver } from './browser-session.ts';

const MAX_RESPONSE = 8 * 1024 * 1024;
const allowedHosts = new Set(['streeteasy.com', 'www.streeteasy.com', 'api-v6.streeteasy.com']);
const challengeSuffixes = ['.px-cloud.net', '.px-cdn.net', '.px-client.net', '.perimeterx.net'];
export function allowedBrowserUrl(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (allowedHosts.has(url.hostname) || challengeSuffixes.some(s => url.hostname.endsWith(s))); } catch { return false; }
}
export class PlaywrightDriver implements BrowserDriver {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private requestCount = 0;
  private stopped = false;
  private check() { if (this.stopped) throw new Error('Browser closed'); }
  async start() {
    // Deliberately retain Chromium sandbox. Never add --no-sandbox or stealth flags.
    this.check();
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
    if (this.stopped) { await browser.close(); this.check(); }
    this.browser = browser;
    this.context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: false, serviceWorkers: 'block' });
    this.check();
    await this.context.routeWebSocket('**/*', socket => socket.close());
    await this.context.route('**/*', async route => {
      if (++this.requestCount > 1000 || !allowedBrowserUrl(route.request().url())) { await route.abort(); return; }
      if (route.request().resourceType() === 'image' && !challengeSuffixes.some(s => new URL(route.request().url()).hostname.endsWith(s))) { await route.abort(); return; }
      await route.continue();
    });
    this.check();
    this.page = await this.context.newPage();
    this.check();
    this.context.on('page', page => { if (page !== this.page) void page.close(); });
    this.page.on('download', download => void download.cancel());
    this.page.setDefaultTimeout(15000);
    await this.page.goto('https://streeteasy.com/for-rent/nyc', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  async hasChallenge() { if (!this.page) return false; return await this.page.locator('#px-captcha, iframe[src*="captcha"], [data-testid="captcha"]').count() > 0; }
  async fetch(request: { url: string; init: RequestInit }) {
    if (!this.page || this.page.isClosed()) throw new Error('Browser unavailable');
    // Fetch executes inside the real page, retaining its cookies/session. No storage export.
    return this.page.evaluate(async ({ url, body, max }) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 12000);
      try {
        const response = await fetch(url, { method: 'POST', body, credentials: 'include', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: abort.signal });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = []; let length = 0;
        if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new Error('Response too large'); } chunks.push(value); }
        const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return { status: response.status, body: new TextDecoder().decode(bytes), contentType: response.headers.get('Content-Type') || 'application/json' };
      } finally { clearTimeout(timer); }
    }, { url: request.url, body: String(request.init.body), max: MAX_RESPONSE });
  }
  async screenshot() { if (!this.page) throw new Error('Browser unavailable'); return this.page.screenshot({ type: 'jpeg', quality: 60 }); }
  async action(action: BrowserAction) {
    if (!this.page) throw new Error('Browser unavailable');
    if (action.type === 'click') await this.page.mouse.click(action.x, action.y);
    else if (action.type === 'type') await this.page.keyboard.insertText(action.text);
    else await this.page.keyboard.press(action.key);
  }
  async close() { this.stopped = true; await this.browser?.close(); this.browser = undefined; this.context = undefined; this.page = undefined; }
}
