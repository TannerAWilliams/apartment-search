import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeHttpGuard, type NativeHttpTransport } from '../server/native-http-guard.ts';
function fixture(chunks: Uint8Array[] = [Buffer.from('ok')], timeouts = {requestMs:12000,cleanupMs:1000}) {
  const events: string[]=[]; const fulfilled: Array<{headers:unknown;body:string}>=[];
  const transport: NativeHttpTransport={failClosedBrowser:async()=>{events.push("browser-closed")},continueRequest:async id=>{events.push('continue:'+id)},takeBodyStream:async id=>{events.push('stream:'+id);return id},readStream:async(_h,size)=>{assert.equal(size,65536);const data=chunks.shift()||new Uint8Array();return{data,eof:chunks.length===0}},closeStream:async id=>{events.push('close:'+id)},fulfill:async(id,_s,headers,body)=>{events.push('fulfill:'+id);fulfilled.push({headers,body:Buffer.from(body).toString()})},fail:async id=>{events.push('fail:'+id)}};
  return {guard:new NativeHttpGuard(transport,timeouts),transport,events,fulfilled};
}
const request=(id:string,url='https://streeteasy.com/for-rent/nyc')=>({id,url,bodyBytes:0});
test('native prototype rejects disallowed targets before continue',async()=>{const f=fixture();await f.guard.request(request('a','http://127.0.0.1'));assert.deepEqual(f.events,['fail:a']);await f.guard.close()});
test('redirect is failed at headers without body or downstream continue',async()=>{const f=fixture();await f.guard.request(request('a'));await f.guard.response({id:'a',status:302,headers:[{name:'Location',value:'https://streeteasy.com/elsewhere'}]});assert.deepEqual(f.events,['continue:a','fail:a']);await f.guard.close()});
test('decoded bounded stream fulfills, strips framing, preserves individual cookies',async()=>{const f=fixture();await f.guard.request(request('a'));await f.guard.response({id:'a',status:200,headers:[{name:'Content-Encoding',value:'gzip'},{name:'Content-Length',value:'2'},{name:'Set-Cookie',value:'a=b'},{name:'Set-Cookie',value:'c=d'}]});assert.equal(f.fulfilled[0].body,'ok');assert.deepEqual(f.fulfilled[0].headers,[{name:'Set-Cookie',value:'a=b'},{name:'Set-Cookie',value:'c=d'},{name:'Content-Security-Policy',value:'connect-src https:'}]);assert.ok(f.events.includes('close:a'));await f.guard.close()});
test('resource overflow closes stream and never fulfills',async()=>{const f=fixture(Array.from({length:33},()=>new Uint8Array(65536)));await f.guard.request(request('a'));await f.guard.response({id:'a',status:200,headers:[]});assert.equal(f.fulfilled.length,0);assert.ok(f.events.includes('browser-closed'));await f.guard.request(request('b'));assert.ok(!f.events.includes('continue:b'))});
test('two active four queued and overflow fail, closing drains pending',async()=>{const f=fixture();await f.guard.request(request('1'));await f.guard.request(request('2'));const pending=['3','4','5','6'].map(id=>f.guard.request(request(id)));await f.guard.request(request('7'));assert.deepEqual(f.events,['continue:1','continue:2','fail:7']);await f.guard.close();await Promise.all(pending);assert.equal(f.events.filter(e=>e.startsWith('continue:')).length,2)});
test('response completion promotes one queued request',async()=>{const f=fixture();await f.guard.request(request('1'));await f.guard.request(request('2'));const queued=f.guard.request(request('3'));await f.guard.response({id:'1',status:204,headers:[]});await queued;assert.ok(f.events.includes('continue:3'));await f.guard.close()});
test('late stream after close is disposed, never fulfilled',async()=>{const f=fixture();let resolve!:(s:string)=>void;f.transport.takeBodyStream=()=>new Promise(r=>resolve=r);await f.guard.request(request('a'));const response=f.guard.response({id:'a',status:200,headers:[]});await new Promise(r=>setImmediate(r));await f.guard.close();resolve('late');await response;assert.equal(f.fulfilled.length,0);assert.ok(f.events.includes('browser-closed'))});
test('stream failures and cleanup rejection do not expose error or fulfill',async()=>{const f=fixture();f.transport.readStream=async()=>{throw Error('synthetic-secret')};f.transport.closeStream=async()=>{throw Error('synthetic-secret')};await f.guard.request(request('a'));await assert.doesNotReject(f.guard.response({id:'a',status:200,headers:[]}));assert.equal(f.fulfilled.length,0);await f.guard.close()});
test('aggregate session budget blocks seventeenth full resource',async()=>{const f=fixture();f.transport.readStream=async()=>({data:new Uint8Array(65536),eof:++reads%32===0});let reads=0;for(let n=0;n<17;n++){const id=String(n);await f.guard.request(request(id));await f.guard.response({id,status:200,headers:[]});}assert.equal(f.fulfilled.length,16);await f.guard.close()});
test('declared oversize and request body limit fail before body acquisition',async()=>{const f=fixture();await f.guard.request({...request('large'),bodyBytes:65537});await f.guard.request(request('header'));await f.guard.response({id:'header',status:200,headers:[{name:'Content-Length',value:'2097153'}]});assert.deepEqual(f.events,['fail:large','continue:header','fail:header']);await f.guard.close()});
test('responsive read failure closes stream before failing request exactly once',async()=>{
 const f=fixture();f.transport.readStream=async()=>{throw Error('read failed')};
 await f.guard.request(request('a'));await f.guard.response({id:'a',status:200,headers:[]});await f.guard.close();
 assert.equal(f.events.filter(x=>x==='fail:a').length,1);
 assert.equal(f.events.filter(x=>x==='close:a').length,1);
 assert.ok(f.events.indexOf('close:a')<f.events.indexOf('fail:a'));
});
test('hung read timeout closes browser and late completion cannot fulfill or promote queue',async()=>{
 const f=fixture([], {requestMs:15,cleanupMs:10});let release!:(v:{data:Uint8Array;eof:boolean})=>void;
 f.transport.readStream=()=>new Promise(r=>release=r);
 await f.guard.request(request('a'));await f.guard.request(request('b'));
 const queued=f.guard.request(request('c'));
 const response=f.guard.response({id:'a',status:200,headers:[]});
 await new Promise(r=>setTimeout(r,40));await response;await queued;
 release({data:Buffer.from('late'),eof:true});await new Promise(r=>setImmediate(r));
 assert.equal(f.events.filter(x=>x==='browser-closed').length,1);assert.equal(f.fulfilled.length,0);assert.ok(!f.events.includes('continue:c'));
 await f.guard.close();
});
test('hung stream cleanup closes whole browser without issuing competing fail',async()=>{
 const f=fixture([], {requestMs:100,cleanupMs:10});f.transport.readStream=async()=>{throw Error('bad')};f.transport.closeStream=()=>new Promise(()=>{});
 await f.guard.request(request('a'));await f.guard.response({id:'a',status:200,headers:[]});
 assert.ok(f.events.includes('browser-closed'));assert.ok(!f.events.includes('fail:a'));assert.equal(f.fulfilled.length,0);await f.guard.close();
});
test('hung request rejection and browser shutdown cannot hang guard callers',async()=>{
 const f=fixture([], {requestMs:100,cleanupMs:10});f.transport.fail=()=>new Promise(()=>{});f.transport.failClosedBrowser=()=>new Promise(()=>{});
 await f.guard.request(request('x','https://unapproved.invalid/'));await f.guard.close();assert.equal(f.guard.browserClosureState,'unconfirmed');
 await f.guard.request(request('a'));assert.ok(!f.events.includes('continue:a'));
});
test('aborted in-flight fulfillment cannot issue any later request',async()=>{
 const f=fixture([], {requestMs:100,cleanupMs:10});let finish!:()=>void;
 f.transport.fulfill=()=>new Promise(r=>finish=r);
 await f.guard.request(request('a'));const response=f.guard.response({id:'a',status:200,headers:[]});
 await new Promise(r=>setImmediate(r));await f.guard.close();await response;finish();
 await f.guard.request(request('b'));assert.ok(f.events.includes('browser-closed'));assert.ok(!f.events.includes('continue:b'));
});
test('local disposal drains queue and clears timers without protocol sends or remote-close claim',async()=>{
 const f=fixture([], {requestMs:15,cleanupMs:10});await f.guard.request(request('a'));await f.guard.request(request('b'));const queue=f.guard.request(request('c'));
 f.guard.disposeLocal();await queue;assert.deepEqual(f.guard.pendingLocalWork,{active:0,queued:0,disposed:true});await new Promise(r=>setTimeout(r,25));
 await f.guard.request(request('late'));await f.guard.response({id:'late',status:200,headers:[]});await f.guard.close();assert.deepEqual(f.events,['continue:a','continue:b']);assert.equal(f.guard.browserClosureState,'not-requested');
});
test('local disposal aborts in-flight read and late completion cannot send cleanup or fulfillment',async()=>{
 const f=fixture();let release!:(v:{data:Uint8Array;eof:boolean})=>void;f.transport.readStream=()=>new Promise(r=>{release=r;});await f.guard.request(request('a'));const response=f.guard.response({id:'a',status:200,headers:[]});await new Promise(r=>setImmediate(r));f.guard.disposeLocal();await response;release({data:Buffer.from('late'),eof:true});await new Promise(r=>setImmediate(r));assert.deepEqual(f.events,['continue:a','stream:a']);assert.deepEqual(f.guard.pendingLocalWork,{active:0,queued:0,disposed:true});
});
test('native responses preserve original CSP and append enforced HTTPS-only connection policy',async()=>{const f=fixture();await f.guard.request(request('a'));await f.guard.response({id:'a',status:200,headers:[{name:'Content-Security-Policy',value:"default-src 'self'"}]});assert.equal(f.fulfilled.length,1);assert.deepEqual(f.fulfilled[0].headers,[{name:'Content-Security-Policy',value:"default-src 'self'"},{name:'Content-Security-Policy',value:'connect-src https:'}]);await f.guard.close()});
