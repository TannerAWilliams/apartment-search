import { allowedBrowserUrl, MAX_RESOURCE_BYTES } from './browser-network.ts';

/** PROTOTYPE ONLY: requires an all-target adapter and verified decoded streams.
 * failClosedBrowser MUST synchronously disable further protocol sends, close the
 * browser/session, and dispose all streams. A rejected Promise alone is not enough.
 */
export interface NativeHttpTransport {
  continueRequest(id: string, signal: AbortSignal): Promise<void>;
  takeBodyStream(id: string, signal: AbortSignal): Promise<string>;
  readStream(handle: string, size: number, signal: AbortSignal): Promise<{ data: Uint8Array; eof: boolean }>;
  closeStream(handle: string): Promise<void>;
  fulfill(id: string, status: number, headers: Header[], body: Uint8Array, signal: AbortSignal): Promise<void>;
  fail(id: string): Promise<void>;
  failClosedBrowser(): Promise<void>;
}
export type Header = { name: string; value: string };
export type NativeRequest = { id: string; url: string; bodyBytes: number };
export type NativeResponse = { id: string; status: number; headers: Header[] };
type Entry = { abort: AbortController; timer: ReturnType<typeof setTimeout>; responding: boolean; inFlight: number; stream?: string; terminal?: Promise<void> };
const SESSION_BYTES = 32 * 1024 * 1024;
const READ_BYTES = 64 * 1024;
const hopByHop = new Set(['connection','content-length','content-encoding','transfer-encoding','upgrade','keep-alive','proxy-connection','proxy-authenticate','proxy-authorization','te','trailer']);

export class NativeHttpGuard {
  private stopped = false;
  private disposed = false;
  private received = 0;
  private redirectResponses = 0;
  private resourceOverflow = false;
  get observations(){return {receivedBytes:this.received,redirectResponses:this.redirectResponses,resourceOverflow:this.resourceOverflow}}
  private entries = new Map<string, Entry>();
  private queued: Array<{ request: NativeRequest; resolve: () => void }> = [];
  private hardClosing?: Promise<void>;
  private closure: 'not-requested'|'closing'|'confirmed'|'unconfirmed' = 'not-requested';
  get browserClosureState() { return this.closure; }
  private transport: NativeHttpTransport;
  private allowUrl: (url: string) => boolean;
  private timeouts: { requestMs: number; cleanupMs: number };
  /** Third argument is trusted programmatic qualification configuration, never request/env input. */
  constructor(transport: NativeHttpTransport, timeouts = { requestMs: 12000, cleanupMs: 1000 }, allowUrl = allowedBrowserUrl) { this.transport = transport; this.timeouts = timeouts; this.allowUrl = allowUrl; }
  private bounded<T>(action: () => Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native protocol deadline')), ms);
      Promise.resolve().then(action).then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }
  private hardClose(): Promise<void> {
    if (this.hardClosing) return this.hardClosing;
    this.stopped = true;
    for (const entry of this.entries.values()) { clearTimeout(entry.timer); entry.abort.abort(); }
    for (const item of this.queued.splice(0)) item.resolve();
    // Mark first, before invoking adapter, so reentrant events cannot send traffic.
    this.closure = 'closing';
    this.hardClosing = Promise.resolve().then(() => this.bounded(() => this.transport.failClosedBrowser(), this.timeouts.cleanupMs)).then(() => { this.closure = 'confirmed'; }, () => { this.closure = 'unconfirmed'; });
    return this.hardClosing;
  }
  /** Synchronous local disposal only: no protocol sends, no remote-close claim.
   * Abort may close a transport through its existing signal listener; callers must
   * independently qualify remote termination and keep unconfirmed status truthful.
   */
  disposeLocal(): void {
    this.stopped = true; this.disposed = true;
    const entries = [...this.entries.values()]; this.entries.clear();
    for (const entry of entries) { clearTimeout(entry.timer); entry.abort.abort(); }
    for (const item of this.queued.splice(0)) item.resolve();
  }
  get pendingLocalWork() { return { active: this.entries.size, queued: this.queued.length, disposed: this.disposed }; }
  private async command<T>(entry: Entry, action: () => Promise<T>): Promise<T> {
    if (this.stopped || entry.terminal || entry.abort.signal.aborted) throw new Error('Native HTTP stopped');
    entry.inFlight++;
    let cancel!: () => void;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (this.stopped || entry.terminal || entry.abort.signal.aborted) throw new Error('Native HTTP stopped');
          return action();
        }),
        new Promise<never>((_, reject) => {
          cancel = () => reject(new Error('Native HTTP canceled'));
          entry.abort.signal.addEventListener('abort', cancel, {once:true});
        }),
      ]);
    } finally { entry.abort.signal.removeEventListener('abort', cancel); entry.inFlight--; }
  }
  private finish(id: string, entry: Entry) {
    clearTimeout(entry.timer); this.entries.delete(id);
    if (!this.stopped) {
      const next = this.queued.shift();
      if (next) void this.begin(next.request).finally(next.resolve);
    }
  }
  private terminate(id: string, entry: Entry, failed: boolean): Promise<void> {
    if (this.disposed) { clearTimeout(entry.timer); return Promise.resolve(); }
    if (entry.terminal) return entry.terminal;
    const uncertain = failed && entry.inFlight > 0;
    clearTimeout(entry.timer); entry.abort.abort();
    entry.terminal = Promise.resolve().then(async () => {
      if (this.disposed) return;
      if (uncertain || this.hardClosing) { await this.hardClose(); return; }
      try {
        // A response stream must be disposed before failing its paused request.
        if (entry.stream) { const stream = entry.stream; entry.stream = undefined; await this.bounded(() => this.transport.closeStream(stream),this.timeouts.cleanupMs); }
        if (failed && !this.disposed) await this.bounded(() => this.disposed ? Promise.resolve() : this.transport.fail(id),this.timeouts.cleanupMs);
      } catch { await this.hardClose(); }
    }).finally(() => this.finish(id, entry));
    return entry.terminal;
  }
  private async reject(id: string) {
    if (this.disposed) return;
    if (this.hardClosing) { await this.hardClosing; return; }
    try { await this.bounded(() => this.transport.fail(id),this.timeouts.cleanupMs); }
    catch { await this.hardClose(); }
  }
  async close(): Promise<void> {
    this.stopped = true;
    const queued = this.queued.splice(0);
    await Promise.all([
      ...queued.map(async item => { try { await this.reject(item.request.id); } finally { item.resolve(); } }),
      ...[...this.entries].map(([id,entry]) => this.terminate(id,entry,true)),
    ]);
  }
  async request(request: NativeRequest): Promise<void> {
    if (this.entries.has(request.id) || this.queued.some(item => item.request.id === request.id)) { await this.hardClose(); return; }
    if (this.stopped || !this.allowUrl(request.url) || !Number.isSafeInteger(request.bodyBytes) || request.bodyBytes < 0 || request.bodyBytes > READ_BYTES) { await this.reject(request.id); return; }
    if (this.entries.size < 2) return this.begin(request);
    if (this.queued.length >= 4) { await this.reject(request.id); return; }
    return new Promise(resolve => this.queued.push({request,resolve}));
  }
  private async begin(request: NativeRequest) {
    if (this.stopped) { await this.reject(request.id); return; }
    const abort = new AbortController();
    const entry: Entry = {abort,timer:setTimeout(() => { void this.hardClose().then(() => this.terminate(request.id,entry,true)); },this.timeouts.requestMs),responding:false,inFlight:0};
    entry.timer.unref(); this.entries.set(request.id,entry);
    try { await this.command(entry,() => this.transport.continueRequest(request.id,abort.signal)); }
    catch { await this.terminate(request.id,entry,true); }
  }
  async response(response: NativeResponse): Promise<void> {
    const entry = this.entries.get(response.id);
    if (!entry) { await this.reject(response.id); return; }
    if (this.stopped || entry.responding) { await this.terminate(response.id,entry,true); return; }
    entry.responding = true;
    let failed = true;
    const check = () => { if (this.stopped || entry.terminal || entry.abort.signal.aborted) throw new Error('Native HTTP canceled'); };
    try {
      check();
      if(response.status>=300&&response.status<400)this.redirectResponses++;
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599 || (response.status >= 300 && response.status < 400)) throw new Error('Native HTTP status rejected');
      for (const header of response.headers) {
        if (header.name.toLowerCase() === 'content-length' && (!/^\d+$/.test(header.value) || Number(header.value) > MAX_RESOURCE_BYTES)) throw new Error('Native HTTP resource limit');
      }
      const stream = await this.command(entry,() => this.transport.takeBodyStream(response.id,entry.abort.signal));
      entry.stream = stream; check();
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const chunk = await this.command(entry,() => this.transport.readStream(stream,READ_BYTES,entry.abort.signal));
        check();
        if (chunk.data.byteLength > READ_BYTES || (!chunk.eof && chunk.data.byteLength === 0)) throw new Error('Invalid bounded native stream');
        length += chunk.data.byteLength; this.received += chunk.data.byteLength;
        if (length > MAX_RESOURCE_BYTES || this.received > SESSION_BYTES) { this.resourceOverflow=true; await this.hardClose(); throw new Error('Native HTTP budget exceeded'); }
        chunks.push(chunk.data); if (chunk.eof) break;
      }
      const nominated = response.headers.filter(h=>h.name.toLowerCase()==='connection').flatMap(h=>h.value.split(',').map(v=>v.trim().toLowerCase()));
      const headers = response.headers.filter(h=>!hopByHop.has(h.name.toLowerCase()) && !nominated.includes(h.name.toLowerCase()));
      check();
      await this.command(entry,() => this.transport.fulfill(response.id,response.status,headers,Buffer.concat(chunks,length),entry.abort.signal));
      failed = false;
    } catch { /* All cleanup is serialized through the single terminal path. */ }
    finally { await this.terminate(response.id,entry,failed); }
  }
}
