import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHdcRerentals } from '../server/hdc-rerentals.ts';
import { parseZillowPage, ZILLOW_LIVE } from '../server/zillow.ts';
import { parseRealtorPage, REALTOR_LIVE } from '../server/realtor.ts';
import { retryablePublicSources, decodeSourceImport, encodeSourceImport } from '../src/pull-sources.ts';
import { bundledRentHistory, rentSeries } from '../src/rent-history.ts';
const stamp = '2026-11-17T00:00:00Z';
const hdc = (rows: unknown[], pages = 1, perPage = 2, total = rows.length, page = 1) => ({json: rows, pagination: {'current-page': page, 'page-count': pages, 'per-page': perPage, 'total-results': total}});
const opportunity = { nid: '123', title: 'Example rental', pdf: '/sites/default/files/example.pdf', address: '1 Main Street', borough: 'Brooklyn' };
test('HDC validates transport, shape and pagination independently', async () => {
  await assert.rejects(loadHdcRerentals(async () => new Response('', {status:503})), /HTTP 503/);
  for (const payload of [{}, hdc([],1,2,0,2), hdc([], -1), hdc([], 1,0), hdc([],1,51), hdc([],1,2,-1), hdc([],2,2,1)]) {
    await assert.rejects(loadHdcRerentals(async () => Response.json(payload)), /recognized|pagination/);
  }
  assert.deepEqual(await loadHdcRerentals(async () => Response.json(hdc([],0))), {results:[],total:0,limited:false});
  await assert.rejects(loadHdcRerentals(async () => Response.json(hdc([{nid:'x'}]))), /usable listings/);
});
test('HDC follows offsets, deduplicates IDs and preserves safe PDF and CTA fallbacks', async () => {
  const urls: string[] = [];
  const result = await loadHdcRerentals(async url => {
    urls.push(url);
    return Response.json(urls.length === 1 ? hdc([opportunity, { ...opportunity,nid:'456',pdf:null,cta:'https://example.com/apply'}],2,2,4) : hdc([opportunity,{nid:789,title:null,cta:'javascript:alert(1)'}],2,2,4,2));
  });
  assert.equal(result.results.length,2); assert.equal(result.limited,true);
  assert.match(urls[1], /current-page=2&offset=2/);
  assert.equal(result.results[0].url,'https://www.nychdc.com/sites/default/files/example.pdf');
  assert.equal(result.results[1].url,'https://example.com/apply');
  assert.equal(result.results[1].rent,'');
});
const zmarket = {city:'Jersey City',state:'NJ',region:'nj'};
const zrow = {detailUrl:'/homedetails/12-Grove-St/123_zpid/', statusType:'FOR_RENT', hdpData:{homeInfo:{homeType:'APARTMENT',zpid:123}},latLong:{latitude:40.72,longitude:-74.04},addressState:'NJ',addressCity:'Jersey City',addressZipcode:'07302',addressStreet:'12 Grove Street',beds:1,unformattedPrice:2400};
const zhtml = (rows: unknown[]) => `<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{searchPageState:{cat1:{searchResults:{listResults:rows}}}}}})}</script>`;
test('Zillow accepts apartment facts, fee flag and rejects unsafe or ineligible rows', () => {
  assert.throws(() => parseZillowPage('',zmarket,stamp), /recognized/);
  const valid = parseZillowPage(zhtml([zrow,{...zrow,zpid:456,listPriceIncludesRequiredMonthlyFees:true}]),zmarket,stamp);
  assert.equal(valid.length,2); assert.equal(valid[0].rent,2400); assert.equal(valid[0].priceIncludesFees,false); assert.equal(valid[1].priceIncludesFees,true);
  for (const patch of [{detailUrl:'https://evil.example/homedetails/x/1_zpid/'},{statusType:'FOR_SALE'},{isBuilding:true},{isUndisclosedAddress:true},{hdpData:{}},{statusText:'room for rent'},{addressState:'NY'},{addressCity:'Newark'},{latLong:{}},{addressZipcode:'bad'},{unformattedPrice:0},{beds:9}]) {
    assert.deepEqual(parseZillowPage(zhtml([{...zrow,...patch}]),zmarket,stamp),[]);
  }
});
const rmarket = {city:'Queens',region:'nyc'};
const rrow = {permalink:'12-Test-St_M123-456',status:'for_rent',description:{type:'apartment',beds:1},list_price:2400,listing_id:'1',location:{address:{line:'12 Test Street',state_code:'NY',postal_code:'11101',city:'Queens',coordinate:{lat:40.75,lon:-73.94}}}};
const rhtml = (rows: unknown[]) => `<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{properties:rows}}})}</script>`;
test('Realtor accepts eligible rentals and rejects pending, non-apartment and corrupt facts', () => {
  assert.throws(() => parseRealtorPage('',rmarket,stamp), /recognized/);
  assert.equal(parseRealtorPage(rhtml([rrow]),rmarket,stamp)[0].rent,2400);
  for (const patch of [{permalink:null},{status:'sold'},{flags:{is_pending:true}},{description:{type:'house',beds:1}},{description:{type:'apartment',beds:1.5}},{list_price:2801},{list_price:0},{location:{}}]) assert.deepEqual(parseRealtorPage(rhtml([{...rrow,...patch}]),rmarket,stamp),[]);
  for (const patch of [{state_code:'NJ'},{postal_code:'bad'},{line:'unknown'},{coordinate:{}},{city:'elsewhere'}]) {
    const market = patch.city ? {city:'White Plains',region:'metroNorth'} : rmarket;
    assert.deepEqual(parseRealtorPage(rhtml([{...rrow,location:{address:{...rrow.location.address,...patch}}}]),market,stamp),[]);
  }
});
test('provider loaders reject blocked transport rather than inventing inventory', async () => {
  for (const provider of [ZILLOW_LIVE, REALTOR_LIVE]) await assert.rejects(provider.load(async () => new Response('',{status:403}),new Date(stamp)), /403/);
});
test('source retry policy excludes future retries, successful and unsupported providers', () => {
  assert.deepEqual(retryablePublicSources({},new Date(stamp)),[]);
  assert.deepEqual(retryablePublicSources({sources:[{id:'firstmover',status:'failed'}, {id:'housingconnect',status:'failed',retryAt:'2099-01-01'}, {id:'unknown',status:'failed'}, {id:'housingconnect',status:'updated'}]},new Date(stamp)),['firstmover']);
  for (const value of [null,[],false]) assert.throws(() => decodeSourceImport(encodeSourceImport(value)), /invalid/);
  assert.throws(() => decodeSourceImport({payload:'AAAA'}), /invalid/);
});
test('bundled history preserves absent months and missing bedroom observations', () => {
  const history = bundledRentHistory('1900-06','missing','zip');
  assert.equal(history.length,5); assert.deepEqual(history[0],['1900-01',[]]);
  assert.deepEqual(rentSeries({id:'x',sizes:[{median:2000,count:1}]},0,'1900-06',history)[0], {month:'1900-01',median:null,count:0});
});

import { parseListingImport } from '../src/import-listings.ts';
import { parseRentHopPage, RENTHOP_LIVE } from '../server/renthop.ts';
import { parseAffordableRentals, AFFORDABLE_LIVE } from '../server/affordable-rentals.ts';
test('CSV rejects missing/duplicate columns, empty files and invalid optional coordinates', () => {
  const header='url,address,unit,city,state,zip,bedrooms,rent';
  for (const csv of ['',header,header+',rent\n',header+'\nhttps://example.com,1 Main,,Brooklyn,NY,11201,1,1000,extra']) assert.throws(() => parseListingImport(csv));
  for (const coords of ['40,','x,-73','91,-73']) assert.throws(() => parseListingImport(`${header},latitude,longitude\nhttps://example.com,1 Main,,Brooklyn,NY,11201,1,1000,${coords}`), /coordinates/);
  assert.equal(parseListingImport(`${header},latitude,longitude\nhttps://example.com,1 Main,,Brooklyn,NY,11201,1,1000,40,-73`)[0].latitude,40);
});
const hopCard = `<div id="listing-1"><a id="listing-1-title" href="/listings/example/1">12 Test Street</a><div id="listing-1-neighborhoods">Example, Brooklyn</div><div>11201</div><div id="listing-1-price">$2,000</div><div><img alt="bedrooms"></div><div>Studio</div><span latitude="40.7" longitude="-73.9"></span><div id="listing-1-padding">`;
test('RentHop parses studio facts and refuses shared rooms, over-budget and incomplete cards', async () => {
  assert.throws(() => parseRentHopPage('',{budget:2200},stamp), /recognized/);
  const listings=parseRentHopPage(hopCard,{budget:2200},stamp);
  assert.equal(listings.length,1); assert.equal(listings[0].bedrooms,0); assert.equal(listings[0].rent,2000);
  assert.equal(parseRentHopPage(hopCard.replace('Studio','1 Bed'),{budget:2200},stamp)[0].bedrooms,1);
  for (const card of [hopCard.replace('12 Test Street','12 shared apartment'),hopCard.replace('11201','00000'),hopCard.replace('$2,000','$3,000'),hopCard.replace('latitude=','absent='),hopCard.replace('/listings/example/1','https://evil.example/listings/example/1'),hopCard.replace('Studio','unknown')]) assert.deepEqual(parseRentHopPage(card,{budget:2200},stamp),[]);
  await assert.rejects(RENTHOP_LIVE.load(async () => new Response('',{status:403}),new Date(stamp)), /403/);
});
const affordableCard = `<article data-listing-card-type="rental"><span class="green--text"><em></em>Available Now</span><span class="details-category">Apartment</span><a data-track="listing-card-link" href="/brooklyn-ny/test-123/"></a><div class="tnresult--propertyaddress">12 Test Street, Brooklyn, NY 11201</div><div class="card--price">$2,000</div><div class="card--details"><span>Studio</span></div><div class="card--tmlp--text"><div>Total Monthly Price</div></div></article>`;
test('AffordableHousing recognizes availability, borough restrictions and disclosed fee inclusion', async () => {
  const market={city:'Brooklyn',state:'NY',region:'nyc'};
  assert.throws(() => parseAffordableRentals('',market,stamp), /recognized/);
  const result=parseAffordableRentals(affordableCard,market,stamp);
  assert.equal(result.length,1); assert.equal(result[0].priceIncludesFees,true); assert.equal(result[0].bedrooms,0);
  assert.equal(parseAffordableRentals(affordableCard.replace('Studio</span>','1 <span>beds</span>').replace('Total Monthly Price','Rent'),market,stamp)[0].priceIncludesFees,false);
  for (const card of [affordableCard.replace('Available Now','Unavailable'),affordableCard.replace('Apartment','House'),affordableCard.replace('11201','10001'),affordableCard.replace('NY 11201','NJ 11201'),affordableCard.replace('$2,000','unknown'),affordableCard.replace('Studio','unknown'),affordableCard.replace('/brooklyn-ny/test-123/','javascript:alert(1)')]) assert.deepEqual(parseAffordableRentals(card,market,stamp),[]);
  await assert.rejects(AFFORDABLE_LIVE.load(async () => new Response('',{status:403}),new Date(stamp)), /403/);
});

import { geocodeRentalAddresses } from '../server/geocode-rentals.ts';
import { fetchPublicHtml, publicListingUrl } from '../server/public-rentals.ts';
test('geocoding retains source facts on failure and accepts only exact in-region coordinates', async () => {
  let calls=0;
  assert.deepEqual(await geocodeRentalAddresses([],async () => {calls++;}),[]); assert.equal(calls,0);
  const listings=[{id:'a',address:'1 "Test" Street',city:'Manhattan',state:'NY',zip:'10001'}, {id:'b',address:'2 Test Street',city:'Brooklyn',state:'NY',zip:'11201'}];
  assert.deepEqual(await geocodeRentalAddresses(listings,async () => new Response('',{status:503})),listings);
  const result=await geocodeRentalAddresses(listings,async (_url, options) => {
    assert.match(await options.body.get('addressFile').text(), /New York/);
    return new Response('a,,Match,Exact,,"-73.9,40.7"\nb,,No_Match,Exact\nb,,Match,Non_Exact\nb,,Match,Exact,,"-90,40"\nb,,Match,Exact\n');
  });
  assert.equal(result[0].latitude,40.7); assert.equal(result[1].latitude,undefined);
});
test('HTML fetch rejects unsupported content and oversized declared and streamed bodies', async () => {
  assert.equal(publicListingUrl('http://[','https://example.com',/^\//),null);
  for (const response of [new Response('{}',{headers:{'content-type':'application/json'}}),new Response(null,{headers:{'content-type':'text/html'}}),new Response('x',{headers:{'content-type':'text/html','content-length':'6000000'}})]) await assert.rejects(fetchPublicHtml(async () => response,'https://example.com','Example'), /supported/);
  let cancelled=false;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(5*1024*1024+1));},cancel(){cancelled=true;}});
  await assert.rejects(fetchPublicHtml(async () => new Response(body,{headers:{'content-type':'text/html'}}),'https://example.com','Example'), /too large/);
  assert.equal(cancelled,true);
});
