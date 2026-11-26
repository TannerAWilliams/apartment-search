/**
 * Writes public/maps/nyc-neighborhoods.json: the outlines of New York City's neighborhoods, small enough to draw
 * on the alert form's map. They are the city's 2020 Neighborhood Tabulation Areas (NYC Open Data, dataset
 * 9nt8-h7nd), without parks, airports and cemeteries, with each outline thinned to about 20 meters.
 *
 *   bun scripts/make-neighborhood-shapes.ts [path to a downloaded .geojson]
 */
const SOURCE = 'https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=500';
const TOLERANCE = 0.0002;
const SMALLEST_RING = 12;

type Position = [number, number];
type Feature = {
  properties: { ntaname: string; boroname: string; ntatype: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Position[][] | Position[][][] };
};

/** Douglas–Peucker: the points of a line that matter at this tolerance. */
function thin(points: Position[]): Position[] {
  if (points.length < 3) return points;
  const [first, last] = [points[0]!, points.at(-1)!];
  let far = 0;
  let index = 0;
  for (let at = 1; at < points.length - 1; at++) {
    const [x, y] = points[at]!;
    const [dx, dy] = [last[0] - first[0], last[1] - first[1]];
    const length = Math.hypot(dx, dy);
    const distance = length
      ? Math.abs(dy * x - dx * y + last[0] * first[1] - last[1] * first[0]) / length
      : Math.hypot(x - first[0], y - first[1]);
    if (distance > far) [far, index] = [distance, at];
  }
  if (far <= TOLERANCE) return [first, last];
  return [...thin(points.slice(0, index + 1)).slice(0, -1), ...thin(points.slice(index))];
}

const path = process.argv[2];
const data = (path ? await Bun.file(path).json() : await (await fetch(SOURCE)).json()) as { features: Feature[] };
const shapes = data.features
  .filter(({ properties }) => properties.ntatype === '0')
  .map(({ properties, geometry }) => {
    const polygons = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as Position[][][];
    return {
      name: properties.ntaname,
      borough: properties.boroname,
      // Outer rings only, each as latitude, longitude, latitude, longitude…
      rings: polygons
        .map(([outer]) => outer!)
        .filter((ring) => ring.length >= SMALLEST_RING)
        .map((ring) => {
          const half = Math.floor(ring.length / 2);
          // A closed ring is thinned as two lines, so its start and end are both kept.
          const kept = [...thin(ring.slice(0, half + 1)).slice(0, -1), ...thin(ring.slice(half))];
          return kept.flatMap(([longitude, latitude]) => [Math.round(latitude * 1e4) / 1e4, Math.round(longitude * 1e4) / 1e4]);
        })
        .filter((ring) => ring.length >= 8),
    };
  })
  .filter(({ rings }) => rings.length > 0)
  .sort((a, b) => a.borough.localeCompare(b.borough) || a.name.localeCompare(b.name));
await Bun.write('public/maps/nyc-neighborhoods.json', JSON.stringify(shapes));
console.log(`${shapes.length} neighborhoods, ${JSON.stringify(shapes).length.toLocaleString()} bytes`);
