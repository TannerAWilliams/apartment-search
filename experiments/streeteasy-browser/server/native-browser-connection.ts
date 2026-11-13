import { NativeCdpConnection, type CdpSocket, type CdpEvent } from './native-cdp-connection.ts';
/** No navigation or provider access: fixed raw CDP endpoint, not Playwright protocol. */
export function nativeBrowserEndpoint(token: string): string {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(token)) throw new Error('Invalid remote browser configuration');
  const endpoint = new URL('wss://production-sfo.browserless.io/chromium');
  endpoint.searchParams.set('token',token); endpoint.searchParams.set('timeout','110000');
  return endpoint.href;
}
export interface OpeningSocket extends CdpSocket {
  addEventListener(type: 'message'|'close'|'error'|'open', listener: (event:{data?:unknown})=>void):void;
}
export async function openNativeBrowser(token:string, receive:(event:CdpEvent)=>void|Promise<void>, factory:(url:string)=>OpeningSocket = url=>new WebSocket(url)):Promise<NativeCdpConnection> {
  const endpoint=nativeBrowserEndpoint(token);
  let socket:OpeningSocket;
  try {socket=factory(endpoint);} catch {throw new Error('Native browser connection failed');}
  const connection = new NativeCdpConnection(socket, receive);
  let transportClosed = false;
  const deadline = setTimeout(() => connection.close(), 110000); deadline.unref();
  socket.addEventListener('close', () => { transportClosed = true; clearTimeout(deadline); });
  socket.addEventListener('error', () => { transportClosed = true; });
  try {
    await new Promise<void>((resolve,reject)=>{
      let settled=false;
      const finish=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);ok?resolve():reject(new Error('Native browser connection failed'));};
      const timer=setTimeout(()=>finish(false),15000);
      socket.addEventListener('open',()=>finish(true));socket.addEventListener('error',()=>finish(false));socket.addEventListener('close',()=>finish(false));
    });
    if (transportClosed) throw new Error('Native browser connection failed');
    return connection;
  }catch{clearTimeout(deadline);connection.close();throw new Error('Native browser connection failed');}
}
