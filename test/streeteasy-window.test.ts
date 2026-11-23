import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { loadStreetEasy } from '../server/streeteasy.ts';
import { type GraphQlRequest, sentJson } from './fixtures/json.ts';

const rental = (id: number, price: number) => ({ id: String(id), price, street: '1 Test Street', unit: String(id),
  zipCode: '10001', status: 'ACTIVE', bedroomCount: 1, urlPath: '/rental/' + (1000000 + id),
  areaName: 'Chelsea', buildingType: 'RENTAL', geoPoint: { latitude: 40.75, longitude: -73.99 } });
type Rental = Omit<ReturnType<typeof rental>, 'id'> & { id?: string; discounted?: number };
type RentalResult = { totalCount: number; edges: { node: Rental }[] };
function server(rows: Rental[], mutate: (result: RentalResult, page: number, range: number[] | null) => RentalResult = result => result) {
  let requests = 0, active = 0, maxActive = 0;
  const fetcher = async (_url: string, options?: RequestInit) => {
    requests++; active++; maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    try {
      const query = sentJson<GraphQlRequest>(required(options).body).query;
      const page = Number(query.match(/page: (\d+)/)?.[1]);
      const match = query.match(/lowerBound: (\d+), upperBound: (\d+)/);
      const range = match ? [Number(match[1]), Number(match[2])] : null;
      const selected = rows.filter((row) => !range || (row.price >= range[0] && row.price <= range[1]) ||
        (row.discounted !== undefined && row.discounted >= range[0] && row.discounted <= range[1]));
      const edges = page > 2 ? [] : selected.slice((page-1)*500, page*500).map(({discounted, ...node})=>({node}));
      return Response.json({data:{searchRentals:mutate({totalCount:selected.length,edges}, page, range)}});
    } finally {active--;}
  };
  return {fetcher, stats:()=>({requests,maxActive})};
}
test('partitions beyond 1,000 rows and reconciles overlapping gross/discounted price bands', async()=>{
  const rows = Array.from({length:1800},(_,id)=>({...rental(id,2000+id),discounted: id%3===0 ? 1900+id : undefined}));
  const mock=server(rows);
  const result=await loadStreetEasy(mock.fetcher);
  assert.equal(result.total,1800);assert.equal(result.listings.length,1800);
  assert.ok(mock.stats().maxActive<=3);assert.equal(result.pages,mock.stats().requests);
});
test('rejects changed partition totals instead of saving a partial snapshot',async()=>{
 const mock=server(Array.from({length:1200},(_,id)=>rental(id,2000+id)),(r,p,range)=>range?{...r,totalCount:r.totalCount+1}:r);
 await assert.rejects(()=>loadStreetEasy(mock.fetcher),/incomplete|changed/);
});
test('rejects a repeated second page',async()=>{
 const rows=Array.from({length:600},(_,id)=>rental(id,2000+id));
 const mock=server(rows,(r,p)=>p===2?{...r,edges:rows.slice(0,100).map(node=>({node}))}:r);
 await assert.rejects(()=>loadStreetEasy(mock.fetcher),/incomplete/);
});
test('handles empty inventory without inventing listings',async()=>{
 const result=await loadStreetEasy(server([]).fetcher);assert.equal(result.total,0);assert.equal(result.listings.length,0);
});
test('refuses more than maximum inventory before partitioning',async()=>{
 const mock=server([],()=>({totalCount:20001,edges:[]}));
 await assert.rejects(()=>loadStreetEasy(mock.fetcher),/sync limit/);assert.equal(mock.stats().requests,1);
});
test('cancels sibling requests after a partition failure', async()=>{
 let calls=0, cancelled=false;
 const rows=Array.from({length:1200},(_,id)=>rental(id,2000+id));
 const fetcher=async(_url: string,options: RequestInit = {})=>{
   calls++;
   const query=sentJson<GraphQlRequest>(options.body).query;
   if(!query.includes('lowerBound'))return Response.json({data:{searchRentals:{totalCount:1200,edges:rows.slice(0,500).map(node=>({node}))}}});
   if(query.includes('lowerBound: 0'))return new Response(null,{status:429});
   await new Promise<void>((resolve)=>required(options.signal).addEventListener('abort',()=>{cancelled=true;resolve();},{once:true}));
   throw required(options.signal).reason;
 };
 await assert.rejects(()=>loadStreetEasy(fetcher),/HTTP 429/);
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(cancelled,true);assert.equal(calls,3);
});
test('rejects rentals without IDs',async()=>{
 const mock=server([rental(1,2000)],r=>({...r,edges:[{node:{...r.edges[0].node,id:undefined}}]}));
 await assert.rejects(()=>loadStreetEasy(mock.fetcher),/without an ID/);
});
test('fails closed when one price has more than the result window',async()=>{
 const mock=server(Array.from({length:1001},(_,id)=>rental(id,3000)));
 await assert.rejects(()=>loadStreetEasy(mock.fetcher),/one price/);
 assert.ok(mock.stats().requests<=80);
});
test('bounds requests even for severely skewed partitions',async()=>{
 const mock=server(Array.from({length:20000},(_,id)=>rental(id,2000+id)));
 await loadStreetEasy(mock.fetcher).catch(error=>assert.match(error.message,/request limit/));
 assert.ok(mock.stats().requests<=160);
});

test('queries all markets and retains all five boroughs and New Jersey',async()=>{
 const zips=['10001','11215','11375','10451','10301','07302','07030'];
 const mock=server(zips.map((zipCode,i)=>({...rental(i,2500),zipCode})));
 const result=await loadStreetEasy(async(url,options)=>{
  assert.doesNotMatch(sentJson<GraphQlRequest>(required(options).body).query,/areas:/);
  return mock.fetcher(url,options);
 });
 assert.deepEqual(result.listings.map(x=>x.city),['Manhattan','Brooklyn','Queens','Bronx','Staten Island','Jersey City','Hoboken']);
});

// Unknown municipality names do not discard an otherwise valid source listing.
test('retains other regional ZIPs without inventing a municipality',async()=>{
 const mock=server(['07083','06902','10701'].map((zipCode,i)=>({...rental(i,2500),zipCode})));
 const result=await loadStreetEasy(mock.fetcher);
 assert.deepEqual(result.listings.map(x=>[x.city,x.region]),[['New Jersey','nj'],['Connecticut','ct'],['New York State','metroNorth']]);
});

test('keeps distinct StreetEasy listing IDs for the same unit and sends only JSON request headers', async () => {
  const mock = server([rental(1, 2500), { ...rental(2, 150000), unit: '1' }]);
  const result = await loadStreetEasy(async (url, options) => {
    const headers = new Headers(options?.headers);
    assert.deepEqual([...headers], [['accept', 'application/json'], ['content-type', 'application/json']]);
    return mock.fetcher(url, options);
  });
  assert.equal(result.rawCount, 2);
  assert.equal(result.listings[1].rent, 150000);
  assert.deepEqual(result.listings.map(({ id }) => id), ['streeteasy:1', 'streeteasy:2']);
});

test('does not report a complete sync when a provider record cannot be normalized', async () => {
  await assert.rejects(() => loadStreetEasy(server([{ ...rental(1, 2500), urlPath: '' }]).fetcher),
    /1 rentals that could not be saved/);
});

test('a malformed reply or a rental that changes between partitions is refused', async () => {
  for (const reply of [{ errors: [{ message: 'bad query' }] }, { data: { searchRentals: { totalCount: -1, edges: [] } } }, { data: {} }]) {
    await assert.rejects(loadStreetEasy(async () => Response.json(reply)), /did not return rental results/);
  }
  // 1,200 rentals force a split. Rental 6 also matches the upper price range through its
  // discounted rent, so it is listed twice; its second copy comes back changed.
  const rows = Array.from({ length: 1200 }, (_, id) => ({ ...rental(id, 2000 + id), ...(id === 6 ? { discounted: 3000 } : {}) }));
  const changing = server(rows, (result, _page, range) => range && range[0] > 2006 ?
    { ...result, edges: result.edges.map(({ node }) => ({ node: node.id === '6' ? { ...node, street: '2 Changed Street' } : node })) } : result);
  await assert.rejects(loadStreetEasy(changing.fetcher), /changed during the sync/);
});

test('StreetEasy public search pages without the active rental search are refused', async () => {
  const { parseStreetEasyPublicSearch } = await import('../server/streeteasy.ts');
  await assert.rejects(parseStreetEasyPublicSearch('<html><script>self.__next_f.push([1,"{}"])</script></html>', new Date()), /public active rental search/);
});

test('a Guttenberg listing keeps its own town name rather than its ZIP code’s', async () => {
  const { parseStreetEasyPage } = await import('../server/streeteasy.ts');
  const row = { '@type': 'Apartment', url: 'https://streeteasy.com/rental/4444', name: '7000 Boulevard East #5', numberOfBedrooms: 1,
    address: { streetAddress: '7000 Boulevard East', addressLocality: 'Guttenberg', addressRegion: 'NJ', postalCode: '07093' },
    geo: { latitude: 40.79, longitude: -74.0 }, additionalProperty: [{ name: 'Monthly Rent', value: '$2,300/mo' }] };
  const [listing] = parseStreetEasyPage('<script type="application/ld+json">' + JSON.stringify({ '@graph': [row] }) + '</script>', 'NJ', 1, new Date().toISOString());
  assert.equal(listing?.city, 'Guttenberg');
});
