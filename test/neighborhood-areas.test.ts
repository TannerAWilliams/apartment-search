import { expect, test } from 'bun:test';
import { areaAt, manhattanPart, mapAreas, neighborhoodSpots, toggleNames } from '../src/neighborhood-areas.ts';

test('a neighborhood is placed at the middle of its apartments that say where they are', () => {
  const spots = neighborhoodSpots([
    { neighborhood: 'Chelsea', latitude: 40.74, longitude: -74 },
    { neighborhood: 'Chelsea', latitude: 40.75, longitude: -73.99 },
    { neighborhood: 'Chelsea', latitude: null, longitude: null },
    { neighborhood: '', latitude: 40.7, longitude: -74 },
    { latitude: 40.7, longitude: -74 },
  ]);
  expect(Object.keys(spots)).toEqual(['Chelsea']);
  expect(spots.Chelsea!.latitude).toBeCloseTo(40.745, 6);
  expect(spots.Chelsea!.longitude).toBeCloseTo(-73.995, 6);
});

test('Manhattan is downtown below 14th Street, midtown to 59th and uptown above', () => {
  const part = (latitude: number, longitude: number) => manhattanPart({ latitude, longitude });
  expect(part(40.7348, -74.0048)).toBe('downtown'); // West Village
  expect(part(40.7275, -73.9846)).toBe('downtown'); // East Village
  expect(part(40.7071, -74.0082)).toBe('downtown'); // Financial District
  expect(part(40.7455, -73.9975)).toBe('midtown'); // Chelsea
  expect(part(40.7364, -73.9837)).toBe('midtown'); // Gramercy Park
  expect(part(40.7576, -73.9651)).toBe('midtown'); // Sutton Place
  expect(part(40.7669, -73.9589)).toBe('uptown'); // Lenox Hill
  expect(part(40.7744, -73.9848)).toBe('uptown'); // Lincoln Center
  expect(part(40.8657, -73.9217)).toBe('uptown'); // Inwood
});

test('the map’s areas hold the neighborhoods found inside them, and tapping one chooses or clears them all', () => {
  const square = (south: number, west: number) => [south, west, south + 1, west, south + 1, west + 1, south, west + 1];
  const shapes = [
    { name: 'West', borough: 'Manhattan', rings: [square(0, 0)] },
    { name: 'East', borough: 'Manhattan', rings: [square(5, 5), square(0, 1)] },
    { name: 'Empty', borough: 'Manhattan', rings: [square(9, 9)] },
  ];
  const spots = { A: { latitude: 0.5, longitude: 0.5 }, B: { latitude: 0.2, longitude: 0.8 }, C: { latitude: 0.5, longitude: 1.5 } };
  const areas = mapAreas(shapes, ['A', 'B', 'C', 'Nowhere'], spots, ['C']);
  expect(areas).toEqual([
    { key: 'West', label: 'A, B', names: ['A', 'B'], rings: shapes[0]!.rings, selected: false },
    { key: 'East', label: 'C', names: ['C'], rings: shapes[1]!.rings, selected: true },
  ]);
  expect(areaAt(areas, { latitude: 0.5, longitude: 1.2 })?.key).toBe('East');
  expect(areaAt(areas, { latitude: 3, longitude: 3 })).toBeUndefined();
  expect(toggleNames(['C'], ['A', 'B'])).toEqual(['C', 'A', 'B']);
  expect(toggleNames(['C', 'A'], ['A', 'B'])).toEqual(['C', 'A', 'B']);
  expect(toggleNames(['C', 'A', 'B'], ['A', 'B'])).toEqual(['C']);
});
