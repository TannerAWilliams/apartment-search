import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeCdpConnection, type CdpSocket, type CdpEvent} from '../server/native-cdp-connection.ts';
class Socket implements CdpSocket {
  sent: string[]=[]; closed=false;
  listeners=new Map<string,(e:{data?:unknown})=>void>();
  addEventListener(type:string, fn:(e:{data?:unknown})=>void) {this.listeners.set(type,fn);}
  send(data:string) {this.sent.push(data);}
  close(){this.closed=true;}
  message(data:unknown){this.listeners.get('message')?.({data});}
}
test('flattened CDP routes commands and target events without private APIs',async()=>{
 const s=new Socket();const events:CdpEvent[]=[];const c=new NativeCdpConnection(s,e=>{events.push(e);});
 const p=c.command('Fetch.enable',{},'child');assert.equal(JSON.parse(s.sent[0]!).sessionId,'child');
 s.message(JSON.stringify({id:1,result:{},sessionId:'child'}));assert.deepEqual(await p,{});
 s.message(JSON.stringify({method:'Fetch.requestPaused',params:{requestId:'r'},sessionId:'child'}));assert.equal(events[0]?.sessionId,'child');c.close();
});
test('abort closes transport rather than pretending to cancel only the promise',async()=>{
 const s=new Socket();const c=new NativeCdpConnection(s,()=>{});const a=new AbortController();const p=c.command('IO.read',{},'child',a.signal);a.abort();await assert.rejects(p,/closed/);assert.equal(s.closed,true);
});
test('command deadline closes socket and every pending command',async()=>{
 const s=new Socket();const c=new NativeCdpConnection(s,()=>{});const a=c.command('IO.read',{},'child',undefined,5);const b=c.command('IO.read',{},'other');await Promise.all([assert.rejects(a,/closed/),assert.rejects(b,/closed/)]);assert.equal(s.closed,true);
});
test('malformed frames and vendor errors fail closed without leaking detail',async()=>{
 for(const frame of ['invalid',JSON.stringify({id:1,error:{message:'wss://secret'}})]){
 const s=new Socket();const c=new NativeCdpConnection(s,()=>{});const p=c.command('IO.read');s.message(frame);await assert.rejects(p,e=>e instanceof Error&&e.message==='Native CDP connection closed');assert.equal(s.closed,true);}
});
test('handler failure and oversized message close the connection',()=>{
 for(const frame of [JSON.stringify({method:'Target.attachedToTarget',params:{}}),'x'.repeat(4*1024*1024+1)]){const s=new Socket();new NativeCdpConnection(s,()=>{throw new Error();});s.message(frame);assert.equal(s.closed,true);}
});

test('response session mismatch fails closed',async()=>{const s=new Socket();const c=new NativeCdpConnection(s,()=>{});const p=c.command('Fetch.enable',{},'expected');s.message(JSON.stringify({id:1,result:{},sessionId:'other'}));await assert.rejects(p,/closed/);assert.equal(s.closed,true);});

test('asynchronous event handler failure closes transport',async()=>{const s=new Socket();new NativeCdpConnection(s,async()=>{throw new Error('failed async setup');});s.message(JSON.stringify({method:'Target.attachedToTarget',params:{}}));await new Promise(r=>setImmediate(r));assert.equal(s.closed,true);});
