import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseTruliaPage, TRULIA_LIVE } from '../server/trulia.ts';
import { parseZumperPage, ZUMPER_LIVE } from '../server/zumper.ts';
const checkedAt = '2026-11-12T23:00:00Z';
const markets = [{city:'Jersey City',state:'NJ',region:'nj',zip:'07302'}, {city:'Stamford',state:'CT',region:'ct',zip:'06901'}];
const truliaHtml = (row: unknown) => '<script id="__NEXT_DATA__">'+JSON.stringify({props:{searchData:{homes:[row]}}})+'</script>';
const zumperHtml = (row: unknown) => 'window.__PRELOADED_STATE__ = '+JSON.stringify({currentSearch:{listables:{listables:[row]}}})+'; window.__GIT_SHA__ = "test";';
for (const market of markets) {
 test(`Trulia accepts active single units in ${market.city}, not communities or neighboring cities`,()=>{
  const row={url:'/home/test-123', metadata:{unifiedListingType:'RENTAL_SINGLE_UNIT'},activeListing:{__typename:'HOME_ForRentListing'},location:{city:market.city,stateCode:market.state,zipCode:market.zip,streetAddress:'10 Main St #2',coordinates:{latitude:41,longitude:-74}},price:{price:2500},bedrooms:{value:1}};
  const parse=(r: unknown)=>parseTruliaPage(truliaHtml(r),{...market,bedrooms:1},checkedAt);
  assert.equal(parse(row)[0]?.region,market.region);
  assert.equal(parse({...row,location:{...row.location,city:'Elsewhere'}}).length,0);
  assert.equal(parse({...row,activeListing:null}).length,0);
  assert.equal(parse({...row,metadata:{unifiedListingType:'RENTAL_COMMUNITY'}}).length,0);
 });
 test(`Zumper accepts exact unit offers in ${market.city}, not price ranges or inactive records`,()=>{
  const row={url:'/listings/123p/test',listing_id:123,listing_status:1,listing_type:1,property_type:4,state:market.state,city:market.city,zipcode:market.zip,address:'10 Main St #2',min_price:2500,max_price:2500,min_bedrooms:1,max_bedrooms:1,lat:41,lng:-74};
  const parse=(r: unknown)=>parseZumperPage(zumperHtml(r),{ ...market, borough: null },checkedAt);
  assert.equal(parse(row)[0]?.region,market.region);
  for (const changed of [{city:'Elsewhere'},{listing_status:0},{max_price:3000},{url:'/apartment-buildings/p123/test'}]) assert.equal(parse({...row,...changed}).length,0);
 });
}
test('provider coverage advertises bounded pages rather than exhaustive inventory',()=>{
 const regions=['nyc','nj','li','metroNorth','ct'];
 assert.deepEqual(TRULIA_LIVE.regions,regions);assert.equal(TRULIA_LIVE.maxPages,64);
 assert.deepEqual(ZUMPER_LIVE.regions,regions);assert.equal(ZUMPER_LIVE.minPages,16);
 assert.match(TRULIA_LIVE.coverage,/first two/);assert.match(ZUMPER_LIVE.coverage,/Every individually priced apartment/);
});

test('HotPads preserves exact active unit offers, never building ranges or off-market units',async()=>{
 const {parseHotpadsPage}=await import('../server/hotpads.ts');
 const row={'@type':'Apartment',url:'https://hotpads.com/example-stamford-ct-06901-abc/4/pad',name:'10 Main St #4',address:{streetAddress:'10 Main St',addressLocality:'Stamford',addressRegion:'CT',postalCode:'06901'},numberOfBedrooms:2,offers:{'@type':'AggregateOffer',lowPrice:2500,highPrice:2500,availability:'https://schema.org/InStock',priceCurrency:'USD'}};
 const parse=(item: unknown)=>parseHotpadsPage('<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'ItemList',itemListElement:[{item}]}]})+'</script>',{city:'Stamford',state:'CT',region:'ct'},checkedAt);
 assert.equal(parse(row)[0]?.rent,2500);
 for(const changed of [ {'@type':'ApartmentComplex'}, {name:'10 Main St'}, {offers:{...row.offers,highPrice:3000}}, {offers:{...row.offers,availability:'https://schema.org/OutOfStock'}}, {url:'https://foreign.test/example/4/pad'}, {address:{...row.address,addressLocality:'Elsewhere'}} ]) assert.equal(parse({...row,...changed}).length,0);
});

test('Zumper sync pages through every market until no more results and counts skipped buildings', async () => {
  const { loadZumper, ZUMPER_MARKETS, ZUMPER_TRANSPORT } = await import('../server/zumper.ts');
  const requested: string[] = [];
  const unit = (id: number, zip: string, extra = {}) => ({ url: `/listings/${id}p/unit-${id}`, listing_id: id, listing_status: 1, listing_type: 1,
    property_type: 4, state: 'NY', city: 'New York', zipcode: zip, address: `${id} Main St #2`, min_price: 3000 + id, max_price: 3000 + id,
    min_bedrooms: 1, max_bedrooms: 1, lat: 40.7, lng: -73.99, ...extra });
  const result = await loadZumper(async (url: string) => {
    requested.push(url);
    const { pathname, searchParams } = new URL(url);
    const page = Number(searchParams.get('page') ?? 1);
    const manhattan = pathname.endsWith('/manhattan-ny');
    const rows = manhattan && page <= 3 ? [
      unit(page * 10 + 1, '10025'), unit(page * 10 + 2, '10025', { min_bedrooms: 6, max_bedrooms: 6, address: `${page} Park Ave #6` }),
      unit(page * 10 + 3, '10025', { min_price: 4000, max_price: 9000 }), // building entry with a price range
      ...(page === 2 ? [unit(11, '10025')] : []), // repeated from page 1
    ] : [];
    const state = { currentSearch: { hasMoreListables: manhattan && page < 3, listables: { listables: rows } } };
    return new Response('window.__PRELOADED_STATE__ = ' + JSON.stringify(state) + '; window.__GIT_SHA__', { headers: { 'Content-Type': 'text/html' } });
  }, new Date('2026-11-20T00:00:00Z'), async () => {});
  assert.equal(requested.filter((url) => url.includes('/manhattan-ny')).length, 3);
  assert.equal(requested.length, 3 + ZUMPER_MARKETS.length - 1, 'other markets stop at their empty first page');
  assert.equal(result.transport, ZUMPER_TRANSPORT);
  assert.equal(result.total, 9);
  assert.equal(result.buildings, 3);
  assert.deepEqual(result.listings.map(({ id }) => id).sort(), ['zumper:11', 'zumper:12', 'zumper:21', 'zumper:22', 'zumper:31', 'zumper:32']);
  assert.ok(result.listings.some(({ bedrooms }) => bedrooms === 6), 'large apartments are kept');
});

test('Zumper keeps broker listings with a hidden building number and non-apartment rental types, not floorplans or rooms', () => {
  const base = { url: '/listings/65499665/6-bedroom-east-village-new-york-ny', listing_id: 65499665, listing_status: 1, listing_type: 3, property_type: 4,
    state: 'NY', city: 'New York', zipcode: '10003', address: 'E 13th St #3AB', min_price: 14995, max_price: 14995, min_bedrooms: 6, max_bedrooms: 6, lat: 40.73, lng: -73.99 };
  const market = { city: 'Manhattan', state: 'NY', region: 'nyc', borough: 'manhattan' };
  const parse = (row: unknown) => parseZumperPage(zumperHtml(row), market, checkedAt);
  assert.deepEqual([parse(base)[0]?.address, parse(base)[0]?.unit], ['E 13th St', '3AB']);
  assert.equal(parse({ ...base, address: 'E 13th St' }).length, 0, 'no unit and no building number');
  assert.equal(parse({ ...base, listing_type: 1, property_type: 1, address: '801 Riverside Dr #5A', zipcode: '10032' }).length, 1);
  assert.equal(parse({ ...base, property_type: 16 }).length, 0);
  assert.equal(parse({ ...base, url: '/apartment-buildings/p203911/pearl-pine' }).length, 0);
  assert.equal(parse({ ...base, title: 'Private room in shared apartment' }).length, 0);
});
