import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createListingSourceClient } from '../server/relay-client.ts';
import { appConfig, handleApi } from '../server/api.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';

for (const mode of ['direct', 'relay'] as const) test(`API records actual ${mode} attempt even on upstream403 without credentials`,async()=>{
  const env = {BUCKET:createMemoryBucket(),...(mode === 'relay' ? {LISTING_RELAY_URL:'https://example.onrender.com',LISTING_RELAY_TOKEN:'test-secret-'.repeat(4)} : {})};
  const calls:string[]=[];
  const client=createListingSourceClient(env,async(url,options)=>{
    calls.push(url);
    if(url.endsWith('/health')) return new Response('ok');
    assert.equal(url,mode === 'relay' ? 'https://example.onrender.com/fetch' : 'https://api-v6.streeteasy.com/');
    if(mode==='relay')assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer '+env.LISTING_RELAY_TOKEN);
    return new Response('{}',{status:403});
  });
  assert.deepEqual(client.listingTransports,{});
  const response=await handleApi(new Request('https://app.example/api/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({check:'now',source:'streeteasy-live'})}),env,client);
  assert.equal(response.status,200);
  const result=await response.json();
  const source=result.sources.find((s: { id: string })=>s.id==='streeteasy-live');
  assert.equal(source.requestTransport,mode);
  assert.equal(source.status,'failed');
  assert.match(source.error,/403/);
  assert.equal(calls.length,mode==='relay'?2:1);
  const config=appConfig(env);
  assert.equal(config.listingRequestTransport,mode);
  const serialized=JSON.stringify({result,config});
  assert.ok(!serialized.includes('test-secret'));
  assert.ok(!serialized.includes('example.onrender.com'));
});

test('diagnostic state is per request and unrelated fetches do not invent provider evidence',async()=>{
  const client=createListingSourceClient({},async()=>new Response('ok'));
  await client.fetcher('https://example.org',{});
  assert.deepEqual(client.listingTransports,{});
  await client.fetcher('https://hotpads.com/stamford-ct/condos-for-rent');
  assert.deepEqual(client.listingTransports,{'hotpads-live':'direct'});
  assert.deepEqual(createListingSourceClient({}).listingTransports,{});
});

test('invalid relay config fails closed instead of silently claiming direct mode',()=>{
  assert.throws(()=>createListingSourceClient({LISTING_RELAY_URL:'http://localhost'}));
  assert.throws(()=>appConfig({LISTING_RELAY_URL:'http://localhost'}));
});

test('native hosting can use direct provider requests without forwarding stored relay credentials', async () => {
  const env = { LISTING_FETCH_TRANSPORT: 'direct', LISTING_RELAY_URL: 'https://unused.onrender.com', LISTING_RELAY_TOKEN: 'stored-secret'.repeat(4) };
  let requests = 0;
  const client = createListingSourceClient(env, async (url, options) => {
    requests++;
    assert.equal(url, 'https://hotpads.com/stamford-ct/condos-for-rent');
    assert.equal(new Headers(options?.headers).get('Authorization'), null);
    return new Response('ok');
  });
  assert.equal(client.prepareListingSources, undefined);
  await client.fetcher('https://hotpads.com/stamford-ct/condos-for-rent');
  assert.equal(requests, 1);
  assert.equal(appConfig(env).listingRequestTransport, 'direct');
});
