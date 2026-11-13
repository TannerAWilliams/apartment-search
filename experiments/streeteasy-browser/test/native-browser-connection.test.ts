import test from 'node:test';import assert from 'node:assert/strict';
import {nativeBrowserEndpoint,openNativeBrowser,type OpeningSocket} from '../server/native-browser-connection.ts';
class Socket implements OpeningSocket {
 listeners=new Map<string,Array<(e:{data?:unknown})=>void>>();closed=false;
 addEventListener(type:string,f:(e:{data?:unknown})=>void){this.listeners.set(type,[...(this.listeners.get(type)||[]),f]);}
 send(_data:string){} close(){this.closed=true;this.emit('close');}
 emit(type:string){for(const f of this.listeners.get(type)||[])f({});}
}
test('raw endpoint fixed and bounded without stealth flags',()=>{const u=new URL(nativeBrowserEndpoint('synthetic_valid_token_12345'));assert.equal(u.pathname,'/chromium');assert.equal(u.hostname,'production-sfo.browserless.io');assert.deepEqual([...u.searchParams.keys()],['token','timeout']);assert.equal(u.searchParams.get('timeout'),'110000');assert.throws(()=>nativeBrowserEndpoint('https://other.invalid'));});
test('native connection accepts open and returns closeable raw mux',async()=>{const socket=new Socket();const p=openNativeBrowser('synthetic_valid_token_12345',()=>{},()=>socket);socket.emit('open');const c=await p;c.close();assert.equal(socket.closed,true);});
test('opening failures sanitized and socket disposed',async()=>{const socket=new Socket();const p=openNativeBrowser('synthetic_valid_token_12345',()=>{},()=>socket);socket.emit('error');await assert.rejects(p,e=>e instanceof Error&&e.message==='Native browser connection failed');assert.equal(socket.closed,true);});

test('same-turn open then close cannot return a dead connection',async()=>{const socket=new Socket();const p=openNativeBrowser('synthetic_valid_token_12345',()=>{},()=>socket);socket.emit('open');socket.emit('close');await assert.rejects(p,/connection failed/);});
