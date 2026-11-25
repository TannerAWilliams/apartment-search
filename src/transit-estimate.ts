/**
 * A door-to-door transit time worked out here, with no routing service: the walk to a nearby station, the wait,
 * the ride on one line (or two, with a transfer at a station where both stop) to a station near the destination,
 * and the walk from it. It uses the subway and PATH stations the app keeps and straight-line distances, so it is
 * an estimate, usually within about ten minutes of a trip planner's; walking alone counts when it is quicker and
 * under half an hour.
 *
 * The time from every station to the destination is worked out once per destination; each listing then only
 * looks at the stations around it.
 */
import type { Station } from './subway.ts';

type Point = { latitude: number; longitude: number };

/** Walking along streets: 3 miles an hour, 1.3 times the straight line. */
const WALK_MINUTES_PER_MILE = 20;
const STREET_FACTOR = 1.3;
/** Trains average about 17 miles an hour between stations, stops included, on tracks 1.25 times the straight line. */
const RIDE_MINUTES_PER_MILE = 60 / 17;
const TRACK_FACTOR = 1.25;
/** Half the usual daytime gap between trains, for the first train and for a transfer (with the walk between). */
const FIRST_WAIT = 4;
const TRANSFER = 6;
/** Stations this close count as one for a transfer (34 St-Herald Sq and 33rd St PATH). */
const TRANSFER_MILES = 0.2;
/** How far anyone walks to or from a station. */
const MAX_WALK_MILES = 1.2;
/** Beyond this the trip is not counted as a transit commute. */
const MAX_MINUTES = 120;
/** Walking alone counts only up to this; a longer walk with no train found means the stations are unknown. */
const MAX_WALK_ONLY = 30;

export function miles(a: Point, b: Point) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
const walk = (a: Point, b: Point) => miles(a, b) * STREET_FACTOR * WALK_MINUTES_PER_MILE;
const ride = (a: Point, b: Point) => miles(a, b) * TRACK_FACTOR * RIDE_MINUTES_PER_MILE;

/**
 * A function from a home to its estimated transit minutes to `destination`, or null when no train route is found
 * and walking takes over half an hour, or the trip takes over two hours.
 */
export function transitEstimator(stations: Station[], destination: Point) {
  // The lines at each station, with those at stations close enough to transfer to.
  const linesAt = stations.map((station) => {
    const lines = new Set(station.routes);
    for (const other of stations)
      if (other !== station && miles(station, other) <= TRANSFER_MILES) for (const line of other.routes) lines.add(line);
    return lines;
  });
  const ends = stations.flatMap((station, index) =>
    miles(station, destination) <= MAX_WALK_MILES ? [{ index, walk: walk(station, destination) }] : [],
  );
  // From each station to the destination: ride one line to a station near it, or two with one transfer.
  const fromStation = stations.map((station, index) => {
    let best = Infinity;
    for (const end of ends) {
      const target = stations[end.index]!;
      if (station.routes.some((line) => target.routes.includes(line))) best = Math.min(best, ride(station, target) + end.walk);
    }
    return { index, direct: best };
  });
  // A transfer: ride a line from this station to a station whose lines reach the destination directly.
  const reachable = fromStation.filter(({ direct }) => direct < Infinity);
  const toDestination = stations.map((station, index) => {
    let best = fromStation[index]!.direct;
    for (const { index: via, direct } of reachable) {
      if (via === index) continue;
      const hub = stations[via]!;
      if (station.routes.some((line) => linesAt[via]!.has(line))) best = Math.min(best, ride(station, hub) + TRANSFER + direct);
    }
    return best;
  });

  return (home: Point | null | undefined) => {
    if (!home || !Number.isFinite(home.latitude) || !Number.isFinite(home.longitude)) return null;
    const walking = walk(home, destination);
    let best = walking <= MAX_WALK_ONLY ? walking : Infinity;
    stations.forEach((station, index) => {
      const onward = toDestination[index]!;
      // A quick box first (about 1.4 miles of latitude and longitude), so each home measures only stations near it.
      if (onward === Infinity || Math.abs(station.latitude - home.latitude) > 0.02 || Math.abs(station.longitude - home.longitude) > 0.027)
        return;
      const toStation = miles(home, station);
      if (toStation <= MAX_WALK_MILES) best = Math.min(best, walk(home, station) + FIRST_WAIT + onward);
    });
    return best <= MAX_MINUTES ? Math.max(1, Math.round(best)) : null;
  };
}
