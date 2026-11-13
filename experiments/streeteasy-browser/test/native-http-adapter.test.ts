import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeHttpAdapter, nativeRequestKey } from '../server/native-http-adapter.ts';
import type { NativeCdpConnection } from '../server/native-cdp-connection.ts';
const signal=new AbortController().signal;
function fake() {
  const calls: Array<{method:string;params:Record<string,unknown>;session?:string;signal?:AbortSignal}>=[];
  let reply: Record<string,unknown>={}; let closes=0;
  const cdp: Pick<NativeCdpConnection,'command'>={command:async(method,params={},session,s)=>{calls.push({method,params,session,signal:s});return reply;}};
  return {calls,setReply:(r:Record<string,unknown>)=>{reply=r;},get closes(){return closes;},adapter:new NativeHttpAdapter(cdp,'s',async()=>{closes++;})};
}
test('maps Fetch commands using fixed session and correlated request key',async()=>{
  const f=fake(), id=nativeRequestKey('s','r'); await f.adapter.continueRequest(id,signal); await f.adapter.fail(id);
  assert.deepEqual(f.calls.map(x=>[x.method,x.params,x.session]),[['Fetch.continueRequest',{requestId:'r'},'s'],['Fetch.failRequest',{requestId:'r',errorReason:'Aborted'},'s']]); assert.equal(f.calls[0]?.signal,signal);
});
test('stream commands preserve session and omit sequential-read offset',async()=>{
  const f=fake();f.setReply({stream:'h'});const h=await f.adapter.takeBodyStream(nativeRequestKey('s','r'),signal);f.setReply({data:'AAH/',base64Encoded:true,eof:true});const r=await f.adapter.readStream(h,65536,signal);assert.deepEqual([...r.data],[0,1,255]);assert.equal(r.eof,true);await f.adapter.closeStream(h);
  assert.deepEqual(f.calls[1]?.params,{handle:'h',size:65536});assert.equal(f.calls[2]?.method,'IO.close');assert.ok(f.calls.every(c=>c.session==='s'));
});
test('identity keys resist separator collisions and reject cross-session or cross-kind',async()=>{
  assert.notEqual(nativeRequestKey('a:b','c'),nativeRequestKey('a','b:c')); const f=fake();
  for(const id of [nativeRequestKey('other','r'),'r',JSON.stringify(['stream','s','h']),JSON.stringify(['request','s','r','extra'])]) await assert.rejects(f.adapter.continueRequest(id,signal),/identity/);
  assert.equal(f.calls.length,0);
});
test('valid UTF8 stream is byte bounded and empty EOF supported',async()=>{
  const f=fake();const h=JSON.stringify(['stream','s','h']);f.setReply({data:'é',eof:true});assert.deepEqual([...(await f.adapter.readStream(h,2,signal)).data],[195,169]);await assert.rejects(f.adapter.readStream(h,1,signal));f.setReply({data:'',eof:true});assert.equal((await f.adapter.readStream(h,1,signal)).data.length,0);
});
test('rejects malformed, noncanonical, oversized or empty nonEOF chunks',async()=>{
  const f=fake(),h=JSON.stringify(['stream','s','h']);
  for(const reply of [{data:'!!!!',base64Encoded:true,eof:true},{data:'AB==',base64Encoded:true,eof:true},{data:'AAA=',base64Encoded:true,eof:true},{data:'',eof:false},{data:'a',eof:'yes'},{data:'a',base64Encoded:'yes',eof:true},{data:'\ud800',eof:true}]) {f.setReply(reply);await assert.rejects(f.adapter.readStream(h,1,signal));}
  for(const size of [0,65537,NaN,1.5]) await assert.rejects(f.adapter.readStream(h,size,signal));
});
test('fulfillment encodes binary body and preserves repeated cookie headers',async()=>{
  const f=fake();const headers=[{name:'set-cookie',value:'a=1'},{name:'set-cookie',value:'b=2'}];await f.adapter.fulfill(nativeRequestKey('s','r'),200,headers,new Uint8Array([0,255]),signal);
  assert.deepEqual(f.calls[0]?.params,{requestId:'r',responseCode:200,responseHeaders:headers,body:'AP8='});
});
test('invalid headers redirect status and body budget fail before sending',async()=>{
  const f=fake(),id=nativeRequestKey('s','r');
  for(const headers of [[{name:'bad name',value:'x'}],[{name:'x',value:'a\r\nb'}],[{name:'x',value:'x'.repeat(65537)}],Array.from({length:129},()=>({name:'x',value:'y'}))]) await assert.rejects(f.adapter.fulfill(id,200,headers,new Uint8Array(),signal));
  await assert.rejects(f.adapter.fulfill(id,302,[],new Uint8Array(),signal));await assert.rejects(f.adapter.fulfill(id,200,[],new Uint8Array(2*1024*1024+1),signal));assert.equal(f.calls.length,0);
});
test('teardown stops sends synchronously, once; no claim socket alone terminates browser',async()=>{
  const f=fake();const closed=f.adapter.failClosedBrowser();await assert.rejects(f.adapter.continueRequest(nativeRequestKey('s','r'),signal),/stopped/);await Promise.all([closed,f.adapter.failClosedBrowser()]);assert.equal(f.closes,1);assert.equal(f.calls.length,0);
});
test('teardown failure propagates instead of claiming confirmation',async()=>{
  const a=new NativeHttpAdapter({command:async()=>({})},'s',async()=>{throw Error('unconfirmed');});await assert.rejects(a.failClosedBrowser(),/unconfirmed/);
});
test('malformed acquired stream requires browser teardown before returning failure',async()=>{
  const f=fake();f.setReply({stream:42});await assert.rejects(f.adapter.takeBodyStream(nativeRequestKey('s','r'),signal),/stream rejected/);assert.equal(f.closes,1);await assert.rejects(f.adapter.fail(nativeRequestKey('s','r')),/stopped/);
});
test('shared teardown hook runs synchronously, and thrown teardown stays unconfirmed',async()=>{
  let globalStopped=false;
  const a=new NativeHttpAdapter({command:async()=>({})},'s',()=>{globalStopped=true;throw Error('not terminated');});
  const closed=a.failClosedBrowser();assert.equal(globalStopped,true);await assert.rejects(closed,/not terminated/);
});
