import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSession, isBrowserAction, type BrowserDriver } from '../server/browser-session.ts';
import { allowedBrowserUrl, blockedDocument } from '../server/playwright-session.ts';
function setup(status = 200) {
  const calls: string[] = [];
  const driver: BrowserDriver = { recheck: async () => {}, hasChallenge: async () => false, start: async () => { calls.push('start'); }, fetch: async () => { calls.push('fetch'); return { status, body: '{"data":{}}', contentType: 'application/json' }; }, screenshot: async () => new Uint8Array([1]), action: async () => { calls.push('action'); }, close: async () => { calls.push('close'); } };
  return { session: new BrowserSession(async () => driver), calls };
}
test('same session reused across source pages', async () => { const {session,calls}=setup(); await session.request({source:'streeteasy',page:1}); await session.request({source:'streeteasy',page:2}); assert.deepEqual(calls,['start','fetch','fetch']); await session.close(); });
test('challenge stops queued and future upstream requests until explicit resume', async () => { const {session,calls}=setup(403); const responses=await Promise.all([session.request({source:'streeteasy',page:1}),session.request({source:'streeteasy',page:2})]); assert.deepEqual(responses.map(r=>r.status),[403,403]); assert.equal(calls.filter(x=>x==='fetch').length,1); await session.act({type:'click',x:10,y:10}); await session.resume(); await session.request({source:'streeteasy',page:1}); assert.equal(calls.filter(x=>x==='fetch').length,2); assert.equal(session.state,'challenge'); });
test('rejects arbitrary targets without starting browser',async()=>{ const {session,calls}=setup(); assert.equal((await session.request({url:'http://localhost'})).status,422); assert.equal((await session.request({source:'hotpads',market:'new-york-ny'})).status,422); assert.deepEqual(calls,[]); });
test('browser action bounds prevent arbitrary commands',()=>{ assert.equal(isBrowserAction({type:'key',key:'Control+L'}),false); assert.equal(isBrowserAction({type:'click',x:-1,y:1}),false); assert.equal(isBrowserAction({type:'type',text:'a\n'}),false); assert.equal(isBrowserAction({type:'key',key:'Tab'}),true); });
test('browser egress fixed hosts only',()=>{ for(const url of ['http://streeteasy.com/','https://localhost/','https://169.254.169.254/','https://streeteasy.com.evil.org/','https://x@streeteasy.com/','https://streeteasy.com:444/']) assert.equal(allowedBrowserUrl(url),false,url); assert.equal(allowedBrowserUrl('https://api-v6.streeteasy.com/'),true); assert.equal(allowedBrowserUrl('https://captcha.px-cloud.net/'),true); });
test('closed browser cannot restart or send more requests',async()=>{const{session,calls}=setup();await session.request({source:'streeteasy',page:1});await session.close();assert.equal((await session.request({source:'streeteasy',page:2})).status,503);assert.equal(session.state,'closed');assert.deepEqual(calls,['start','fetch','close']);});
test('close during startup cleans up late browser and stays closed', async()=>{
 let release!:()=>void; const started=new Promise<void>(r=>release=r);let open=false;let closes=0;
 const driver:BrowserDriver={start:async()=>{await started;open=true;},recheck: async () => {}, hasChallenge:async()=>false,fetch:async()=>({status:200,body:'{}',contentType:'application/json'}),screenshot:async()=>new Uint8Array(),action:async()=>{},close:async()=>{open=false;closes++;}};
 const session=new BrowserSession(async()=>driver);const pending=session.request({source:'streeteasy',page:1});await new Promise(r=>setImmediate(r));await session.close();release();await pending;assert.equal(session.state,'closed');assert.equal(open,false);assert.ok(closes>=2);
});
test('canceled queued request never goes upstream',async()=>{let release!:()=>void;const wait=new Promise<void>(r=>release=r);let fetches=0;const driver:BrowserDriver={start:async()=>{},recheck: async () => {}, hasChallenge:async()=>false,fetch:async()=>{fetches++;await wait;return{status:200,body:'{}',contentType:'application/json'}},screenshot:async()=>new Uint8Array(),action:async()=>{},close:async()=>{}};const session=new BrowserSession(async()=>driver);const first=session.request({source:'streeteasy',page:1});const abort=new AbortController();const second=session.request({source:'streeteasy',page:2},abort.signal);abort.abort();release();await first;assert.equal((await second).status,503);assert.equal(fetches,1);await session.close();});

test('blocked main document is not mistaken for an API-ready browser',()=>{assert.equal(blockedDocument(403),true);assert.equal(blockedDocument(429),true);assert.equal(blockedDocument(200),false);});
test('document block retains session for owner actions without API request',async()=>{let calls=0,blocked=true;const driver:BrowserDriver={start:async()=>{},recheck: async () => {}, hasChallenge:async()=>blocked,fetch:async()=>{calls++;return{status:200,body:'{}',contentType:'application/json'};},screenshot:async()=>new Uint8Array([1]),action:async()=>{},close:async()=>{}};const session=new BrowserSession(async()=>driver);assert.equal((await session.request({source:'streeteasy',page:1})).status,403);assert.equal(calls,0);assert.deepEqual(await session.screenshot(),new Uint8Array([1]));await assert.rejects(session.resume());blocked=false;await session.resume();assert.equal((await session.request({source:'streeteasy',page:1})).status,200);assert.equal(calls,1);await session.close();});


test('resume performs one explicit recheck and stays paused on a failed recheck', async () => {
  let rechecks = 0, fetches = 0;
  const driver: BrowserDriver = {
    start: async () => {}, hasChallenge: async () => false,
    recheck: async () => { rechecks++; throw new Error('Source still blocked'); },
    fetch: async () => { fetches++; return { status: 403, body: '', contentType: 'text/plain' }; },
    screenshot: async () => new Uint8Array(), action: async () => {}, close: async () => {},
  };
  const session = new BrowserSession(async () => driver);
  await session.request({ source: 'streeteasy', page: 1 });
  await assert.rejects(session.resume(), /still blocked/);
  assert.equal(rechecks, 1); assert.equal(fetches, 1); assert.equal(session.state, 'challenge');
  assert.equal((await session.request({ source: 'streeteasy', page: 2 })).status, 403);
  assert.equal(fetches, 1); await session.close();
});
test('missing, redirected, and unsuccessful documents fail closed', () => {
  for (const status of [undefined, 301, 302, 401, 403, 429, 500, 502]) assert.equal(blockedDocument(status), true);
  for (const status of [200, 204, 299]) assert.equal(blockedDocument(status), false);
});

import { recheckDeadline } from '../server/playwright-session.ts';
test('initial failure cooldown honors longer numeric and HTTP date Retry-After', () => {
  const now = Date.parse('2026-11-13T19:00:00Z');
  assert.equal(recheckDeadline(undefined, now), now + 60000);
  assert.equal(recheckDeadline('0', now), now + 60000);
  assert.equal(recheckDeadline('120', now), now + 120000);
  assert.equal(recheckDeadline('Fri, 13 Nov 2026 19:05:00 GMT', now), now + 300000);
  assert.equal(recheckDeadline('invalid', now), now + 60000);
});
