import { relayRequest } from '../../../server/relay-policy.ts';

export type BrowserState = 'idle' | 'ready' | 'busy' | 'challenge' | 'failed' | 'closed';
export type BrowserAction = { type: 'click'; x: number; y: number } | { type: 'type'; text: string } | { type: 'key'; key: 'Enter' | 'Tab' | 'Backspace' };
export interface BrowserDriver {
  start(): Promise<void>;
  hasChallenge(): Promise<boolean>;
  recheck(): Promise<void>;
  fetch(request: { url: string; init: RequestInit }): Promise<{ status: number; body: string; contentType: string }>;
  screenshot(): Promise<Uint8Array>;
  action(action: BrowserAction): Promise<void>;
  close(): Promise<void>;
}
export class BrowserSession {
  private current: BrowserState = 'idle';
  private disposed = false;
  private driver: BrowserDriver | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private expires?: ReturnType<typeof setTimeout>;
  private readonly factory: () => Promise<BrowserDriver>;
  get state(): BrowserState { return this.disposed ? 'closed' : this.current; }
  constructor(factory: () => Promise<BrowserDriver>) { this.factory = factory; }
  private check(signal?: AbortSignal) {
    if (this.disposed) throw new Error('Browser session closed');
    if (signal?.aborted) throw new Error('Browser request canceled');
  }
  private serial<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.pending >= 6) return Promise.reject(new Error('Browser queue full'));
    this.pending++;
    const next = this.queue.then(async () => { this.check(signal); return operation(); });
    this.queue = next.catch(() => undefined);
    return next.finally(() => { this.pending--; });
  }
  private async ensureReady(signal?: AbortSignal) {
    this.check(signal);
    if (this.current === 'challenge') throw new Error('Browser challenge requires owner interaction');
    if (this.current === 'failed') throw new Error('Browser session failed; restart required');
    if (!this.driver) {
      const driver = await this.factory();
      if (this.disposed || signal?.aborted) { await driver.close(); this.check(signal); }
      this.driver = driver;
      try { await driver.start(); this.check(signal); }
      catch (error) { await driver.close(); throw error; }
      this.expires = setTimeout(() => { void this.close(); }, 10 * 60 * 1000);
      this.expires.unref();
      this.current = 'ready';
    }
  }
  async request(input: unknown, signal?: AbortSignal): Promise<Response> {
    const request = relayRequest(input);
    if (!request || !request.url.startsWith('https://api-v6.streeteasy.com/')) return new Response('Unsupported browser request', { status: 422 });
    try { return await this.serial(async () => {
      if (this.current === 'challenge') return new Response('StreetEasy browser session is paused for owner verification', { status: 403 });
      const canceled = () => { this.current = 'failed'; void this.driver?.close(); };
      signal?.addEventListener('abort', canceled, { once: true });
      try {
        await this.ensureReady(signal);
        const challenged = await this.driver!.hasChallenge(); this.check(signal);
        if (challenged) { this.current = 'challenge'; return new Response('StreetEasy browser requires owner verification', { status: 403 }); }
        this.current = 'busy';
        const result = await this.driver!.fetch(request); this.check(signal);
        if (result.status === 403 || result.status === 429 || /captcha|human verification|verify you are human|px-captcha/i.test(result.body)) {
          this.current = 'challenge';
          return new Response('StreetEasy browser session requires owner verification; no further requests will be sent', { status: result.status === 429 ? 429 : 403 });
        }
        this.current = 'ready';
        return new Response(result.body, { status: result.status, headers: { 'Content-Type': result.contentType } });
      } catch {
        this.current = 'failed';
        await this.driver?.close();
        return new Response('Browser source request failed', { status: 502 });
      } finally { signal?.removeEventListener('abort', canceled); }
    }, signal); } catch { return new Response('Browser session unavailable or request canceled', { status: 503 }); }
  }
  async screenshot() { return this.serial(async () => { if (!this.driver) throw new Error('No browser session'); return this.driver.screenshot(); }); }
  async act(action: BrowserAction) {
    if (!isBrowserAction(action)) throw new Error('Invalid browser action');
    return this.serial(async () => {
      if (this.current !== 'challenge' || !this.driver) throw new Error('No pending challenge');
      // These actions are only exposed behind owner authentication by the gateway.
      await this.driver.action(action); this.check();
    });
  }
  async resume() {
    return this.serial(async () => {
      if (this.current !== 'challenge' || !this.driver) throw new Error('No pending challenge');
      await this.driver.recheck(); this.check();
      const challenged = await this.driver.hasChallenge(); this.check();
      if (challenged) throw new Error('Browser challenge remains visible');
      // Explicit owner retry, not evidence the API challenge passed.
      this.current = 'ready';
    });
  }
  async close() {
    this.disposed = true;
    clearTimeout(this.expires);
    const driver = this.driver; this.driver = undefined;
    if (driver) await driver.close();
  }
}
export function isBrowserAction(value: unknown): value is BrowserAction {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'click') return Number.isInteger(v.x) && Number.isInteger(v.y) && Number(v.x) >= 0 && Number(v.x) < 800 && Number(v.y) >= 0 && Number(v.y) < 600;
  if (v.type === 'type') return typeof v.text === 'string' && v.text.length > 0 && v.text.length <= 128 && !/[\x00-\x1f]/.test(v.text);
  return v.type === 'key' && ['Enter', 'Tab', 'Backspace'].includes(String(v.key));
}

