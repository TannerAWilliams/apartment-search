import { expect, test } from 'bun:test';
import { handleApi } from './fixtures/api.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import {
  MANAGERS,
  loadManagerRerentals,
  readFifthAvenue,
  readMgny,
  readMns,
  readTaxace,
  words,
} from '../server/sources/manager-rerentals.ts';
import { storedManagerRerentals } from '../server/refresh/snapshots.ts';
import type { HousingResponse } from '../server/contracts.ts';

const FIFTH = `<section><div class="col-12 grid_section-col"><img alt="a"><h3>The Axel -539 Vanderbilt Avenue, Brooklyn NY</h3>
<div><h4 style="text-align: center;">Unit 6F</h4><ul><li><strong>Unit Size:</strong> Studio</li><li><strong>Household Size: </strong>1-2 people</li>
<li><strong>Rent: </strong><span>$2,732.32</span></li><li><strong>Min Income: </strong><span>$97,485.26</span></li><li><strong>Max Income: </strong>$176,410</li></ul></div></div>
<div class="col-12 grid_section-col"><h3>Sunset Ridge Apartments</h3><div><h4>Unit 3C</h4><ul><li><strong>Unit Size:</strong> Studio</li>
<li><strong>Max Income: </strong>$67,850</li></ul><p>**Tenant must be 62 years and older</p></div></div>
<div class="col-12 grid_section-col"><h3>Queens House</h3><h4>Unit 1</h4><ul><li><strong>Unit Size:</strong> 1-bedroom</li></ul></div>
<div class="col-12 grid_section-col"><h3>How to apply</h3><p>Send the form.</p></div></section>`;

const MNS = `<table><tbody><tr class="afordable_listing" data-hood="Morris Heights" data-bedrooms="1" data-address="1730   Harrison AVE">
<td><a href="https://www.mns.com/details/240428/rental/morris+heights/bronx" aria-label="address">1730 Harrison AVE</a></td>
<td class="unit"><a href="https://www.mns.com/details/240428/rental/morris+heights/bronx">4N</a></td><td>1</td><td>$2,653</td></tr>
<tr class="afordable_listing" data-hood="Greenpoint" data-bedrooms="0" data-address="65 Dupont ST">
<td><a href="https://www.mns.com/details/240777/rental/greenpoint/brooklyn">65 Dupont ST</a></td><td>ask</td></tr>
<tr class="afordable_listing" data-hood="Nowhere" data-address="1 Lost ST"><td><a href="https://www.mns.com/details/9/rental/nowhere/elsewhere">1 Lost ST</a></td></tr>
<tr class="afordable_listing" data-hood="x" data-address=""><td>nothing</td></tr></tbody></table>`;

const MGNY = JSON.stringify([
  {
    slug: 'house-55',
    link: 'https://mgnyconsulting.com/listing/house-55/',
    title: { rendered: 'House 55 Apartments' },
    acf: { property_address: '55 Willoughby St, Brooklyn, NY 11201', units: 46, min_income: 126412, max_income: 198510 },
  },
  {
    slug: 'arthur',
    link: 'https://mgnyconsulting.com/listing/arthur/',
    title: { rendered: '2180 Arthur Avenue' },
    acf: { property_address: '2180 Arthur Avenue, Bronx, NY 10457', units: 1 },
  },
  { slug: 'bare', link: 'https://mgnyconsulting.com/listing/bare/', title: { rendered: 'Bare &amp; Co' } },
  { slug: 'elsewhere', link: 'https://example.com/listing/x/', title: { rendered: 'Elsewhere' } },
  { slug: 7, link: 'https://mgnyconsulting.com/listing/seven/', title: 'Seven' },
  'not a building',
]);

const TAXACE = `<main><p>Vacant Available Units</p><div>2187 Ryer Avenue. Unit 6D</div><div>Bronx, NY</div><a>Apply</a><div>Unit Size: Studio</div>
<div>Rent: $2,660</div><div>Utilities: Tenant's Responsibility Elevator Building: Yes</div><div>Min Income: $98,278 - $168,480</div><div>Rent $2,660</div>
<div>103 Liberty Avenue. Unit 6C Brooklyn, NY Unit Size: 2-bedroom Rent: $3,741.18 Utilities: Tenant's Responsibility Elevator Building: Yes Min Income: $128,270 - $238,160 Rent $3,741.18 Apply</div>
<div>145 West 108 Street Unit 2A Manhattan , NY Apply Unit Size: 1-bedroom Rent: $2,998 Utilities: Included Min Income: $102,789- $198,510</div></main>`;

test('a page’s words are read without its markup, scripts or entities', () => {
  expect(words('<p>Tom &amp; Jerry&#8217;s&nbsp;place &bogus; <script>x()</script><style>p{}</style><b>here</b></p>')).toBe(
    'Tom & Jerry’s place here',
  );
});

test('Fifth Avenue Committee: one apartment per card, with what the card states', () => {
  expect(readFifthAvenue(FIFTH, 'https://fifthave.org/re-rental-availabilities/')).toEqual([
    {
      id: 'the-axel-539-vanderbilt-avenue-brooklyn-ny-unit-6f',
      name: 'The Axel -539 Vanderbilt Avenue, Brooklyn NY, Unit 6F',
      url: 'https://fifthave.org/re-rental-availabilities/',
      borough: 'Brooklyn',
      size: 'Studio',
      rent: '$2,732.32',
      income: '$97,485.26 to $176,410',
    },
    {
      id: 'sunset-ridge-apartments-unit-3c',
      name: 'Sunset Ridge Apartments, Unit 3C',
      url: 'https://fifthave.org/re-rental-availabilities/',
      borough: 'Brooklyn',
      size: 'Studio',
      rent: '',
      income: 'up to $67,850',
    },
    {
      id: 'queens-house-unit-1',
      name: 'Queens House, Unit 1',
      url: 'https://fifthave.org/re-rental-availabilities/',
      borough: 'Queens',
      size: '1-bedroom',
      rent: '',
      income: '',
    },
  ]);
});

test('MNS: one apartment per table row, linked to its own page', () => {
  expect(readMns(MNS)).toEqual([
    {
      id: '240428',
      name: '1730 Harrison AVE, Unit 4N',
      url: 'https://www.mns.com/details/240428/rental/morris+heights/bronx',
      borough: 'Bronx',
      size: '1-bedroom',
      rent: '$2,653',
      income: '',
    },
    {
      id: '240777',
      name: '65 Dupont ST',
      url: 'https://www.mns.com/details/240777/rental/greenpoint/brooklyn',
      borough: 'Brooklyn',
      size: 'Studio',
      rent: '',
      income: '',
    },
    {
      id: '9',
      name: '1 Lost ST',
      url: 'https://www.mns.com/details/9/rental/nowhere/elsewhere',
      borough: '',
      size: '',
      rent: '',
      income: '',
    },
  ]);
});

test('MGNY Consulting: one building per entry, with the incomes it takes and how many apartments', () => {
  expect(readMgny(MGNY)).toEqual([
    {
      id: 'house-55',
      name: 'House 55 Apartments, 55 Willoughby St, Brooklyn, NY 11201',
      url: 'https://mgnyconsulting.com/listing/house-55/',
      borough: 'Brooklyn',
      size: '46 apartments',
      rent: '',
      income: '$126,412 to $198,510',
    },
    {
      id: 'arthur',
      name: '2180 Arthur Avenue, Bronx, NY 10457',
      url: 'https://mgnyconsulting.com/listing/arthur/',
      borough: 'Bronx',
      size: '1 apartment',
      rent: '',
      income: '',
    },
    { id: 'bare', name: 'Bare & Co', url: 'https://mgnyconsulting.com/listing/bare/', borough: '', size: '', rent: '', income: '' },
  ]);
  expect(() => readMgny('{"message":"no"}')).toThrow('not a list');
});

test('Taxace NY: each vacant apartment from the page’s words, without the end of the one above it', () => {
  expect(
    readTaxace(TAXACE, 'https://www.taxaceny.com/projects-8').map(({ name, borough, size, rent, income }) => [
      name,
      borough,
      size,
      rent,
      income,
    ]),
  ).toEqual([
    ['2187 Ryer Avenue, Unit 6D', 'Bronx', 'Studio', '$2,660', '$98,278 to $168,480'],
    ['103 Liberty Avenue, Unit 6C', 'Brooklyn', '2-bedroom', '$3,741.18', '$128,270 to $238,160'],
    ['145 West 108 Street, Unit 2A', 'Manhattan', '1-bedroom', '$2,998', '$102,789 to $198,510'],
  ]);
});

const pages =
  (broken: string[] = []) =>
  async (url: string) => {
    const host = new URL(url).hostname;
    if (broken.includes(host)) return new Response('busy', { status: 503 });
    if (host === 'fifthave.org') return new Response(FIFTH);
    if (host === 'www.mns.com') return new Response(MNS + MNS);
    if (host === 'mgnyconsulting.com') return url.includes('/wp-json/') ? new Response(MGNY) : new Response('', { status: 404 });
    return new Response(TAXACE);
  };

test('every manager is read; one that cannot be is named, and the rest are still kept', async () => {
  const all = await loadManagerRerentals(pages());
  expect(all.managers.map(({ manager, count }) => [manager, count])).toEqual([
    ['Fifth Avenue Committee', 3],
    // The same apartment twice on a page is one apartment.
    ['MNS', 3],
    ['MGNY Consulting', 3],
    ['Taxace NY', 3],
  ]);
  expect(all.results).toHaveLength(12);
  expect(all.results[0]).toMatchObject({ manager: 'Fifth Avenue Committee', size: 'Studio' });
  expect(MANAGERS.every(({ url }) => url.startsWith('https://'))).toBe(true);

  const some = await loadManagerRerentals(pages(['www.mns.com', 'mgnyconsulting.com']));
  expect(some.managers.map(({ count }) => count)).toEqual([3, null, null, 3]);
  expect(some.results).toHaveLength(6);
  expect(loadManagerRerentals(async () => new Response('down', { status: 500 }))).rejects.toThrow(/None of the re-rental managers/);
});

test('a resync saves the managers’ apartments and the housing API returns them', async () => {
  const bucket = createMemoryBucket();
  expect(await storedManagerRerentals(bucket)).toBeNull();
  const refresh = await handleApi(
    new Request('https://walkup.test/api/refresh', {
      method: 'POST',
      body: JSON.stringify({ check: 'now', source: 'manager-rerentals' }),
      headers: { 'Content-Type': 'application/json' },
    }),
    { BUCKET: bucket },
    { fetcher: pages() },
  );
  expect(refresh.status).toBe(200);
  expect((await storedManagerRerentals(bucket))?.results).toHaveLength(12);
  const housing = (await (await handleApi(new Request('https://walkup.test/api/housing'), { BUCKET: bucket })).json()) as HousingResponse;
  expect(housing.managers?.managers).toHaveLength(4);
  expect(housing.managers?.checkedAt).toBeTruthy();
});
