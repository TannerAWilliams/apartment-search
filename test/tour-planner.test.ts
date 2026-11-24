import { test, expect } from 'bun:test';
import {
  parseTours,
  validateTours,
  localTourStart,
  moveTour,
  chronologicalTours,
  overlappingTourIds,
  tourRoute,
  tourDay,
  toursOnDay,
  exportTours,
  MAX_TOURS,
} from '../src/tour-planner.ts';
const tour = (id = 'one', startsAt = '2026-12-05T19:00:00.000Z') => ({
  id,
  listingKey: 'unit|' + id,
  address: '123 Main St, Unit 2, Brooklyn, NY',
  startsAt,
  minutes: 30,
  notes: 'Ask about water',
  checked: [0, 2],
});
test('tour plans roundtrip independently; missing storage is empty', () => {
  expect(parseTours(null)).toEqual([]);
  const t = tour();
  const loaded = parseTours(JSON.stringify([t]));
  expect(loaded).toEqual([t]);
  loaded[0].checked.push(4);
  expect(t.checked).toEqual([0, 2]);
});
test('corrupt or oversized plans fail closed', () => {
  for (const bad of [
    null,
    {},
    [tour(), tour()],
    [{ ...tour(), minutes: 0 }],
    [{ ...tour(), minutes: 241 }],
    [{ ...tour(), minutes: 2.5 }],
    [{ ...tour(), startsAt: 'tomorrow' }],
    [{ ...tour(), checked: [6] }],
    [{ ...tour(), checked: [0, 0] }],
    [{ ...tour(), notes: 'x'.repeat(2001) }],
    [{ ...tour(), address: 'x\nATTENDEE:evil' }],
    Array.from({ length: MAX_TOURS + 1 }, (_, i) => tour('t' + i)),
  ])
    expect(() => validateTours(bad)).toThrow();
  expect(() => parseTours('{')).toThrow();
});
test('calendar input rejects normalization of invalid dates and times', () => {
  for (const [d, t] of [
    ['2026-02-30', '10:00'],
    ['2026-13-01', '10:00'],
    ['2026-11-01', '24:00'],
    ['2026-11-01', '12:60'],
    ['26-11-01', '12:00'],
  ])
    expect(() => localTourStart(d, t)).toThrow();
  const result = new Date(localTourStart('2026-12-05', '14:30'));
  expect(result.getFullYear()).toBe(2026);
  expect(result.getHours()).toBe(14);
});
test('route order is explicit and never silently omits stops', () => {
  const tours = [tour(), tour('two'), tour('three')];
  expect(moveTour(tours, 'one', -1)).toEqual(tours);
  expect(moveTour(tours, 'one', 1).map((t) => t.id)).toEqual(['two', 'one', 'three']);
  expect(tours[0].id).toBe('one');
  expect(moveTour(tours, 'missing', 1)).toEqual(tours);
  expect(tourRoute([tour()])).toBeNull();
  expect(tourRoute([{ ...tour(), address: 'A|B' }, tour('two')])).toBeNull();
  expect(tourRoute([{ ...tour(), address: '🏡'.repeat(1000) }, tour('two')])).toBeNull();
  expect(tourRoute(Array.from({ length: 6 }, (_, i) => tour('t' + i)))).toBeNull();
  const url = new URL(tourRoute(tours)!);
  expect(url.searchParams.get('origin')).toBe(tours[0].address);
  expect(url.searchParams.get('waypoints')).toBe(tours[1].address);
  expect(url.searchParams.get('travelmode')).toBe('walking');
});
test('chronological order and overlap warnings do not invent travel feasibility', () => {
  const a = tour(),
    b = tour('two', '2026-12-05T19:15:00.000Z'),
    c = tour('three', '2026-12-05T19:45:00.000Z');
  expect(chronologicalTours([c, b, a]).map((t) => t.id)).toEqual(['one', 'two', 'three']);
  expect([...overlappingTourIds([a, b, c])].sort()).toEqual(['one', 'two']);
});
test('calendar export uses UTC, stable UID, escaped text, no invitations and folded UTF8', () => {
  const t = { ...tour(), notes: 'hello; comma, slash\\\nBEGIN:VEVENT\n' + '🏡'.repeat(100) };
  const raw = exportTours([t], new Date('2026-11-17T10:00:00Z'));
  const unfolded = raw.replace(/\r\n /g, '');
  expect(unfolded).toContain('DTSTART:20261205T190000Z');
  expect(unfolded).toContain('DTEND:20261205T193000Z');
  expect(unfolded).toContain('UID:one@apartment-search.local');
  expect(unfolded).toContain('hello\\; comma\\, slash\\\\\\nBEGIN:VEVENT\\n');
  expect(raw).not.toContain('ATTENDEE:');
  expect(raw).not.toContain('METHOD:REQUEST');
  expect(unfolded.match(/\r\nBEGIN:VEVENT\r\n/g)?.length).toBe(1);
  for (const line of raw.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
});

test('route day selection preserves plan and order without deleting other days', () => {
  const a = tour(),
    b = tour('two', '2026-12-06T19:00:00.000Z'),
    c = tour('three');
  const plan = [c, b, a];
  expect(toursOnDay(plan, tourDay(a)).map((t) => t.id)).toEqual(['three', 'one']);
  expect(plan.length).toBe(3);
  expect(toursOnDay(plan, '2026-12-09')).toEqual([]);
});

test('a tour day shows the walk between stops, tours too close together, and a shorter order', async () => {
  const { walkingPlan } = await import('../src/tour-planner.ts');
  const tour = (id: string, at: string, minutes = 30) => ({
    id,
    listingKey: id,
    address: id + ' Street',
    startsAt: at,
    minutes,
    notes: '',
    checked: [],
  });
  // A and C are near each other; B is about a mile north.
  const places = new Map([
    ['a', { latitude: 40.73, longitude: -74.0 }],
    ['b', { latitude: 40.745, longitude: -74.0 }],
    ['c', { latitude: 40.731, longitude: -74.0 }],
  ]);
  const plan = walkingPlan(
    [
      tour('a', '2026-12-01T15:00:00Z'),
      tour('b', '2026-12-01T15:35:00Z'),
      tour('c', '2026-12-01T17:00:00Z'),
      tour('x', '2026-12-01T18:00:00Z'),
    ],
    places,
  );
  expect(plan.unlocated).toBe(1);
  expect(plan.legs.map(({ minutes, tight }) => ({ minutes, tight }))).toEqual([
    { minutes: 27, tight: true },
    { minutes: 25, tight: false },
  ]);
  expect(plan.totalMinutes).toBe(52);
  expect(plan.suggestion).toEqual({ order: ['a Street', 'c Street', 'b Street'], saves: 25 });
  expect(walkingPlan([tour('a', '2026-12-01T15:00:00Z')], places)).toEqual({ legs: [], totalMinutes: 0, unlocated: 0, suggestion: null });
});
