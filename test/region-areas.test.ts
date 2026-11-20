import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { boroughKey, marketsForSearch, matchesRegion, parentRegion, searchBorough } from '../src/regions.ts';

const ny = (zip: string, county = '') => ({ state: 'NY', zip, county });

test('every NYC borough is recognized by ZIP code and county', () => {
  assert.equal(searchBorough(ny('10025')), 'manhattan');
  assert.equal(searchBorough(ny('11215')), 'brooklyn');
  assert.equal(searchBorough(ny('11101')), 'queens');
  assert.equal(searchBorough(ny('11375')), 'queens');
  assert.equal(searchBorough(ny('11691')), 'queens');
  assert.equal(searchBorough(ny('11004')), 'queens');
  assert.equal(searchBorough(ny('10451')), 'bronx');
  assert.equal(searchBorough(ny('10301')), 'staten-island');
  assert.equal(searchBorough(ny('99999', 'Richmond County')), 'staten-island');
  assert.equal(searchBorough(ny('10701')), null, 'Yonkers is not a borough');
  assert.equal(searchBorough({ state: 'NJ', zip: '10451' }), null);
});

test('borough areas match only their own borough; Manhattan & Brooklyn stays those two', () => {
  assert.ok(matchesRegion(ny('11101'), 'queens'));
  assert.ok(!matchesRegion(ny('11215'), 'queens'));
  assert.ok(matchesRegion(ny('10451'), 'bronx'));
  assert.ok(matchesRegion(ny('10301'), 'staten-island'));
  assert.ok(matchesRegion(ny('11215'), 'manhattan-brooklyn'));
  assert.ok(!matchesRegion(ny('11101'), 'manhattan-brooklyn'));
  assert.ok(matchesRegion(ny('11101'), 'nyc'));
});

test('Westchester County is searchable inside Metro-North', () => {
  assert.ok(matchesRegion(ny('10701'), 'westchester'), 'Yonkers');
  assert.ok(matchesRegion(ny('10601'), 'westchester'), 'White Plains');
  assert.ok(matchesRegion({ state: 'NY', zip: '99999', county: 'Westchester County' }, 'westchester'));
  assert.ok(!matchesRegion(ny('12601'), 'westchester'), 'Poughkeepsie is in Dutchess');
  assert.ok(!matchesRegion(ny('10960'), 'westchester'), 'Nyack is in Rockland');
  assert.ok(matchesRegion(ny('10701'), 'metroNorth'), 'Metro-North still includes Westchester');
  assert.equal(parentRegion('westchester'), 'metroNorth');
  assert.equal(parentRegion('queens'), 'nyc');
  assert.deepEqual(marketsForSearch({ region: 'westchester' }).map(({ city }) => city).sort(),
    ['Mount Vernon', 'New Rochelle', 'Tarrytown', 'White Plains', 'Yonkers']);
});

test('market names map to borough keys', () => {
  assert.equal(boroughKey('The Bronx'), 'bronx');
  assert.equal(boroughKey('Staten Island'), 'staten-island');
  assert.equal(boroughKey('Jersey City'), null);
  assert.deepEqual(marketsForSearch({ region: 'queens' }).map(({ label }) => label), ['Queens']);
  assert.deepEqual(marketsForSearch({ region: 'manhattan-brooklyn' }).map(({ label }) => label), ['Manhattan', 'Brooklyn']);
});
