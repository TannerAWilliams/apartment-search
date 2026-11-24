import { isRecord, type Loose } from './domain.ts';
export const TOUR_KEY = 'apartment-search:tours:v1';
export const MAX_TOURS = 30;
export const TOUR_CHECKLIST = [
  'Water pressure and hot water',
  'Noise and natural light',
  'Phone signal and outlets',
  'Windows, locks and pests',
  'Laundry and building access',
  'Confirm rent, fees and lease terms',
] as const;
export type Tour = { id: string; listingKey: string; address: string; startsAt: string; minutes: number; notes: string; checked: number[] };
const plain = (s: unknown, max: number): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
const checklistItem = (i: unknown): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < TOUR_CHECKLIST.length;
export function validateTours(value: unknown): Tour[] {
  if (!Array.isArray(value) || value.length > MAX_TOURS) throw Error('Tour plan is invalid or too large.');
  const ids = new Set<string>();
  return value.map((entry) => {
    const { id, listingKey, address, startsAt, minutes, notes, checked }: Loose<Tour> = isRecord(entry) ? entry : {};
    if (
      !plain(id, 200) ||
      ids.has(id) ||
      !plain(listingKey, 2000) ||
      !plain(address, 1000) ||
      typeof startsAt !== 'string' ||
      !Number.isFinite(Date.parse(startsAt)) ||
      new Date(startsAt).toISOString() !== startsAt ||
      typeof minutes !== 'number' ||
      !Number.isInteger(minutes) ||
      minutes < 5 ||
      minutes > 240 ||
      typeof notes !== 'string' ||
      notes.length > 2000 ||
      !Array.isArray(checked) ||
      !checked.every(checklistItem) ||
      new Set(checked).size !== checked.length
    )
      throw Error('Stored tour plan is invalid. It has not been overwritten.');
    ids.add(id);
    return { id, listingKey, address, startsAt, minutes, notes, checked: [...checked] };
  });
}
export function parseTours(raw: string | null): Tour[] {
  return raw === null ? [] : validateTours(JSON.parse(raw));
}
// Inputs are interpreted in the device timezone, then persisted as an absolute instant.
export function localTourStart(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw Error('Enter date YYYY-MM-DD and time HH:mm (24-hour).');
  const [y, m, d] = date.split('-').map(Number),
    [h, min] = time.split(':').map(Number);
  const value = new Date(y, m - 1, d, h, min);
  if (
    y < 2000 ||
    y > 2100 ||
    value.getFullYear() !== y ||
    value.getMonth() !== m - 1 ||
    value.getDate() !== d ||
    value.getHours() !== h ||
    value.getMinutes() !== min
  )
    throw Error('Enter a valid date and time. This time may not exist during a clock change.');
  return value.toISOString();
}
export function moveTour(tours: Tour[], id: string, delta: -1 | 1): Tour[] {
  const next = [...tours],
    index = next.findIndex((t) => t.id === id),
    to = index + delta;
  if (index < 0 || to < 0 || to >= next.length) return next;
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
export function chronologicalTours(tours: Tour[]) {
  return [...tours].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
export function overlappingTourIds(tours: Tour[]): Set<string> {
  const ids = new Set<string>();
  for (const a of tours)
    for (const b of tours)
      if (
        a.id !== b.id &&
        Date.parse(a.startsAt) < Date.parse(b.startsAt) + b.minutes * 60000 &&
        Date.parse(b.startsAt) < Date.parse(a.startsAt) + a.minutes * 60000
      ) {
        ids.add(a.id);
        ids.add(b.id);
      }
  return ids;
}
export function tourDay(tour: Tour): string {
  const date = new Date(tour.startsAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function toursOnDay(tours: Tour[], day: string): Tour[] {
  return tours.filter((t) => tourDay(t) === day);
}
export function tourRoute(tours: Tour[]): string | null {
  // Mobile Google Maps supports at most three waypoints. Never silently omit stops.
  if (tours.length < 2 || tours.length > 5 || tours.some((t) => t.address.includes('|'))) return null;
  const p = new URLSearchParams({ api: '1', origin: tours[0].address, destination: tours.at(-1)!.address, travelmode: 'walking' });
  if (tours.length > 2)
    p.set(
      'waypoints',
      tours
        .slice(1, -1)
        .map((t) => t.address)
        .join('|'),
    );
  const url = 'https://www.google.com/maps/dir/?' + p;
  return url.length <= 2048 ? url : null;
}
const escapeICS = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
const stamp = (s: string) =>
  new Date(s)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
// RFC5545 lines fold at 75 UTF-8 octets, without splitting Unicode codepoints.
function fold(line: string): string {
  let result = '',
    part = '',
    bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > 75) {
      result += part + '\r\n';
      part = ' ';
      bytes = 1;
    }
    part += ch;
    bytes += n;
  }
  return result + part;
}
export function exportTours(tours: Tour[], now = new Date()): string {
  const valid = validateTours(tours);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Walkup//Tour Plan//EN', 'CALSCALE:GREGORIAN'];
  for (const t of valid)
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + encodeURIComponent(t.id) + '@apartment-search.local',
      'DTSTAMP:' + stamp(now.toISOString()),
      'DTSTART:' + stamp(t.startsAt),
      'DTEND:' + stamp(new Date(Date.parse(t.startsAt) + t.minutes * 60000).toISOString()),
      'SUMMARY:' + escapeICS('Apartment tour: ' + t.address),
      'LOCATION:' + escapeICS(t.address),
      'DESCRIPTION:' +
        escapeICS(
          'Personal plan only; confirm appointment with the listing contact.\n' +
            t.notes +
            '\nChecklist:\n' +
            TOUR_CHECKLIST.map((item, i) => (t.checked.includes(i) ? '[x] ' : '[ ] ') + item).join('\n'),
        ),
      'STATUS:TENTATIVE',
      'END:VEVENT',
    );
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Walking pace for planning: about 3 miles an hour, with streets a third longer than a straight line. */
const WALK_MINUTES_PER_MILE = 20;
const STREET_FACTOR = 1.3;
type Located = { latitude: number; longitude: number };

function miles(from: Located, to: Located) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(to.latitude - from.latitude) / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(radians(to.longitude - from.longitude) / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) * STREET_FACTOR;
}
const walkMinutes = (from: Located, to: Located) => Math.max(1, Math.round(miles(from, to) * WALK_MINUTES_PER_MILE));

/**
 * One day's tours as a walk: the minutes between each stop and the next, stops that start before you could walk
 * there from the last one, and a shorter order when one saves at least five minutes. `places` gives each tour's
 * point by its listing key; a stop without one is left out of the times.
 */
export function walkingPlan(tours: Tour[], places: Map<string, Located>) {
  const located = tours.filter((tour) => places.has(tour.listingKey));
  const legs = located.slice(1).map((tour, index) => {
    const previous = located[index];
    const walk = walkMinutes(places.get(previous.listingKey)!, places.get(tour.listingKey)!);
    const free = (Date.parse(tour.startsAt) - (Date.parse(previous.startsAt) + previous.minutes * 60_000)) / 60_000;
    return { from: previous.address, to: tour.address, minutes: walk, tight: free < walk };
  });
  const total = (order: Tour[]) =>
    order.slice(1).reduce((sum, tour, index) => sum + walkMinutes(places.get(order[index].listingKey)!, places.get(tour.listingKey)!), 0);
  // Nearest stop next, from the first one.
  const shorter = located.slice(0, 1);
  const rest = located.slice(1);
  while (rest.length) {
    const here = places.get(shorter[shorter.length - 1].listingKey)!;
    rest.sort((a, b) => walkMinutes(here, places.get(a.listingKey)!) - walkMinutes(here, places.get(b.listingKey)!));
    shorter.push(rest.shift()!);
  }
  const saving = total(located) - total(shorter);
  return {
    legs,
    totalMinutes: total(located),
    unlocated: tours.length - located.length,
    suggestion: saving >= 5 ? { order: shorter.map(({ address }) => address), saves: saving } : null,
  };
}
