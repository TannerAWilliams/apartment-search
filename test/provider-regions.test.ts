import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseTruliaPage, TRULIA_LIVE } from '../server/trulia.ts';
import { parseZumperPage, ZUMPER_LIVE } from '../server/zumper.ts';
const checkedAt = '2026-11-12T23:00:00Z';
const markets = [{city:'Jersey City',state:'NJ',region:'nj',zip:'07302'}, {city:'Stamford',state:'CT',region:'ct',zip:'06901'}];
const truliaHtml = (row) => '<script id="__NEXT_DATA__">'+JSON.stringify({props:{searchData:{homes:[row]}}})+'</script>';
const zumperHtml = (row) => 'window.__PRELOADED_STATE__ = '+JSON.stringify({currentSearch:{listables:{listables:[row]}}})+'; window.__GIT_SHA__ = "test";';
for (const market of markets) {
 test(`Trulia accepts active single units in ${market.city}, not communities or neighboring cities`,()=>{
  const row={url:'/home/test-123', metadata:{unifiedListingType:'RENTAL_SINGLE_UNIT'},activeListing:{__typename:'HOME_ForRentListing'},location:{city:market.city,stateCode:market.state,zipCode:market.zip,streetAddress:'10 Main St #2',coordinates:{latitude:41,longitude:-74}},price:{price:2500},bedrooms:{value:1}};
  const parse=(r)=>parseTruliaPage(truliaHtml(r),{...market,bedrooms:1},checkedAt);
  assert.equal(parse(row)[0]?.region,market.region);
  assert.equal(parse({...row,location:{...row.location,city:'Elsewhere'}}).length,0);
  assert.equal(parse({...row,activeListing:null}).length,0);
  assert.equal(parse({...row,metadata:{unifiedListingType:'RENTAL_COMMUNITY'}}).length,0);
 });
 test(`Zumper accepts exact unit offers in ${market.city}, not price ranges or inactive records`,()=>{
  const row={url:'/listings/123p/test',listing_id:123,listing_status:1,listing_type:1,property_type:4,state:market.state,city:market.city,zipcode:market.zip,address:'10 Main St #2',min_price:2500,max_price:2500,min_bedrooms:1,max_bedrooms:1,lat:41,lng:-74};
  const parse=(r)=>parseZumperPage(zumperHtml(r),market,checkedAt);
  assert.equal(parse(row)[0]?.region,market.region);
  for (const changed of [{city:'Elsewhere'},{listing_status:0},{max_price:3000},{url:'/apartment-buildings/p123/test'}]) assert.equal(parse({...row,...changed}).length,0);
 });
}
test('provider coverage advertises bounded pages rather than exhaustive inventory',()=>{
 assert.deepEqual(TRULIA_LIVE.regions,['nyc','nj','ct']);assert.equal(TRULIA_LIVE.maxPages,16);
 assert.deepEqual(ZUMPER_LIVE.regions,['nyc','nj','ct']);assert.equal(ZUMPER_LIVE.maxPages,12);
 assert.match(TRULIA_LIVE.coverage,/first two/);assert.match(ZUMPER_LIVE.coverage,/three search pages/);
});

test('HotPads preserves exact active unit offers, never building ranges or off-market units',async()=>{
 const {parseHotpadsPage}=await import('../server/hotpads.ts');
 const row={'@type':'Apartment',url:'https://hotpads.com/example-stamford-ct-06901-abc/4/pad',name:'10 Main St #4',address:{streetAddress:'10 Main St',addressLocality:'Stamford',addressRegion:'CT',postalCode:'06901'},numberOfBedrooms:2,offers:{'@type':'AggregateOffer',lowPrice:2500,highPrice:2500,availability:'https://schema.org/InStock',priceCurrency:'USD'}};
 const parse=(item)=>parseHotpadsPage('<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'ItemList',itemListElement:[{item}]}]})+'</script>',{city:'Stamford',state:'CT',region:'ct'},checkedAt);
 assert.equal(parse(row)[0]?.rent,2500);
 for(const changed of [ {'@type':'ApartmentComplex'}, {name:'10 Main St'}, {offers:{...row.offers,highPrice:3000}}, {offers:{...row.offers,availability:'https://schema.org/OutOfStock'}}, {url:'https://foreign.test/example/4/pad'}, {address:{...row.address,addressLocality:'Elsewhere'}} ]) assert.equal(parse({...row,...changed}).length,0);
});
