import type { NativeCdpConnection } from './native-cdp-connection.ts';
import type { Header, NativeHttpTransport } from './native-http-guard.ts';
import { MAX_RESOURCE_BYTES } from './browser-network.ts';
/** Unwired CDP adapter. IO base64 decoding is NOT proof of HTTP content decoding.
 * Compressed response behavior must be qualified before content-encoding stripping.
 * Global guard routing must retain trusted flattened-envelope session identity.
 * Teardown must synchronously disable sends and confirm remote browser termination;
 * closing only the CDP socket does not meet that contract.
 */
type Commands = Pick<NativeCdpConnection, 'command'>;
type KeyKind = 'request' | 'stream';
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 1024 && !/[\x00-\x1f\x7f]/.test(id);
function key(kind: KeyKind, session: string, id: string): string {
  if (!validId(session) || !validId(id)) throw new Error('Invalid native identity');
  return JSON.stringify([kind,session,id]);
}
export function nativeRequestKey(session: string, requestId: string): string { return key('request',session,requestId); }
export class NativeHttpAdapter implements NativeHttpTransport {
  private cdp: Commands;
  private session: string;
  private teardown: () => Promise<void>;
  private closing?: Promise<void>;
  private stopped = false;
  constructor(cdp: Commands, sessionId: string, teardown: () => Promise<void>) {
    if (!validId(sessionId)) throw new Error('Invalid native identity');
    this.cdp=cdp; this.session=sessionId; this.teardown=teardown;
  }
  private raw(value: string, kind: KeyKind): string {
    try {
      if (value.length > 14000) throw new Error();
      const parts: unknown=JSON.parse(value);
      if (!Array.isArray(parts) || parts.length!==3 || parts[0]!==kind || parts[1]!==this.session || !validId(parts[2])) throw new Error();
      return parts[2];
    } catch { throw new Error('Native identity rejected'); }
  }
  private async send(method: string, params: Record<string,unknown>, signal?: AbortSignal) {
    if (this.stopped || signal?.aborted) throw new Error('Native adapter stopped');
    return this.cdp.command(method,params,this.session,signal);
  }
  async continueRequest(id: string, signal: AbortSignal): Promise<void> {
    await this.send('Fetch.continueRequest',{requestId:this.raw(id,'request')},signal);
  }
  async takeBodyStream(id: string, signal: AbortSignal): Promise<string> {
    const result=await this.send('Fetch.takeResponseBodyAsStream',{requestId:this.raw(id,'request')},signal);
    if (!validId(result.stream)) {
      await this.failClosedBrowser();
      throw new Error('Native stream rejected');
    }
    return key('stream',this.session,result.stream);
  }
  async readStream(handle: string, size: number, signal: AbortSignal): Promise<{data:Uint8Array;eof:boolean}> {
    if (!Number.isSafeInteger(size) || size<1 || size>65536) throw new Error('Native read size rejected');
    const result=await this.send('IO.read',{handle:this.raw(handle,'stream'),size},signal);
    if (typeof result.data!=='string' || typeof result.eof!=='boolean' || (result.base64Encoded!==undefined && typeof result.base64Encoded!=='boolean')) throw new Error('Native stream data rejected');
    let data: Buffer;
    if (result.base64Encoded) {
      if (result.data.length>4*Math.ceil(size/3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data)) throw new Error('Native stream data rejected');
      data=Buffer.from(result.data,'base64');
      if (data.toString('base64')!==result.data) throw new Error('Native stream data rejected');
    } else {
      if (result.data.length>size || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result.data)) throw new Error('Native stream data rejected');
      data=Buffer.from(result.data,'utf8');
    }
    if (data.length>size || (!result.eof && data.length===0)) throw new Error('Native stream data rejected');
    return {data,eof:result.eof};
  }
  async closeStream(handle: string): Promise<void> { await this.send('IO.close',{handle:this.raw(handle,'stream')}); }
  async fulfill(id: string, status: number, headers: Header[], body: Uint8Array, signal: AbortSignal): Promise<void> {
    const requestId=this.raw(id,'request');
    if (!Number.isInteger(status) || status<200 || status>599 || (status>=300 && status<400) || body.byteLength>MAX_RESOURCE_BYTES || headers.length>128) throw new Error('Native fulfillment rejected');
    let total=0;
    for(const h of headers) {
      if (typeof h.name!=='string' || typeof h.value!=='string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(h.name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(h.value)) throw new Error('Native header rejected');
      total+=Buffer.byteLength(h.name)+Buffer.byteLength(h.value);
      if(total>65536) throw new Error('Native header limit');
    }
    await this.send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:headers.map(h=>({...h})),body:Buffer.from(body).toString('base64')},signal);
  }
  async fail(id: string): Promise<void> { await this.send('Fetch.failRequest',{requestId:this.raw(id,'request'),errorReason:'Aborted'}); }
  failClosedBrowser(): Promise<void> {
    if(!this.closing) {
      this.stopped=true;
      // Install the promise before invoking callback to make reentrant closure safe.
      let resolve!: () => void; let reject!: (error: unknown) => void;
      this.closing=new Promise<void>((ok,no)=>{resolve=ok;reject=no;});
      // Shared teardown must disable sibling adapters synchronously, before its
      // first await; resolution must still mean confirmed remote termination.
      try { Promise.resolve(this.teardown()).then(resolve,reject); } catch(error) { reject(error); }
    }
    return this.closing;
  }
}
