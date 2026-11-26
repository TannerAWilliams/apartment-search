import type { MapPoint } from '../domain.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';

declare module 'leaflet' {
  interface MarkerOptions {
    listingCount?: number;
  }
}
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
// For the card thumbnails (liberty-snapshot.web.tsx), which load MapLibre through this file: a library that two
// lazily loaded files import is bundled into the code every visitor downloads first.
// biome-ignore lint/performance/noBarrelFile: deliberate, so MapLibre stays in this lazily loaded file (see above)
export { default as maplibregl } from 'maplibre-gl';
import { safeListingUrl } from '../marketplaces.ts';
import { bedroomLabel, formatRent } from '../search.ts';
import { colors } from '../styles.ts';
import { type MapArea, areaAt } from '../neighborhood-areas.ts';
// The map and its pictures keep their own light colors in either theme.
import { palette } from '../palette.ts';

const center = [40.75, -73.98];

/** The transit layer's kinds of stop, their color and name in the legend. */
const TRANSIT = {
  subway: ['#0039a6', 'Subway'],
  path: ['#d0103a', 'PATH'],
  njt: ['#f18a00', 'NJ Transit'],
  'light-rail': ['#7b4fa3', 'Light rail'],
  'metro-north': ['#00843d', 'Metro-North'],
} as const;
type TransitKind = keyof typeof TRANSIT;
type TransitStop = { name: string; kind: TransitKind; detail: string; latitude: number; longitude: number };
type TransitResponse = {
  subway?: { name: string; routes: string[]; latitude: number; longitude: number }[];
  rail?: { name: string; system: Exclude<TransitKind, 'subway'>; line: string; latitude: number; longitude: number }[];
};

let transitRequest: Promise<TransitStop[]> | null = null;
/** Every subway, PATH, NJ Transit and Metro-North stop, fetched once per page (the server lets the browser keep it a day). */
function transitStops() {
  transitRequest ??= fetch('/api/transit')
    .then((response) => (response.ok ? (response.json() as Promise<TransitResponse>) : { subway: [], rail: [] }))
    .then(({ subway = [], rail = [] }) => [
      ...subway.map(({ name, routes, latitude, longitude }) => ({
        name,
        kind: 'subway' as const,
        detail: routes.join(' '),
        latitude,
        longitude,
      })),
      ...rail.map(({ name, system, line, latitude, longitude }) => ({
        name,
        kind: system,
        detail: system === 'path' || system === 'metro-north' ? '' : line,
        latitude,
        longitude,
      })),
    ])
    .catch(() => {
      transitRequest = null;
      return [];
    });
  return transitRequest;
}

/** Several homes too close to tell apart at this zoom: a small pill, "12 homes", that zooms in when tapped. */
function pinIcon(count: number) {
  const pill = document.createElement('span');
  const label = count === 1 ? '1 home' : `${count.toLocaleString()} homes`;
  Object.assign(pill.style, {
    background: colors.ink,
    color: colors.surface,
    border: '2px solid white',
    borderRadius: '999px',
    padding: '3px 9px',
    fontSize: '12px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
    display: 'block',
    textAlign: 'center',
    boxSizing: 'border-box',
    lineHeight: '16px',
  });
  pill.textContent = label;
  const width = label.length * 7 + 22;
  return L.divIcon({ className: '', html: pill, iconSize: [width, 26], iconAnchor: [width / 2, 13] });
}

/** A rent on the map, as listing apps label pins: "$2,450", or "3 from $2,450" for several at one address. */
function pricePin(listings: MapPoint[]) {
  const rents = listings.map(({ rent }) => rent).filter((rent) => rent > 0);
  if (!rents.length) return pinIcon(listings.length);
  const low = formatRent(Math.min(...rents));
  const label = listings.length > 1 ? `${listings.length} from ${low}` : low;
  const pill = document.createElement('span');
  Object.assign(pill.style, {
    background: colors.surface,
    color: colors.ink,
    border: `1px solid ${palette.gray[3]}`,
    borderRadius: '999px',
    padding: '4px 9px',
    fontSize: '13px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
    // A firmer edge and shadow than on a plain map, so rents stand out against Liberty's colors.
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    fontFamily: 'inherit',
    display: 'block',
    textAlign: 'center',
    boxSizing: 'border-box',
    lineHeight: '16px',
  });
  pill.textContent = label;
  // About how wide the label is, so the pill is centered on the spot and can be tapped.
  const width = label.length * 8 + 20;
  return L.divIcon({ className: '', html: pill, iconSize: [width, 26], iconAnchor: [width / 2, 13] });
}

function popupLink(url: unknown, label: string) {
  const href = safeListingUrl(url);
  if (!href) return null;
  const link = document.createElement('a');
  link.href = href;
  // Listings open in a new tab, so the map stays where it was.
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  return link;
}

type SaveActions = {
  save?: (point: MapPoint) => void;
  isSaved?: (point: MapPoint) => boolean;
  open?: (point: MapPoint) => void;
};

const BUTTON = {
  flex: '1',
  padding: '8px 10px',
  borderRadius: '8px',
  font: '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  cursor: 'pointer',
  textAlign: 'center',
  textDecoration: 'none',
  boxSizing: 'border-box',
  whiteSpace: 'nowrap',
} as const;

/** A Save button for one listing in a pop-up; it reads "Saved" once the listing is saved. */
function saveButton(point: MapPoint, { save, isSaved }: SaveActions) {
  if (!save) return null;
  const button = document.createElement('button');
  button.type = 'button';
  const show = (saved: boolean) => {
    button.textContent = saved ? '♥ Saved' : '♡ Save';
    button.disabled = saved;
    button.setAttribute('aria-label', (saved ? 'Saved: ' : 'Save ') + point.title);
    Object.assign(button.style, BUTTON, {
      border: `1px solid ${colors.ink}`,
      background: colors.surface,
      color: saved ? colors.accent : colors.ink,
      cursor: saved ? 'default' : 'pointer',
    });
  };
  show(isSaved?.(point) ?? false);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    save(point);
    show(true);
  });
  return button;
}

/**
 * A listing's pop-up, as a small card: the address, the rent and size, and two buttons: Save, and View, which
 * opens the apartment's own page here (or the listing site when there is no page to open).
 */
function popupContent(listings: MapPoint[], actions: SaveActions) {
  const content = document.createElement('div');
  Object.assign(content.style, {
    maxHeight: '300px',
    overflowY: 'auto',
    minWidth: '240px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  });
  listings.forEach((point, index) => {
    const { title, rent, bedrooms, kind, url, transitSeconds } = point;
    const baths = (point as { bathrooms?: number }).bathrooms;
    const row = document.createElement('div');
    Object.assign(row.style, {
      padding: '4px 0 10px',
      borderTop: index ? `1px solid ${colors.border}` : 'none',
      paddingTop: index ? '10px' : '4px',
    });
    const price = document.createElement('div');
    Object.assign(price.style, { fontSize: '17px', fontWeight: '700', color: colors.ink });
    price.textContent = formatRent(rent) + ' a month';
    const heading = document.createElement('div');
    Object.assign(heading.style, { fontSize: '14px', fontWeight: '600', color: colors.ink, marginTop: '2px' });
    heading.textContent = title;
    const detail = document.createElement('div');
    Object.assign(detail.style, { fontSize: '13px', color: colors.muted, marginTop: '2px' });
    const status = ({ snapshot: 'Dated listing', cached: 'Last saved result' } as Record<string, string>)[kind];
    detail.textContent = [
      bedroomLabel(bedrooms),
      baths ? `${baths} ${baths === 1 ? 'bath' : 'baths'}` : null,
      status,
      transitSeconds == null ? null : `${Math.ceil(transitSeconds / 60)} min transit`,
    ]
      .filter(Boolean)
      .join(' · ');
    const buttons = document.createElement('div');
    Object.assign(buttons.style, { display: 'flex', gap: '8px', marginTop: '10px' });
    const save = saveButton(point, actions);
    if (save) buttons.append(save);
    const view = actions.open ? document.createElement('button') : popupLink(url, 'View listing ↗');
    if (view) {
      if (view instanceof HTMLButtonElement) {
        view.type = 'button';
        view.textContent = 'View apartment';
        view.addEventListener('click', (event) => {
          event.stopPropagation();
          actions.open?.(point);
        });
      }
      Object.assign(view.style, BUTTON, { border: `1px solid ${colors.primary}`, background: colors.primary, color: colors.surface });
      buttons.append(view);
    }
    row.append(price, heading, detail, buttons);
    content.append(row);
  });
  return content;
}

// Leaflet draws a pop-up as a white card whatever the theme, and the card's text is the theme's ink: in the dark
// theme that was near-white text on white. The card takes the theme's surface, so its text is always readable.
if (typeof document !== 'undefined' && !document.getElementById('walkup-map-popup')) {
  const sheet = document.createElement('style');
  sheet.id = 'walkup-map-popup';
  sheet.textContent =
    `.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:${colors.surface};color:${colors.ink}}` +
    `.leaflet-container a.leaflet-popup-close-button{color:${colors.muted}}`;
  document.head.append(sheet);
}

/** OpenFreeMap's Liberty map style. */
const LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';

/** What Leaflet keeps on a circle drawn on a canvas, which the small pin draws itself with. */
type CanvasCircle = L.CircleMarker & {
  _renderer: { _ctx: CanvasRenderingContext2D; _drawing: boolean; _fillStroke(context: CanvasRenderingContext2D, layer: L.Path): void };
  _point: L.Point;
  _radius: number;
  _pxBounds: L.Bounds;
  _empty(): boolean;
  _clickTolerance(): number;
};
/** How far above its spot the pin's round head is centered, in radii. */
const PIN_RISE = 1.9;
/**
 * A small map pin drawn on the canvas, its tip on the home's spot: thousands stay as quick as dots were, and a
 * pin reads as "a place" where a dot read as a mark. Leaflet draws only circles on a canvas, so the shape, the
 * area redrawn and the area that takes a tap are given here.
 */
const SmallPin = L.CircleMarker.extend({
  _updatePath(this: CanvasCircle) {
    const renderer = this._renderer;
    if (!renderer._drawing || this._empty()) return;
    const { x, y } = this._point;
    const radius = this._radius;
    const context = renderer._ctx;
    context.beginPath();
    // The head, from lower left over the top to lower right, then down to the tip.
    context.arc(x, y - radius * PIN_RISE, radius, Math.PI * 0.8, Math.PI * 0.2, false);
    context.lineTo(x, y);
    context.closePath();
    renderer._fillStroke(context, this);
  },
  _updateBounds(this: CanvasCircle) {
    const reach = this._radius + this._clickTolerance();
    this._pxBounds = L.bounds(this._point.subtract([reach, this._radius * PIN_RISE + reach]), this._point.add([reach, reach]));
  },
  _containsPoint(this: CanvasCircle, point: L.Point) {
    return point.distanceTo(this._point.subtract([0, this._radius * PIN_RISE])) <= this._radius * 1.4 + this._clickTolerance();
  },
}) as unknown as new (
  place: L.LatLngExpression,
  options: L.CircleMarkerOptions,
) => L.CircleMarker;

/** From this zoom (a few neighborhoods across) homes show their rents; further out, a small pin each. */
const PRICES_FROM_ZOOM = 14;

export function ListingMap({
  points,
  total,
  visible,
  onSave,
  isSaved,
  onOpen,
  areas,
  onArea,
}: {
  /** Outlined neighborhoods under the pins: shaded, darker when chosen, and chosen or cleared with a tap. */
  areas?: MapArea[];
  onArea?: (area: MapArea) => void;
  /** Opens a listing's own page from its pop-up. */
  onOpen?: (point: MapPoint) => void;
  points: MapPoint[];
  total: number;
  visible: boolean;
  onSave?: (point: MapPoint) => void;
  isSaved?: (point: MapPoint) => boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  // Pop-ups are built when opened, so they read the latest save state through this ref.
  const actions = useRef<SaveActions>({});
  actions.current = { save: onSave, isSaved, open: onOpen };
  // The map's taps and pointer read the latest areas through this ref.
  const shown = useRef({ areas, onArea });
  shown.current = { areas, onArea };
  // The areas' outlines are the same from one choice to the next; only their shading changes.
  const areaKeys = areas?.map(({ key }) => key).join('|') ?? '';
  const instance = useRef<{
    map: L.Map;
    clusters: L.MarkerClusterGroup;
    dots: L.LayerGroup;
    transit: L.LayerGroup;
    shading: L.LayerGroup;
  } | null>(null);
  const shaded = useRef(new Map<string, L.Polygon>());
  const [unavailable, setUnavailable] = useState(false);
  // Subway, PATH, NJ Transit and Metro-North stops under the pins, on by default and one tap to hide.
  const [transitShown, setTransitShown] = useState(true);
  const [transitCount, setTransitCount] = useState<number | null>(null);
  const locations = useMemo(() => {
    const grouped = new Map<string, MapPoint[]>();
    for (const point of points) {
      const key = `${point.latitude},${point.longitude}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(point);
    }
    return grouped;
  }, [points]);

  useEffect(() => {
    if (!visible || !container.current) return;
    const map = L.map(container.current, { scrollWheelZoom: false, maxZoom: 19 }).setView(center as L.LatLngTuple, 9);
    // OpenFreeMap's Liberty style (free, no key, commercial use allowed): sharp vector streets with parks, water
    // and highways in color. Where it cannot be drawn (no WebGL, or the style does not load), OpenStreetMap's own
    // street tiles instead.
    const streets = () => {
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        updateWhenIdle: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      tiles.on('tileerror', () => setUnavailable(true));
      tiles.on('tileload', () => setUnavailable(false));
    };
    let vector: L.MaplibreGL | null = null;
    try {
      vector = L.maplibreGL({ style: LIBERTY }).addTo(map);
      map.attributionControl.addAttribution(
        '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      );
      const gl = vector.getMaplibreMap();
      let loaded = false;
      gl.on('load', () => {
        loaded = true;
        setUnavailable(false);
      });
      // The style itself not loading means no map: the plain street tiles take over. A missing tile later does not.
      gl.on('error', () => {
        if (loaded || !vector) return;
        vector.remove();
        vector = null;
        streets();
      });
    } catch {
      vector = null;
      streets();
    }
    // Zoomed out: one small pin per home. Zoomed in: price pills, with "N homes" where several overlap.
    const clusters = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 36,
      iconCreateFunction: (cluster) =>
        pinIcon(cluster.getAllChildMarkers().reduce((sum, marker) => sum + (marker.options.listingCount ?? 0), 0)),
    });
    const dots = L.layerGroup();
    const showForZoom = () => {
      const close = map.getZoom() >= PRICES_FROM_ZOOM;
      if (close) {
        dots.remove();
        clusters.addTo(map);
      } else {
        clusters.remove();
        dots.addTo(map);
      }
    };
    map.on('zoomend', showForZoom);
    showForZoom();
    // Stops are drawn on a canvas below the pins, so hundreds of them stay quick.
    const transit = L.layerGroup().addTo(map);
    // Neighborhood shading sits under the stops and the pins.
    map.createPane('areas').style.zIndex = '350';
    const shading = L.layerGroup().addTo(map);
    // The pins and stops are drawn on sheets that cover the whole map, so a tap never reaches the shading under
    // them: the map itself works out which area was tapped or is under the pointer, and names it.
    const naming = L.tooltip({ direction: 'top', offset: [0, -6] });
    const under = (event: L.LeafletMouseEvent) =>
      shown.current.areas && areaAt(shown.current.areas, { latitude: event.latlng.lat, longitude: event.latlng.lng });
    map.on('click', (event) => {
      const area = under(event);
      if (area) shown.current.onArea?.(area);
    });
    map.on('mousemove', (event) => {
      const area = under(event);
      if (area) naming.setLatLng(event.latlng).setContent(area.label).addTo(map);
      else naming.remove();
    });
    map.on('mouseout', () => naming.remove());
    instance.current = { map, clusters, dots, transit, shading };
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      instance.current = null;
      map.remove();
    };
  }, [visible]);

  useEffect(() => {
    if (!instance.current) return;
    const { map, clusters, dots } = instance.current;
    clusters.clearLayers();
    dots.clearLayers();
    const dotRenderer = L.canvas({ padding: 0.5 });
    const pins = [];
    for (const [key, listings] of locations) {
      const coordinate = key.split(',').map(Number) as L.LatLngTuple;
      const title = listings.length === 1 ? listings[0].title : listings.length + ' listings at this location';
      pins.push(
        L.marker(coordinate, { icon: pricePin(listings), title, alt: title, listingCount: listings.length }).bindPopup(
          () => popupContent(listings, actions.current),
          { maxWidth: 280 },
        ),
      );
      new SmallPin(coordinate, {
        renderer: dotRenderer,
        radius: 5,
        color: '#ffffff',
        weight: 1.5,
        fillColor: colors.accent,
        fillOpacity: 0.9,
        // A tapped home opens its pop-up; it does not also choose the neighborhood under it.
        bubblingMouseEvents: false,
      })
        .bindPopup(() => popupContent(listings, actions.current), { maxWidth: 280 })
        .addTo(dots);
    }
    clusters.addLayers(pins);
    // With neighborhoods to choose, the map stays on them instead of jumping to each new set of matches.
    if (pins.length && !areaKeys)
      map.fitBounds(L.latLngBounds(pins.map((pin) => pin.getLatLng())), { padding: [32, 32], maxZoom: 15, animate: false });
  }, [locations, visible, areaKeys]);

  const areaStyle = (selected: boolean): L.PathOptions => ({
    pane: 'areas',
    interactive: false,
    color: selected ? colors.accent : palette.gray[7],
    weight: selected ? 2 : 1,
    fillColor: selected ? colors.accent : palette.gray[6],
    fillOpacity: selected ? 0.45 : 0.12,
  });
  // The outlines, drawn when the set of areas changes; the map then shows all of them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: redrawn for a new set of areas, not for each choice
  useEffect(() => {
    if (!instance.current) return;
    const { map, shading } = instance.current;
    shading.clearLayers();
    shaded.current.clear();
    if (!areas?.length) return;
    for (const area of areas) {
      const rings = area.rings.map((ring) => {
        const corners: L.LatLngTuple[] = [];
        for (let at = 0; at < ring.length; at += 2) corners.push([ring[at]!, ring[at + 1]!]);
        return [corners];
      });
      shaded.current.set(area.key, L.polygon(rings, areaStyle(area.selected)).addTo(shading));
    }
    map.fitBounds(L.featureGroup([...shaded.current.values()]).getBounds(), { padding: [12, 12], animate: false });
  }, [areaKeys, visible]);
  // Each choice changes the shading only.
  useEffect(() => {
    for (const area of areas ?? []) shaded.current.get(area.key)?.setStyle(areaStyle(area.selected));
  });

  useEffect(() => {
    if (!instance.current) return;
    const { transit } = instance.current;
    transit.clearLayers();
    if (!transitShown) return;
    let current = true;
    const renderer = L.canvas({ padding: 0.5 });
    void transitStops().then((stops) => {
      if (!current) return;
      setTransitCount(stops.length);
      for (const stop of stops) {
        const [color, system] = TRANSIT[stop.kind];
        const label = `${stop.name} · ${system}${stop.detail ? ` (${stop.detail})` : ''}`;
        L.circleMarker([stop.latitude, stop.longitude], {
          renderer,
          radius: 4,
          color: '#ffffff',
          weight: 1.5,
          fillColor: color,
          fillOpacity: 1,
        })
          .bindTooltip(label, { direction: 'top', offset: [0, -4] })
          .addTo(transit);
      }
    });
    return () => {
      current = false;
    };
  }, [transitShown, visible]);

  return (
    <section aria-label="Map of matching apartments" style={{ border: `1px solid ${colors.border}`, background: colors.surface }}>
      <div ref={container} style={{ height: 'clamp(350px, 66vh, 800px)', background: palette.gray[0] }} />
      <div
        role="status"
        style={{
          padding: '8px 12px',
          fontSize: 13,
          color: palette.gray[8],
          // The same system font as the rest of the app (React Native Web's default for text).
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        {areas?.length
          ? `Tap a shaded area to add or remove its neighborhoods${points.length ? ` · ${points.length.toLocaleString()} matching now` : ''}`
          : `${points.length.toLocaleString()} mapped${total > points.length ? ` · ${total - points.length} without coordinates` : ''}`}
        {points.length > 0 && ' · Zoom in for prices; tap a home to see it'}
        {unavailable && ' · Some street tiles could not load'}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          padding: '0 12px 10px',
          fontSize: 13,
          color: palette.gray[8],
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, color: colors.ink }}>
          <input type="checkbox" checked={transitShown} onChange={(event) => setTransitShown(event.target.checked)} />
          Transit stops
        </label>
        {transitShown &&
          Object.values(TRANSIT).map(([color, name]) => (
            <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: color, display: 'inline-block' }} />
              {name}
            </span>
          ))}
        {transitShown && <span>{transitCount === null ? 'Loading stops…' : transitCount === 0 ? 'Stops are not loaded yet' : ''}</span>}
      </div>
    </section>
  );
}
