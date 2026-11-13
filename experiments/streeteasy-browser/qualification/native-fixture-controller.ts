/** CONTROLLED FIXTURES ONLY, not production routing. No socket is created here.
 * Requires a freshly owned disposable browser and two trusted HTTPS fixture origins.
 * Network.setBlockedURLs WS pre-handshake effectiveness, OOPIF early traffic,
 * worker startup interception, HTTP decompression and remote termination remain
 * unqualified until measured against independent destination counters.
 */
import { NativeCdpConnection, type CdpSocket, type CdpEvent } from '../server/native-cdp-connection.ts';
import { NativeHttpAdapter, nativeRequestKey } from '../server/native-http-adapter.ts';
import { NativeHttpGuard, type NativeHttpTransport } from '../server/native-http-guard.ts';
import { NativeTargetBarrier } from '../server/native-target-barrier.ts';
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const identity=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=1024&&!/[\x00-\x1f\x7f]/.test(v);
const paths=new Set(['/health','/cookie','/cookie/check','/cors','/gzip','/br','/overflow','/redirect','/destination/redirect','/destination/iframe','/destination/nested-iframe','/destination/worker','/worker.js','/harness/iframe','/harness/worker','/harness/websocket','/harness/inherited-websocket','/harness/popup','/destination/popup','/harness/cors']);
export class NativeFixtureController {
  private connection: NativeCdpConnection;
  private guard: NativeHttpGuard;
  private barrier?: NativeTargetBarrier;
  private sessions=new Map<string,NativeHttpAdapter>();
  private origins: Set<string>;
  private buffer:CdpEvent[]=[];
  private context?:string;
  private mainTarget?:string;
  private mainSession?:string;
  private started=false;
  private stopped=false;
  private closePromise?:Promise<void>;
  private closeState:'not-requested'|'closing'|'acknowledged'|'unconfirmed'='not-requested';
  private pendingEvents=0;
  private requests=0;
  private evidence={requestEvents:0,deniedOriginRequests:0,workerTargets:0,popupTargets:0,webSocketCreated:0,webSocketCspBlocked:0,wsCspSrcdoc:false,wsCspBlank:false,wsCspBlob:false,wsCspData:false};
  get observations(){return {...this.evidence,...this.guard.observations}};
  private readyResolve!:()=>void;
  private readyReject!:(e:Error)=>void;
  private ready:Promise<void>;
  constructor(socket:CdpSocket, config:{ownedDisposableBrowser:true;origins:[string,string]}) {
    if(config.ownedDisposableBrowser!==true) throw Error('Owned disposable browser required');
    this.origins=new Set(config.origins.map(value=>{const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)throw Error('Canonical fixture origin required');return value;}));
    if(this.origins.size!==2)throw Error('Two distinct fixture origins required');
    this.ready=new Promise((ok,no)=>{this.readyResolve=ok;this.readyReject=no;});void this.ready.catch(()=>{});
    this.connection=new NativeCdpConnection(socket,event=>this.receive(event));
    // Global guard instance: budgets apply across ALL session adapters.
    const route=(key:string)=>{let p:unknown;try{p=JSON.parse(key);}catch{throw Error('Invalid route');}if(!Array.isArray(p)||p.length!==3||!identity(p[1]))throw Error('Invalid route');const a=this.sessions.get(p[1]);if(!a)throw Error('Unknown session');return a;};
    const transport:NativeHttpTransport={
      continueRequest:(k,s)=>route(k).continueRequest(k,s),takeBodyStream:(k,s)=>route(k).takeBodyStream(k,s),
      readStream:(k,n,s)=>route(k).readStream(k,n,s),closeStream:k=>route(k).closeStream(k),
      fulfill:(k,n,h,b,s)=>route(k).fulfill(k,n,h,b,s),fail:k=>route(k).fail(k),failClosedBrowser:()=>this.close(),
    };
    this.guard=new NativeHttpGuard(transport,undefined,url=>this.allowed(url));
  }
  get terminationState(){return this.closeState;}
  get pendingLocalWork(){return this.guard.pendingLocalWork;}
  private allowed(raw:string):boolean {try{const u=new URL(raw);return this.origins.has(u.origin)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&paths.has(u.pathname);}catch{return false;}}
  private send(method:string,params:Record<string,unknown>={},session?:string,signal?:AbortSignal) {
    if(this.stopped)return Promise.reject(Error('Fixture controller stopped'));
    return this.connection.command(method,params,session,signal);
  }
  close():Promise<void>{
    if(!this.closePromise){
      this.stopped=true;this.closeState='closing';this.readyReject(Error('Fixture controller stopped'));
      this.guard.disposeLocal();
      // Direct command is intentional: all normal/sibling sends are disabled now.
      this.closePromise=this.connection.command('Browser.close',{},undefined,undefined,3000).then(()=>{this.closeState='acknowledged';},()=>{this.closeState='unconfirmed';throw Error('Remote browser termination unconfirmed');}).finally(()=>this.connection.close());
      void this.closePromise.catch(()=>{});
    }
    return this.closePromise;
  }
  async start():Promise<void>{
    if(this.started)throw Error('Fixture controller already started');this.started=true;
    try{
      const list=await this.send('Target.getTargets');
      if(!Array.isArray(list.targetInfos)||list.targetInfos.length>16)throw Error('Unexpected browser targets');
      for(const t of list.targetInfos){
        if(!record(t)||t.type!=='page'||t.url!=='about:blank'||!identity(t.targetId))throw Error('Browser is not fresh');
        const result=await this.send('Target.closeTarget',{targetId:t.targetId});if(result.success!==true)throw Error('Initial blank close failed');
      }
      const ctx=await this.send('Target.createBrowserContext',{disposeOnDetach:true});if(!identity(ctx.browserContextId))throw Error('Missing context');this.context=ctx.browserContextId;
      await this.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
      const target=await this.send('Target.createTarget',{url:'about:blank',browserContextId:this.context});if(!identity(target.targetId))throw Error('Missing main target');this.mainTarget=target.targetId;
      this.barrier=new NativeTargetBarrier({
        autoAttach:async(s,signal)=>{await this.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},s,signal);},
        installHttpGuard:async(s,signal)=>{await this.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'},{urlPattern:'*',requestStage:'Response'}]},s,signal);},
        blockWebSockets:async(s,signal)=>{await this.send('Log.enable',{},s,signal);await this.send('Network.enable',{},s,signal);await this.send('Network.setBlockedURLs',{urls:['ws://*','wss://*']},s,signal);},
        resume:async(s,signal)=>{await this.send('Runtime.runIfWaitingForDebugger',{},s,signal);},
        closeBrowser:()=>this.close(),
      },this.mainTarget);
      await this.barrier.start();
      const buffered=this.buffer.splice(0);for(const event of buffered)void this.receive(event).catch(()=>{});
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([this.ready,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(Error('Main attach deadline')),6000);})]);}finally{if(timer)clearTimeout(timer);}
      if(this.stopped)throw Error('Fixture startup failed');
    }catch{await this.close();throw Error('Fixture startup failed');}
  }
  async navigate(url:string):Promise<void>{
    if(!this.mainSession||!this.allowed(url)||this.stopped)throw Error('Fixture navigation rejected');
    const result=await this.send('Page.navigate',{url},this.mainSession);if(result.errorText!==undefined)throw Error('Fixture navigation failed');
  }
  async bodyText():Promise<string>{
    if(!this.mainSession)throw Error('Fixture not ready');
    const result=await this.send('Runtime.evaluate',{expression:'document.body ? document.body.innerText : ""',returnByValue:true},this.mainSession);
    if(!record(result.result)||typeof result.result.value!=='string'||Buffer.byteLength(result.result.value)>2*1024*1024)throw Error('Invalid fixture result');return result.result.value;
  }
  async clickFixtureButton():Promise<void>{
    if(!this.mainSession)throw Error('Fixture not ready');
    await this.send('Runtime.evaluate',{expression:"document.querySelector('button')?.click()",userGesture:true},this.mainSession);
  }
  async documentSnapshot():Promise<{url:string;readyState:string;text:string}>{
    if(!this.mainSession)throw Error('Fixture not ready');
    const result=await this.send('Runtime.evaluate',{expression:'JSON.stringify({url:location.href,readyState:document.readyState,text:document.body?document.body.innerText:""})',returnByValue:true},this.mainSession);
    if(!record(result.result)||typeof result.result.value!=='string'||Buffer.byteLength(result.result.value)>2*1024*1024)throw Error('Invalid fixture snapshot');
    const value:unknown=JSON.parse(result.result.value);
    if(!record(value)||typeof value.url!=='string'||typeof value.readyState!=='string'||typeof value.text!=='string')throw Error('Invalid fixture snapshot');
    return {url:value.url,readyState:value.readyState,text:value.text};
  }
  private async receive(event:CdpEvent):Promise<void>{
    if(this.stopped)return;
    if(++this.pendingEvents>32){this.pendingEvents--;await this.close();return;}
    try{
      if(event.method==='Target.attachedToTarget'){
        if(!this.barrier){if(this.buffer.length>=16)throw Error('Attach buffer full');this.buffer.push(event);return;}
        const p=event.params,t=p.targetInfo;
        if(!record(t)||!identity(t.targetId)||!identity(p.sessionId)||typeof t.type!=='string'||p.waitingForDebugger!==true||this.sessions.has(p.sessionId)||this.sessions.size>=16)throw Error('Invalid target');
        if(t.browserContextId!==this.context && !(t.type==='iframe'&&t.browserContextId===undefined&&event.sessionId&&this.sessions.has(event.sessionId)))throw Error('Unexpected context');
        if(event.sessionId&&!this.sessions.has(event.sessionId))throw Error('Unknown parent');
        if(t.type==='page'&&typeof t.openerId==='string')this.evidence.popupTargets++;
        if(['worker','service_worker','shared_worker'].includes(t.type)&&event.sessionId&&this.sessions.has(event.sessionId))this.evidence.workerTargets++;
        this.sessions.set(p.sessionId,new NativeHttpAdapter({command:(m,args,s,signal,timeout)=>{if(this.stopped)return Promise.reject(Error('Fixture stopped'));return this.connection.command(m,args,s,signal,timeout);}},p.sessionId,()=>this.close()));
        await this.barrier.attached({targetId:t.targetId,sessionId:p.sessionId,type:t.type,parentSessionId:event.sessionId,openerId:typeof t.openerId==='string'?t.openerId:undefined,waitingForDebugger:true});
        if(t.targetId===this.mainTarget&&!this.stopped){this.mainSession=p.sessionId;this.readyResolve();}
      }else if(event.method==='Log.entryAdded'){const e=event.params.entry;if(event.sessionId&&this.sessions.has(event.sessionId)&&record(e)&&e.source==='security'&&typeof e.text==='string'&&e.text.includes('wss://apartment-native-fixture-b.onrender.com/destination/websocket')&&e.text.includes('connect-src https:')){this.evidence.webSocketCspBlocked++;for(const [name,key] of [['srcdoc','wsCspSrcdoc'],['blank','wsCspBlank'],['blob','wsCspBlob'],['data','wsCspData']] as const){if(e.text.includes('wss://apartment-native-fixture-b.onrender.com/destination/websocket/'+name))this.evidence[key]=true;}}}
      else if(event.method==='Network.webSocketCreated'){if(event.sessionId&&this.sessions.has(event.sessionId)&&event.params.url==='wss://apartment-native-fixture-b.onrender.com/destination/websocket')this.evidence.webSocketCreated++;}
      else if(event.method==='Target.detachedFromTarget'||event.method==='Inspector.targetCrashed'){await this.close();}
      else if(event.method==='Fetch.requestPaused'){
        if(!event.sessionId||!this.sessions.has(event.sessionId)||!identity(event.params.requestId))throw Error('Unknown request session');
        const p=event.params,id=nativeRequestKey(event.sessionId,p.requestId as string);
        if(p.responseErrorReason!==undefined){await this.guard.close();await this.close();return;}
        if(p.responseStatusCode!==undefined){
          if(typeof p.responseStatusCode!=='number'||!Array.isArray(p.responseHeaders)||p.responseHeaders.length>128)throw Error('Invalid response');
          const headers=p.responseHeaders.map(h=>{if(!record(h)||typeof h.name!=='string'||typeof h.value!=='string')throw Error('Invalid header');return{name:h.name,value:h.value};});
          await this.guard.response({id,status:p.responseStatusCode,headers});
        }else{
          if(++this.requests>1000||!record(p.request)||typeof p.request.url!=='string')throw Error('Request budget');
          // Initial fixture qualification permits GET only; HEAD/bodyless semantics are unqualified. Unknown or POST body sizes are denied.
          if(p.request.method!=='GET'||p.request.hasPostData===true||p.request.postData!==undefined||p.request.postDataEntries!==undefined)throw Error('Unexpected request body');
          this.evidence.requestEvents++;
          try{if(new URL(p.request.url).origin==='https://apartment-native-fixture-b.onrender.com'&&!this.origins.has(new URL(p.request.url).origin))this.evidence.deniedOriginRequests++;}catch{}
          await this.guard.request({id,url:p.request.url,bodyBytes:0});
        }
      }else if(event.method==='Fetch.authRequired'){throw Error('Unexpected authentication');}
    }catch{await this.close();}
    finally{this.pendingEvents--;}
  }
}
