import { expect, test } from 'bun:test';
import { boroughKey, marketsForSearch, matchesRegion, parentRegion, searchBorough } from '../src/regions.ts';

const ny = (zip: string, county = '') => ({ state: 'NY', zip, county });

test('every NYC borough is recognized by ZIP code and county', () => {
  expect(searchBorough(ny('10025'))).toBe('manhattan');
  expect(searchBorough(ny('11215'))).toBe('brooklyn');
  expect(searchBorough(ny('11101'))).toBe('queens');
  expect(searchBorough(ny('11375'))).toBe('queens');
  expect(searchBorough(ny('11691'))).toBe('queens');
  expect(searchBorough(ny('11004'))).toBe('queens');
  expect(searchBorough(ny('10451'))).toBe('bronx');
  expect(searchBorough(ny('10301'))).toBe('staten-island');
  expect(searchBorough(ny('99999', 'Richmond County'))).toBe('staten-island');
  expect(searchBorough(ny('10701')), 'Yonkers is not a borough').toBeNull();
  expect(searchBorough({ state: 'NJ', zip: '10451' })).toBeNull();
});

test('borough areas match only their own borough; Manhattan & Brooklyn stays those two', () => {
  expect(matchesRegion(ny('11101'), 'queens')).toBeTruthy();
  expect(!matchesRegion(ny('11215'), 'queens')).toBeTruthy();
  expect(matchesRegion(ny('10451'), 'bronx')).toBeTruthy();
  expect(matchesRegion(ny('10301'), 'staten-island')).toBeTruthy();
  expect(matchesRegion(ny('11215'), 'manhattan-brooklyn')).toBeTruthy();
  expect(!matchesRegion(ny('11101'), 'manhattan-brooklyn')).toBeTruthy();
  expect(matchesRegion(ny('11101'), 'nyc')).toBeTruthy();
});

test('Westchester County is searchable inside Metro-North', () => {
  expect(matchesRegion(ny('10701'), 'westchester'), 'Yonkers').toBeTruthy();
  expect(matchesRegion(ny('10601'), 'westchester'), 'White Plains').toBeTruthy();
  expect(matchesRegion({ state: 'NY', zip: '99999', county: 'Westchester County' }, 'westchester')).toBeTruthy();
  expect(!matchesRegion(ny('12601'), 'westchester'), 'Poughkeepsie is in Dutchess').toBeTruthy();
  expect(!matchesRegion(ny('10960'), 'westchester'), 'Nyack is in Rockland').toBeTruthy();
  expect(matchesRegion(ny('10701'), 'metroNorth'), 'Metro-North still includes Westchester').toBeTruthy();
  expect(parentRegion('westchester')).toBe('metroNorth');
  expect(parentRegion('queens')).toBe('nyc');
  expect(marketsForSearch({ region: 'westchester' }).map(({ city }) => city).sort()).toStrictEqual(['Mount Vernon', 'New Rochelle', 'Tarrytown', 'White Plains', 'Yonkers']);
});

test('market names map to borough keys', () => {
  expect(boroughKey('The Bronx')).toBe('bronx');
  expect(boroughKey('Staten Island')).toBe('staten-island');
  expect(boroughKey('Jersey City')).toBeNull();
  expect(marketsForSearch({ region: 'queens' }).map(({ label }) => label)).toStrictEqual(['Queens']);
  expect(marketsForSearch({ region: 'manhattan-brooklyn' }).map(({ label }) => label)).toStrictEqual(['Manhattan', 'Brooklyn']);
});
