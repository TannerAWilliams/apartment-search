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
import { safeListingUrl } from '../marketplaces.ts';
import { bedroomLabel, formatRent } from '../search.ts';

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
    background: '#222222',
    color: '#fff',
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
    background: '#ffffff',
    color: '#222222',
    border: '1px solid #b0b0b0',
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
      border: '1px solid #222222',
      background: '#ffffff',
      color: saved ? '#d62a52' : '#222222',
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
    const row = document.createElement('div');
    Object.assign(row.style, {
      padding: '4px 0 10px',
      borderTop: index ? '1px solid #ebebeb' : 'none',
      paddingTop: index ? '10px' : '4px',
    });
    const price = document.createElement('div');
    Object.assign(price.style, { fontSize: '17px', fontWeight: '700', color: '#222222' });
    price.textContent = formatRent(rent) + ' a month';
    const heading = document.createElement('div');
    Object.assign(heading.style, { fontSize: '14px', fontWeight: '600', color: '#222222', marginTop: '2px' });
    heading.textContent = title;
    const detail = document.createElement('div');
    Object.assign(detail.style, { fontSize: '13px', color: '#6a6a6a', marginTop: '2px' });
    const status = ({ snapshot: 'Dated listing', cached: 'Last saved result' } as Record<string, string>)[kind];
    detail.textContent = [bedroomLabel(bedrooms), status, transitSeconds == null ? null : `${Math.ceil(transitSeconds / 60)} min transit`]
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
      Object.assign(view.style, BUTTON, { border: '1px solid #d62a52', background: '#d62a52', color: '#ffffff' });
      buttons.append(view);
    }
    row.append(price, heading, detail, buttons);
    content.append(row);
  });
  return content;
}

/** OpenFreeMap's Liberty map style. */
const LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';

/** From this zoom (a few neighborhoods across) homes show their rents; further out, a dot each. */
const PRICES_FROM_ZOOM = 14;

export function ListingMap({
  points,
  total,
  visible,
  onSave,
  isSaved,
  onOpen,
}: {
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
  const instance = useRef<{ map: L.Map; clusters: L.MarkerClusterGroup; dots: L.LayerGroup; transit: L.LayerGroup } | null>(null);
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
    // Zoomed out: one small dot per home. Zoomed in: price pills, with "N homes" where several overlap.
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
    instance.current = { map, clusters, dots, transit };
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
      L.circleMarker(coordinate, {
        renderer: dotRenderer,
        radius: 5,
        color: '#ffffff',
        weight: 1.5,
        fillColor: '#d62a52',
        fillOpacity: 0.9,
      })
        .bindPopup(() => popupContent(listings, actions.current), { maxWidth: 280 })
        .addTo(dots);
    }
    clusters.addLayers(pins);
    if (pins.length) map.fitBounds(L.latLngBounds(pins.map((pin) => pin.getLatLng())), { padding: [32, 32], maxZoom: 15, animate: false });
  }, [locations, visible]);

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
    <section aria-label="Map of matching apartments" style={{ border: '1px solid #d7e0ec', background: '#fff' }}>
      <div ref={container} style={{ height: 'clamp(350px, 66vh, 800px)', background: '#edf1f4' }} />
      <div
        role="status"
        style={{
          padding: '8px 12px',
          fontSize: 13,
          color: '#35445a',
          // The same system font as the rest of the app (React Native Web's default for text).
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        {`${points.length.toLocaleString()} mapped${total > points.length ? ` · ${total - points.length} without coordinates` : ''}`}
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
          color: '#35445a',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, color: '#222' }}>
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
