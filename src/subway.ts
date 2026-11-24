/**
 * Subway stations near a listing: the closest stations within a short walk, and the lines that stop there in the
 * daytime. Stations are put in a grid of about a kilometer so each listing checks only the stations around it.
 */
/** `accessible`: the MTA marks the station fully accessible (step-free, with elevators). */
export type Station = { name: string; routes: string[]; latitude: number; longitude: number; accessible?: boolean };
export type NearbySubway = { station: string; routes: string[]; minutes: number; accessible?: boolean };

/** Every daytime line, in the MTA's order. */
export const SUBWAY_LINES = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  'A',
  'C',
  'E',
  'B',
  'D',
  'F',
  'M',
  'G',
  'J',
  'Z',
  'L',
  'N',
  'Q',
  'R',
  'W',
  'S',
];
/** Stations within this walk count as near. */
export const NEAR_MINUTES = 10;
const CELL = 0.01;
const WALK_MINUTES_PER_MILE = 20;
const STREET_FACTOR = 1.3;

function walkMinutes(latitude: number, longitude: number, station: Station) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(station.latitude - latitude) / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(station.latitude)) * Math.sin(radians(station.longitude - longitude) / 2) ** 2;
  const miles = 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) * STREET_FACTOR;
  return Math.max(1, Math.round(miles * WALK_MINUTES_PER_MILE));
}

const cellOf = (latitude: number, longitude: number) => `${Math.floor(latitude / CELL)}|${Math.floor(longitude / CELL)}`;

/** A lookup of the stations near a point. */
export function stationIndex(stations: Station[]) {
  const grid = new Map<string, Station[]>();
  for (const station of stations) {
    const cell = cellOf(station.latitude, station.longitude);
    grid.set(cell, [...(grid.get(cell) ?? []), station]);
  }
  /** Stations within a ten-minute walk, the closest first, one entry per station name. */
  return (latitude: number | null | undefined, longitude: number | null | undefined): NearbySubway[] => {
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude))
      return [];
    const row = Math.floor(latitude / CELL);
    const column = Math.floor(longitude / CELL);
    const found = new Map<string, NearbySubway>();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const station of grid.get(`${row + dy}|${column + dx}`) ?? []) {
          const minutes = walkMinutes(latitude, longitude, station);
          if (minutes > NEAR_MINUTES) continue;
          const known = found.get(station.name);
          if (!known || minutes < known.minutes)
            found.set(station.name, {
              station: station.name,
              routes: [...station.routes],
              minutes,
              ...(station.accessible ? { accessible: true } : {}),
            });
          else if (minutes === known.minutes) {
            known.routes = [...new Set([...known.routes, ...station.routes])];
            if (station.accessible) known.accessible = true;
          }
        }
    return [...found.values()].sort((a, b) => a.minutes - b.minutes || a.station.localeCompare(b.station)).slice(0, 3);
  };
}

/** The lines within a ten-minute walk, in the MTA's order. */
export const nearbyLines = (nearby: NearbySubway[] | undefined) =>
  SUBWAY_LINES.filter((line) => (nearby ?? []).some(({ routes }) => routes.includes(line)));
