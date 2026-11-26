/**
 * Neighborhoods as places on a map, for choosing them by sight: where each named neighborhood's apartments are,
 * which of the city's outlined areas (public/maps/nyc-neighborhoods.json) each falls in, and which part of
 * Manhattan (downtown, midtown, uptown) it belongs to.
 */
export type Shape = { name: string; borough: string; rings: number[][] };
export type Spot = { latitude: number; longitude: number };
/** One outlined area as the map draws it: the neighborhood names inside it, and whether they are all chosen. */
export type MapArea = { key: string; label: string; names: string[]; rings: number[][]; selected: boolean };

/** The middle of each neighborhood's apartments, by the neighborhood's name. */
export function neighborhoodSpots(listings: { neighborhood?: string; latitude?: number | null; longitude?: number | null }[]) {
  const sums = new Map<string, [number, number, number]>();
  for (const { neighborhood, latitude, longitude } of listings) {
    if (!neighborhood || typeof latitude !== 'number' || typeof longitude !== 'number') continue;
    const sum = sums.get(neighborhood) ?? [0, 0, 0];
    sum[0] += latitude;
    sum[1] += longitude;
    sum[2] += 1;
    sums.set(neighborhood, sum);
  }
  return Object.fromEntries(
    [...sums].map(([name, [latitude, longitude, count]]) => [name, { latitude: latitude / count, longitude: longitude / count }]),
  );
}

/** Whether a ring (latitude, longitude, latitude, longitude…) surrounds the spot. */
function surrounds(ring: number[], { latitude, longitude }: Spot) {
  let inside = false;
  for (let at = 0, before = ring.length - 2; at < ring.length; before = at, at += 2) {
    const [y1, x1, y2, x2] = [ring[at]!, ring[at + 1]!, ring[before]!, ring[before + 1]!];
    if (y1 > latitude !== y2 > latitude && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** The outlined areas that hold at least one of the named neighborhoods, each with the names inside it. */
export function mapAreas(shapes: Shape[], names: string[], spots: Record<string, Spot>, picked: string[]): MapArea[] {
  const located = names.flatMap((name) => (spots[name] ? [{ name, spot: spots[name] }] : []));
  return shapes.flatMap(({ name, rings }) => {
    const inside = located.filter(({ spot }) => rings.some((ring) => surrounds(ring, spot))).map((entry) => entry.name);
    if (inside.length === 0) return [];
    return [{ key: name, label: inside.join(', '), names: inside, rings, selected: inside.every((entry) => picked.includes(entry)) }];
  });
}

/** The area drawn at this spot on the map, if any. */
export const areaAt = (areas: MapArea[], spot: Spot) => areas.find(({ rings }) => rings.some((ring) => surrounds(ring, spot)));

/** Choosing an area on the map: all its neighborhoods join the chosen ones, or leave when they were all chosen. */
export function toggleNames(picked: string[], names: string[]) {
  return names.every((name) => picked.includes(name))
    ? picked.filter((name) => !names.includes(name))
    : [...new Set([...picked, ...names])];
}

export const MANHATTAN_PARTS = [
  ['downtown', 'Downtown'],
  ['midtown', 'Midtown'],
  ['uptown', 'Uptown'],
] as const;
export type ManhattanPart = (typeof MANHATTAN_PARTS)[number][0];

// Manhattan's streets run about 29° off east–west. How far up the island a spot is, in kilometers from 14th Street
// at Fifth Avenue; 59th Street is 3.6 km on.
const TILT = (29 * Math.PI) / 180;
const [FOURTEENTH, FIFTY_NINTH] = [0, 3.6];
const upIsland = ({ latitude, longitude }: Spot) =>
  (latitude - 40.7359) * 111.2 * Math.cos(TILT) + (longitude + 73.9911) * 84.2 * Math.sin(TILT);

/** Downtown is below 14th Street, midtown from there to 59th, uptown above. */
export const manhattanPart = (spot: Spot): ManhattanPart =>
  upIsland(spot) < FOURTEENTH ? 'downtown' : upIsland(spot) < FIFTY_NINTH ? 'midtown' : 'uptown';
