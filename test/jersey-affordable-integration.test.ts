import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBucket } from '../server/memory-bucket.ts';
import { refreshSources, storedJerseyAffordable } from '../server/refresh.ts';
import { handleApi } from '../server/api.ts';
import { configuredFeeds } from '../server/listings.ts';
import { JERSEY_AFFORDABLE, JERSEY_PAGE } from '../server/jersey-affordable.ts';
const html = `<div><h4>Current Affordable Housing Postings</h4><p>Updated 11-16-2026; 12 PM EST</p><a href="https://affordablehousingjc.com/">Apply</a><p>"Example Building" is located at 1 Example St., Jersey City, NJ 07302. This building has 2 one-bedroom apartments available.</p></div>`;
test('selected Jersey refresh, housing API and last-good retention remain separate from market inventory',async()=>{
 const bucket=createMemoryBucket();const env={BUCKET:bucket};let calls=0;
 const check=await refreshSources(env,{onDemand:true,sourceId:JERSEY_AFFORDABLE.id,now:new Date('2026-11-19T12:00:00Z'),fetcher:url=>{calls++;assert.equal(url,JERSEY_PAGE);return new Response(html,{headers:{'content-type':'text/html'}})}});
 assert.equal(calls,1);assert.equal(check.sources.find(s=>s.id===JERSEY_AFFORDABLE.id)?.status,'updated');
 const saved=await storedJerseyAffordable(bucket);assert.equal(saved?.total,2);
 const response=await handleApi(new Request('https://app.test/api/housing'),env,{fetcher:()=>{throw new Error('API must read saved data only')}});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.jersey.total,2);assert.equal(body.jersey.notices.length,1);
 for(const [index,reply] of [new Response('down',{status:503}),new Response('<html>No postings structure</html>',{headers:{'content-type':'text/html'}}),new Response(html.replace('11-16-2026','11-15-2026'),{headers:{'content-type':'text/html'}})].entries()){
  const failed=await refreshSources(env,{onDemand:true,forceRefresh:true,sourceId:JERSEY_AFFORDABLE.id,now:new Date(`2026-11-${20+index}T12:00:00Z`),fetcher:()=>reply});
  assert.equal(failed.sources.find(s=>s.id===JERSEY_AFFORDABLE.id)?.status,'failed');assert.deepEqual(await storedJerseyAffordable(bucket),saved);
 }
 const search=await handleApi(new Request('https://app.test/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({liveOnly:true,includeCommute:false})}),env,{fetcher:()=>{throw new Error('No external requests')}});
 const results=await search.json();assert.equal(results.total,0);assert.equal(results.matches.length,0);
});
test('Jersey source identity cannot collide with configured partner feeds',()=>{
 assert.throws(()=>configuredFeeds({FREE_PARTNER_FEEDS_JSON:JSON.stringify([{id:JERSEY_AFFORDABLE.id,name:'Collision',url:'https://example.com/feed.json'}])}));
});
