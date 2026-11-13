/** Unwired prototype: flattened CDP transport, not a network sandbox.
 * Socket closure stops local commands but does NOT establish remote target shutdown.
 * A qualified adapter must independently prove remote teardown and expiry. */
export interface CdpSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message' | 'close' | 'error', listener: (event: {data?: unknown}) => void): void;
}
type Pending = { sessionId?: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; cleanup(): void };
export type CdpEvent = {method: string; params: Record<string, unknown>; sessionId?: string};
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export class NativeCdpConnection {
  private nextId = 1;
  private closed = false;
  private pending = new Map<number, Pending>();
  private socket: CdpSocket;
  private receive: (event: CdpEvent) => void | Promise<void>;
  constructor(socket: CdpSocket, receive: (event: CdpEvent) => void | Promise<void>) {
    this.socket = socket; this.receive = receive;
    socket.addEventListener('message', event => this.message(event.data));
    socket.addEventListener('close', () => this.close());
    socket.addEventListener('error', () => this.close());
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.cleanup(); entry.reject(new Error('Native CDP connection closed')); }
    this.pending.clear();
    try { this.socket.close(); } catch { /* No vendor errors or credential URLs leave this boundary. */ }
  }
  command(method: string, params: Record<string, unknown> = {}, sessionId?: string, signal?: AbortSignal, timeoutMs = 12000): Promise<Record<string, unknown>> {
    if (this.closed || signal?.aborted) return Promise.reject(new Error('Native CDP unavailable'));
    if (this.pending.size >= 32 || !/^[A-Za-z]+\.[A-Za-z]+$/.test(method) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) { this.close(); return Promise.reject(new Error('Native CDP command rejected')); }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const abort = () => this.close(); // CDP has no command cancellation: terminate the whole transport.
      const timer = setTimeout(abort, timeoutMs);
      const cleanup = () => signal?.removeEventListener('abort', abort);
      this.pending.set(id, {sessionId,resolve,reject,timer,cleanup});
      signal?.addEventListener('abort', abort, {once:true});
      try {
        const data = JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})});
        if (Buffer.byteLength(data) > 4 * 1024 * 1024) throw new Error();
        this.socket.send(data);
      } catch { this.close(); }
    });
  }
  private message(data: unknown) {
    if (this.closed) return;
    try {
      if (typeof data !== 'string' || Buffer.byteLength(data) > 4 * 1024 * 1024) throw new Error();
      const message: unknown = JSON.parse(data);
      if (!object(message)) throw new Error();
      if ('id' in message) {
        if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id)) throw new Error();
        const entry = this.pending.get(message.id);
        if (!entry || message.sessionId !== entry.sessionId || 'error' in message || !object(message.result)) throw new Error();
        this.pending.delete(message.id); clearTimeout(entry.timer); entry.cleanup(); entry.resolve(message.result);
      } else {
        if (typeof message.method !== 'string' || !object(message.params) || (message.sessionId !== undefined && typeof message.sessionId !== 'string')) throw new Error();
        void Promise.resolve(this.receive({method:message.method,params:message.params,...(typeof message.sessionId==='string'?{sessionId:message.sessionId}:{})})).catch(() => this.close());
      }
    } catch { this.close(); }
  }
}
