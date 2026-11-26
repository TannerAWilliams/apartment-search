import { expect, test } from 'bun:test';
import type { ListingData } from '../src/domain.ts';
import { homeExample } from '../src/home-example.ts';

const listing = (extra: Partial<ListingData>): ListingData =>
  ({
    id: 'a',
    address: '12 Grove Street',
    unit: '3',
    city: 'Brooklyn',
    state: 'NY',
    zip: '11215',
    neighborhood: 'Park Slope',
    rent: 3071,
    bedrooms: 1,
    sources: [{ id: 'zumper', name: 'Zumper', kind: 'feed', url: 'https://www.zumper.com/a' }],
    ...extra,
  }) as ListingData;
const graded = { openViolations: 0, complaints: 0, bedbugs: false, flood: false } as ListingData['building'];
const two = [
  { id: 'zumper', name: 'Zumper', kind: 'feed', url: 'https://www.zumper.com/a' },
  { id: 'trulia', name: 'Trulia', kind: 'feed', url: 'https://www.trulia.com/a' },
  { id: 'old', name: 'Gone', kind: 'feed', url: '' },
] as ListingData['sources'];

test('the home page’s example is the apartment that shows the most of what Walkup adds', () => {
  expect(homeExample([])).toBeNull();
  // One that shows nothing is no example.
  expect(homeExample([listing({})])).toBeNull();
  const best = homeExample([
    listing({ id: 'plain' }),
    listing({ id: 'priced', insights: { vsMarket: -0.18 } as ListingData['insights'] }),
    listing({ id: 'all', unit: '#4B', insights: { vsMarket: -0.18 } as ListingData['insights'], building: graded, sources: two }),
    listing({ id: 'later', insights: { vsMarket: -0.3 } as ListingData['insights'], building: graded, sources: two }),
  ]);
  expect(best).toEqual({
    id: 'all',
    title: '12 Grove Street, #4B',
    place: 'Park Slope, Brooklyn',
    rent: '$3,071',
    below: '18% below similar',
    grade: 'A',
    sites: ['Zumper', 'Trulia'],
  });
  // A rent above similar apartments is not shown off, and a place is not said twice.
  expect(
    homeExample([
      listing({ unit: '', neighborhood: 'Brooklyn', insights: { vsMarket: 0.2 } as ListingData['insights'], building: graded }),
    ]),
  ).toEqual({
    id: 'a',
    title: '12 Grove Street',
    place: 'Brooklyn',
    rent: '$3,071',
    below: null,
    grade: 'A',
    sites: [],
  });
});
