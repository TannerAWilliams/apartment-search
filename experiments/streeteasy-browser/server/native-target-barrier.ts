/** Provider-free PROTOTYPE, not a browser security boundary.
 * The adapter must install listeners before start(), implement recursive flattened
 * Target.setAutoAttach(autoAttach:true, waitForDebuggerOnStart:true), intercept all
 * HTTP requests/responses and deny WebSocket handshakes BEFORE acknowledging setup.
 * Public CDP feasibility (including initial network, OOPIF discovery, service workers,
 * other protocols and Browserless session routing) is NOT qualified here. Never wire
 * this to live navigation merely because these mock lifecycle tests pass.
 * Main target identity must come from the trusted controller, never page content.
 */
export interface TargetBarrierTransport {
  autoAttach(sessionId: string | undefined, signal: AbortSignal): Promise<void>;
  installHttpGuard(sessionId: string, signal: AbortSignal): Promise<void>;
  blockWebSockets(sessionId: string, signal: AbortSignal): Promise<void>;
  resume(sessionId: string, signal: AbortSignal): Promise<void>;
  /** Must terminate the browser even when other CDP commands are hung. */
  closeBrowser(): Promise<void>;
}
export type PausedTarget = {
  targetId: string; sessionId: string; type: string;
  parentSessionId?: string; openerId?: string; waitingForDebugger: boolean;
};
type Entry = { targetId: string; ready: Promise<void> };
export class NativeTargetBarrier {
  private transport: TargetBarrierTransport;
  private mainTargetId: string;
  private timeoutMs: number;
  private abort = new AbortController();
  private root?: Promise<void>;
  private closed?: Promise<void>;
  private entries = new Map<string, Entry>();
  private targets = new Set<string>();
  constructor(transport: TargetBarrierTransport, mainTargetId: string, timeoutMs = 5000) {
    if (!mainTargetId || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('invalid barrier configuration');
    this.transport = transport; this.mainTargetId = mainTargetId; this.timeoutMs = timeoutMs;
  }
  get stopped(): boolean { return this.abort.signal.aborted; }
  /** Does not claim closure succeeded if the transport rejects or never settles. */
  close(): Promise<void> {
    if (!this.closed) {
      this.abort.abort();
      this.closed = Promise.resolve().then(() => this.transport.closeBrowser());
    }
    return this.closed;
  }
  private async bounded(action: () => Promise<void>): Promise<void> {
    if (this.stopped) throw new Error('barrier stopped');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    try {
      await Promise.race([
        Promise.resolve().then(() => { if (this.stopped) throw new Error('barrier stopped'); return action(); }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('barrier stopped'));
          this.abort.signal.addEventListener('abort', onAbort, {once:true});
          timer = setTimeout(() => reject(new Error('target setup timeout')), this.timeoutMs);
        }),
      ]);
      if (this.stopped) throw new Error('barrier stopped');
    } finally {
      if (timer) clearTimeout(timer);
      this.abort.signal.removeEventListener('abort', onAbort);
    }
  }
  start(): Promise<void> {
    if (!this.root) this.root = this.bounded(() => this.transport.autoAttach(undefined, this.abort.signal))
      .catch(async () => { await this.close(); });
    return this.root;
  }
  async attached(target: PausedTarget): Promise<void> {
    if (this.stopped) { await this.close(); return; }
    const parent = target.parentSessionId ? this.entries.get(target.parentSessionId) : undefined;
    const main = target.type === 'page' && target.targetId === this.mainTargetId && !target.parentSessionId && !target.openerId;
    const frame = target.type === 'iframe' && !!parent && !target.openerId;
    if (!this.root || !target.waitingForDebugger || !target.sessionId || !target.targetId || (!main && !frame)
        || this.entries.has(target.sessionId) || this.targets.has(target.targetId) || this.entries.size >= 16) {
      await this.close(); return;
    }
    this.targets.add(target.targetId);
    // Defer work so the identity is registered before recursive attach events arrive.
    const ready = Promise.resolve().then(async () => {
      try {
        await this.bounded(async () => {
          await this.root;
          if (parent) await parent.ready;
          if (this.stopped) throw new Error('barrier stopped');
          await this.transport.autoAttach(target.sessionId, this.abort.signal);
          if (this.stopped) throw new Error('barrier stopped');
          await this.transport.installHttpGuard(target.sessionId, this.abort.signal);
          if (this.stopped) throw new Error('barrier stopped');
          await this.transport.blockWebSockets(target.sessionId, this.abort.signal);
          if (this.stopped) throw new Error('barrier stopped');
          await this.transport.resume(target.sessionId, this.abort.signal);
        });
      } catch { await this.close(); }
    });
    this.entries.set(target.sessionId, {targetId:target.targetId, ready});
    await ready;
  }
  /** Conservative: detach or transport loss invalidates the entire session. */
  detached(_sessionId: string): Promise<void> { return this.close(); }
  transportFailed(): Promise<void> { return this.close(); }
}
