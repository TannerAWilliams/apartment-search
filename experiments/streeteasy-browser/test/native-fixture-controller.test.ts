import test from 'node:test';
import assert from 'node:assert/strict';
import type { CdpSocket } from '../server/native-cdp-connection.ts';
import { NativeFixtureController } from '../qualification/native-fixture-controller.ts';
class Socket implements CdpSocket {
 listeners=new Map<string,(e:{data?:unknown})=>void>();sent:Array<Record<string,unknown>>=[];closed=false;initial:unknown[]=[];
 addEventListener(type:string,fn:(e:{data?:unknown})=>void){this.listeners.set(type,fn);}
 event(method:string,params:Record<string,unknown>,sessionId?:string){this.listeners.get('message')?.({data:JSON.stringify({method,params,...(sessionId?{sessionId}:{})})});}
 send(data:string){const m=JSON.parse(data);this.sent.push(m);let result:Record<string,unknown>={};
 if(m.method==='Target.getTargets')result={targetInfos:this.initial};
 if(m.method==='Target.closeTarget')result={success:true};
 if(m.method==='Target.createBrowserContext')result={browserContextId:'context'};
 if(m.method==='Target.createTarget'){this.event('Target.attachedToTarget',{sessionId:'mainSession',waitingForDebugger:true,targetInfo:{targetId:'main',type:'page',url:'about:blank',browserContextId:'context'}});result={targetId:'main'};}
 if(m.method==='Runtime.evaluate')result={result:{value:'synthetic-body'}};
 this.listeners.get('message')?.({data:JSON.stringify({id:m.id,result,...(m.sessionId?{sessionId:m.sessionId}:{})})});
 }
 close(){this.closed=true;}
}
const config={ownedDisposableBrowser:true as const,origins:['https://fixture-one.test','https://fixture-two.test'] as [string,string]};
const tick=()=>new Promise(r=>setImmediate(r));
test('bootstrap arms root before create, buffers early event and guards before resume',async()=>{
 const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();const methods=s.sent.map(x=>x.method);assert.ok(methods.indexOf('Target.setAutoAttach')<methods.indexOf('Target.createTarget'));assert.ok(methods.indexOf('Fetch.enable')<methods.indexOf('Runtime.runIfWaitingForDebugger'));assert.ok(methods.indexOf('Network.setBlockedURLs')<methods.indexOf('Runtime.runIfWaitingForDebugger'));await c.navigate('https://fixture-one.test/health');assert.equal(await c.bodyText(),'synthetic-body');await c.close();assert.equal(c.terminationState,'acknowledged');assert.equal(s.closed,true);
});
test('existing targets can only be aboutblank in freshly owned browser',async()=>{
 const s=new Socket();s.initial=[{targetId:'old',url:'https://streeteasy.com',type:'page'}];const c=new NativeFixtureController(s,config);await assert.rejects(c.start());assert.equal(s.sent.some(x=>x.method==='Target.closeTarget'),false);assert.equal(c.terminationState,'acknowledged');
 const s2=new Socket();s2.initial=[{targetId:'blank',url:'about:blank',type:'page'}];const c2=new NativeFixtureController(s2,config);await c2.start();assert.equal(s2.sent.some(x=>x.method==='Target.closeTarget'),true);await c2.close();
});
test('navigation rejects provider origins and arbitrary fixture paths',async()=>{
 const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();for(const url of ['https://streeteasy.com/','https://fixture-one.test/control/counters','https://fixture-one.test/health?dest=secret','http://fixture-one.test/health'])await assert.rejects(c.navigate(url));assert.equal(s.sent.some(x=>x.method==='Page.navigate'),false);await c.close();
});
test('unknown request session causes browser close, not request continuation',async()=>{
 const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();s.event('Fetch.requestPaused',{requestId:'r',request:{method:'GET',url:'https://fixture-one.test/health'}},'unknown');await tick();assert.equal(c.terminationState,'acknowledged');assert.equal(s.sent.some(x=>x.method==='Fetch.continueRequest'),false);
});
test('allowed request uses session-correlated global guard',async()=>{
 const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();s.event('Fetch.requestPaused',{requestId:'r',request:{method:'GET',url:'https://fixture-one.test/health'}},'mainSession');await tick();const cont=s.sent.find(x=>x.method==='Fetch.continueRequest');assert.equal(cont?.sessionId,'mainSession');assert.deepEqual(cont?.params,{requestId:'r'});await c.close();
});
test('unknown POST body and unsupported worker stop browser',async()=>{
 for(const kind of ['post','worker']){const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();if(kind==='post')s.event('Fetch.requestPaused',{requestId:'r',request:{method:'POST',url:'https://fixture-one.test/health'}},'mainSession');else s.event('Target.attachedToTarget',{sessionId:'workerSession',waitingForDebugger:true,targetInfo:{targetId:'worker',type:'worker',browserContextId:'context'}},'mainSession');await tick();assert.equal(c.terminationState,'acknowledged');assert.equal(s.sent.some(x=>x.method==='Runtime.runIfWaitingForDebugger'&&x.sessionId==='workerSession'),false);}
});
test('detachment closes globally and prevents later navigation',async()=>{
 const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();s.event('Target.detachedFromTarget',{sessionId:'mainSession'});await tick();await assert.rejects(c.navigate('https://fixture-one.test/health'));assert.equal(c.terminationState,'acknowledged');
});
test('unconfirmed Browser.close is never labeled acknowledged',async()=>{
 const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();s.listeners.get('error')?.({});await assert.rejects(c.close(),/unconfirmed/);assert.equal(c.terminationState,'unconfirmed');
});
test('controller close synchronously disposes active and queued guard work',async()=>{
 const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();for(let i=0;i<3;i++)s.event('Fetch.requestPaused',{requestId:`r${i}`,request:{method:'GET',url:'https://fixture-one.test/health'}},'mainSession');await tick();assert.deepEqual(c.pendingLocalWork,{active:2,queued:1,disposed:false});const closed=c.close();assert.deepEqual(c.pendingLocalWork,{active:0,queued:0,disposed:true});await closed;await tick();assert.equal(s.sent.filter(x=>x.method==='Fetch.continueRequest').length,2);assert.equal(s.sent.some(x=>x.method==='Fetch.failRequest'),false);
});
test('HEAD and obsolete harness are rejected in initial qualification',async()=>{
 const s=new Socket(),c=new NativeFixtureController(s,config);await c.start();await assert.rejects(c.navigate('https://fixture-one.test/harness'));s.event('Fetch.requestPaused',{requestId:'head',request:{method:'HEAD',url:'https://fixture-one.test/health'}},'mainSession');await tick();assert.equal(c.terminationState,'acknowledged');assert.equal(s.sent.some(x=>x.method==='Fetch.continueRequest'),false);
});
