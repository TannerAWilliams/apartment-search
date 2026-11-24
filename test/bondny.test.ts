import { expect, test } from 'bun:test';
import { BONDNY_LIVE, bondnyListingUrl } from '../server/sources/bondny.ts';

const at = '2026-11-24T00:00:00.000Z';
const ORIGIN = 'https://www.bondnewyork.com';
const page = `<html>
  <a class="accordion-toggle" id="Cat_163" href="#cat163">East Side <i></i></a>
  <input aria-label="Yorkville" type="checkbox" name="cat" value="182"
    class="styled checkCat_163 cat">
  <li class="property-card item graphic"><a class="heartIconLink" data-pid="1852421"></a>
    <div class="image-caption"><h3><a href="${ORIGIN}/yorkville/apartment-for-rent/515-east-86th-street-1905/1852421">515 EAST 86TH STREET, #1905</a></h3>
    <span class="property-grid-type">Apartment </span><span class="property-grid-area">Yorkville</span>
    <div class="price"><span>$4,100</span><div class="bedrooms">1 BR <span>|</span> 1 BT</div></div></div></li>
  <h3>1 records found</h3></html>`;

test('Bond New York is read from its RealtyMX rentals search, 250 cards a page', async () => {
  const requested: string[] = [];
  const result = await BONDNY_LIVE.load(async (url) => {
    requested.push(url);
    return url.includes('census')
      ? new Response('"1852421","x","Match","Exact","515 E 86TH ST, NEW YORK, NY, 10028","-73.95,40.77","1","L"')
      : new Response(page, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
  }, new Date(at));
  expect(requested[0]).toBe(`${ORIGIN}/index.cfm?page=properties&status=2&isCompany=1&isMLS=1&maxRows=250&startAt=1`);
  expect(result.listings).toEqual([
    expect.objectContaining({
      id: 'bondny:1852421',
      address: '515 EAST 86TH STREET',
      unit: '1905',
      city: 'Manhattan',
      zip: '10028',
      rent: 4100,
    }),
  ]);
  expect(result.listings[0]?.sources[0]).toMatchObject({
    id: 'bondny',
    url: `${ORIGIN}/yorkville/apartment-for-rent/515-east-86th-street-1905/1852421`,
  });
  expect(bondnyListingUrl(`${ORIGIN}/upper-west-side/apartment/45-west-81st-street-penthouse/1855042`)).toBeNull();
  expect(bondnyListingUrl(`${ORIGIN}/long-island-city/retail-for-rent/37-17-broadway-a/1856743`)).toBeTruthy();
});
