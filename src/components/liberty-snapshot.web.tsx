/**
 * Card thumbnails in OpenFreeMap's Liberty style. A browser allows only a few live maps (each needs its own WebGL
 * canvas), so one hidden map draws every card's picture in turn and hands each back as an image, kept for the
 * session. When the style cannot be drawn (no WebGL, or the style does not load) every request fails at once and
 * the card shows OpenStreetMap's street tiles instead.
 */
import type { Map as LibreMap } from 'maplibre-gl';

const LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';
/** About two blocks around the apartment on a card. */
const ZOOM = 15.6;

let renderer: Promise<{ map: LibreMap; box: HTMLDivElement }> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const done = new Map<string, Promise<string>>();

function start() {
  renderer ??= import('maplibre-gl').then(
    ({ default: maplibregl }) =>
      new Promise((resolve, reject) => {
        const box = document.createElement('div');
        Object.assign(box.style, { position: 'fixed', left: '-10000px', top: '0', width: '400px', height: '240px' });
        document.body.append(box);
        try {
          const map = new maplibregl.Map({
            container: box,
            style: LIBERTY,
            interactive: false,
            attributionControl: false,
            center: [-73.98, 40.75],
            zoom: ZOOM,
            // Kept after each frame, so the picture can be read back as an image.
            canvasContextAttributes: { preserveDrawingBuffer: true },
            fadeDuration: 0,
          });
          map.once('load', () => resolve({ map, box }));
          map.once('error', () => reject(new Error('The map style did not load.')));
        } catch (error) {
          reject(error);
        }
      }),
  );
  return renderer;
}

/** A Liberty picture of the streets around a point, `width` by `height`, as an image address. */
export function libertySnapshot(latitude: number, longitude: number, width: number, height: number): Promise<string> {
  const w = Math.round(width);
  const h = Math.round(height);
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)},${w}x${h}`;
  const known = done.get(key);
  if (known) return known;
  const picture = start().then(({ map, box }) => {
    // One at a time: the hidden map moves to each place, waits for its streets to draw, and is read back.
    const next = queue.then(
      () =>
        new Promise<string>((resolve) => {
          box.style.width = `${w}px`;
          box.style.height = `${h}px`;
          map.resize();
          map.jumpTo({ center: [longitude, latitude], zoom: ZOOM });
          map.once('idle', () => resolve(map.getCanvas().toDataURL('image/jpeg', 0.85)));
        }),
    );
    queue = next.catch(() => {});
    return next;
  });
  done.set(key, picture);
  picture.catch(() => done.delete(key));
  return picture;
}
