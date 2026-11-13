import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createNativeFixture } from '../qualification/native-fixture-server.ts';
const config = {origin:'https://fixture-a.example',peerOrigin:'https://fixture-b.example',controlToken:'synthetic_control_token_1234567890'};
function setup() { const f=createNativeFixture(config);const get=(path:string,headers:Record<string,string>={})=>f.dispatch({method:'GET',path,headers});return {...f,get}; }
test('fixture is inert on construction and validates immutable origins',()=>{
 const f=setup();assert.equal(f.server.listening,false);
 for(const value of ['http://a.example','https://a.example/path','https://user:pass@a.example','https://a.example/?x=1']) assert.throws(()=>createNativeFixture({...config,origin:value}));
 assert.throws(()=>createNativeFixture({...config,peerOrigin:config.origin}));assert.throws(()=>createNativeFixture({...config,controlToken:'short'}));
});
test('control is authenticated, fixed counters only, reset is POST only',()=>{
 const f=setup();f.get('/gzip');assert.equal(f.get('/control/counters').status,401);
 const headers={authorization:`Bearer ${config.controlToken}`};const result=f.get('/control/counters',headers);assert.equal(JSON.parse(result.body.toString()).gzip,1);assert.ok(!result.body.toString().includes(config.controlToken));
 assert.equal(f.get('/control/reset',headers).status,405);
 assert.equal(f.dispatch({method:'POST',path:'/control/reset',headers}).status,204);
 assert.equal(JSON.parse(f.get('/control/counters',headers).body.toString()).gzip,0);
});
test('no arbitrary URLs or query forwarding and cookie check never echoes headers',()=>{
 const f=setup();for(const path of ['/redirect?url=https://evil.example','https://evil.example','/proxy'])assert.equal(f.get(path).status,404);
 assert.equal(f.get('/cookie/check',{cookie:'secret=do-not-echo; fixture_session=synthetic'}).body.toString(),'{"present":true}');
 assert.match(String(f.get('/cookie').headers['Set-Cookie']),/Path=\//);
});
test('CORS grants only fixed peer origin, encoding fixtures genuinely compress',()=>{
 const f=setup();assert.equal(f.get('/cors',{origin:config.peerOrigin}).headers['Access-Control-Allow-Origin'],config.peerOrigin);
 assert.equal(f.get('/cors',{origin:'https://other.example'}).headers['Access-Control-Allow-Origin'],undefined);
 const gzip=f.get('/gzip'),br=f.get('/br');assert.equal(gunzipSync(gzip.body as Buffer).toString(),brotliDecompressSync(br.body as Buffer).toString());
});
test('overflow streams 2 MiB plus one chunk, redirect and harness destinations fixed',async()=>{
 const f=setup();const response=f.get('/overflow');assert.equal(response.headers['Content-Length'],undefined);let size=0;for await(const chunk of response.body as AsyncIterable<Buffer>)size+=chunk.length;assert.equal(size,33*65536);
 assert.equal(f.get('/redirect').headers.Location,config.peerOrigin+'/destination/redirect');
 const html=f.get('/harness/iframe').body.toString()+f.get('/harness/websocket').body.toString();assert.ok(html.includes(config.peerOrigin+'/destination/iframe'));assert.ok(html.includes('wss://fixture-b.example/destination/websocket'));assert.ok(!html.includes(config.controlToken));
});
test('nested iframe fixed destination and actual upgrade event increment counters',()=>{
 const f=setup();assert.ok(f.get('/destination/iframe').body.toString().includes(config.peerOrigin+'/destination/nested-iframe'));
 let reply=''; f.server.emit('upgrade',{method:'GET',url:'/destination/websocket'},{end:(value:string)=>{reply=value;}},Buffer.alloc(0));
 assert.match(reply,/403 Forbidden/);
 const counts=JSON.parse(f.get('/control/counters',{authorization:`Bearer ${config.controlToken}`}).body.toString());assert.equal(counts.websocketAttempt,1);
});
test('mutating caller configuration cannot change fixture destinations or control key',()=>{
 const mutable={...config};const f=createNativeFixture(mutable);mutable.peerOrigin='https://other.example';mutable.controlToken='changed';
 const result=f.dispatch({method:'GET',path:'/redirect',headers:{}});assert.equal(result.headers.Location,config.peerOrigin+'/destination/redirect');
 assert.equal(f.dispatch({method:'GET',path:'/control/counters',headers:{authorization:`Bearer ${config.controlToken}`}}).status,200);
});

test('isolated harnesses cannot mask each other with a first fatal event',()=>{
 const f=setup();const iframe=f.get('/harness/iframe').body.toString(),worker=f.get('/harness/worker').body.toString(),ws=f.get('/harness/websocket').body.toString();
 assert.ok(iframe.includes('<iframe'));assert.ok(!iframe.includes('Worker')&&!iframe.includes('WebSocket'));
 assert.ok(worker.includes('new Worker'));assert.ok(!worker.includes('<iframe')&&!worker.includes('WebSocket'));
 assert.ok(ws.includes('new WebSocket'));assert.ok(!ws.includes('<iframe')&&!ws.includes('new Worker'));
 assert.equal(f.get('/harness').status,404);
 assert.equal(f.server.maxConnections,8);assert.equal(f.server.timeout,10000);assert.equal(f.server.keepAliveTimeout,1000);
});
test('response concurrency is bounded and released after stalled output closes',async()=>{
 const {EventEmitter}=await import('node:events');
 class Response extends EventEmitter {
  status=0;destroyed=false;timeout=0;
  writeHead(status:number){this.status=status;return this;}
  setTimeout(ms:number,_callback:()=>void){this.timeout=ms;return this;}
  write(_chunk:Buffer){return false;}
  end(){this.emit('finish');return this;}
  destroy(){this.destroyed=true;this.emit('close');return this;}
 }
 const f=setup();const responses=Array.from({length:5},()=>new Response());
 for(const res of responses) f.server.emit('request',{method:'GET',url:'/overflow',headers:{}},res);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(responses.map(res=>res.status),[200,200,200,200,503]);assert.equal(responses[0]?.timeout,10000);
 responses[0]!.destroy();const replacement=new Response();f.server.emit('request',{method:'GET',url:'/health',headers:{}},replacement);assert.equal(replacement.status,200);
 for(const res of responses)res.destroy();replacement.destroy();
 await new Promise(resolve=>setImmediate(resolve));
 for(const res of responses) {assert.equal(res.listenerCount('drain'),0);assert.equal(res.listenerCount('error'),0);}
});
test('additional harnesses are fixed and inherited frame script is structurally bounded',()=>{const f=setup();const body=f.get('/harness/inherited-websocket').body.toString();assert.match(body,/<body><script>/);assert.equal((body.match(/<script>/g)||[]).length,1);assert.equal((body.match(/<\/script>/g)||[]).length,1);for(const path of ['/harness/popup','/harness/cors'])assert.equal(f.get(path).status,200);assert.equal(f.get('/destination/popup').status,200);const counters=f.get('/control/counters',{authorization:`Bearer ${config.controlToken}`});assert.equal(JSON.parse(counters.body.toString()).popupDestination,1)});
