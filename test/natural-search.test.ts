import { expect, test } from 'bun:test';
import { understand } from '../src/natural-search.ts';

const places = [
  { name: 'West Village', borough: 'Manhattan' },
  { name: 'Village', borough: 'Manhattan' },
  { name: 'Park Slope', borough: 'Brooklyn' },
  { name: 'Downtown', borough: 'Jersey City' },
];

test('a sentence becomes filters, and says what was understood', () => {
  expect(understand('2 bedroom in Brooklyn under $4k with laundry')).toEqual({
    changes: { bedrooms: 2, maxRent: 4000, region: 'brooklyn', neighborhood: '', laundry: 'in_building' },
    understood: ['2 BR', 'under $4,000', 'Brooklyn', 'laundry in the building'],
  });
  expect(understand('two bed in the West Village below $5,000', places)).toEqual({
    changes: { bedrooms: 2, maxRent: 5000, neighborhood: 'West Village', region: 'manhattan' },
    understood: ['2 BR', 'under $5,000', 'West Village'],
  });
  expect(understand('studio max 2500 pet friendly with a washer, 1.5 bath').changes).toEqual({
    bedrooms: 0,
    maxRent: 2500,
    petsRequired: true,
    laundry: 'in_unit',
    minBathrooms: 1.5,
  });
  expect(understand('rent stabilized 1br in a good building, a deal in the bronx').changes).toEqual({
    bedrooms: 1,
    region: 'bronx',
    neighborhood: '',
    stabilizedOnly: true,
    goodBuildings: true,
    belowMarket: true,
  });
  expect(
    understand('Downtown 6 bedrooms under 50', places).changes,
    'a borough-less neighborhood, a capped size, an unlikely rent',
  ).toEqual({
    bedrooms: 4,
    neighborhood: 'Downtown',
  });
  expect(understand('something nice').understood).toEqual([]);
  expect(understand('staten island under 3.5k').changes).toMatchObject({ region: 'staten-island', maxRent: 3500 });
});
