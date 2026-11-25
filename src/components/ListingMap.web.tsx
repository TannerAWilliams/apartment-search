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
import { listingLinkLabel } from '../listings.ts';
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

function pinIcon(count: number) {
  const badge = document.createElement('span');
  const size = count > 1 ? 34 : 15;
  Object.assign(badge.style, {
    background: '#222222',
    color: '#fff',
    border: '2px solid white',
    borderRadius: '50%',
    width: size + 'px',
    height: size + 'px',
    display: 'grid',
    placeItems: 'center',
    fontSize: '11px',
    fontWeight: '700',
    boxShadow: '0 1px 4px #193e6780',
  });
  if (count > 1) badge.textContent = count.toLocaleString();
  return L.divIcon({ className: '', html: badge, iconSize: [size + 4, size + 4] });
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
    border: '1px solid #dddddd',
    borderRadius: '999px',
    padding: '4px 9px',
    fontSize: '13px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
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

type SaveActions = { save?: (point: MapPoint) => void; isSaved?: (point: MapPoint) => boolean };

/** A Save button for one listing in a pop-up; it reads "Saved" once the listing is saved. */
function saveButton(point: MapPoint, { save, isSaved }: SaveActions) {
  if (!save) return null;
  const button = document.createElement('button');
  button.type = 'button';
  const show = (saved: boolean) => {
    button.textContent = saved ? '♥ Saved' : '♡ Save';
    button.disabled = saved;
    button.setAttribute('aria-label', (saved ? 'Saved: ' : 'Save ') + point.title);
    Object.assign(button.style, {
      marginTop: '6px',
      padding: '5px 12px',
      borderRadius: '999px',
      border: '1px solid #d62a52',
      background: saved ? '#f7f7f7' : '#d62a52',
      color: saved ? '#d62a52' : '#fff',
      font: '600 13px system-ui, sans-serif',
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

function popupContent(listings: MapPoint[], actions: SaveActions) {
  const content = document.createElement('div');
  Object.assign(content.style, { maxHeight: '260px', overflowY: 'auto', minWidth: '160px' });
  for (const point of listings) {
    const { title, rent, bedrooms, kind, url, name, linkKind, additionalLinks = [], transitSeconds, drivingSeconds } = point;
    const row = document.createElement('div');
    row.style.padding = '7px 2px';
    const heading = document.createElement('strong');
    const primary = popupLink(url, title);
    if (primary) heading.append(primary);
    else heading.textContent = title;
    const detail = document.createElement('div');
    const status = ({ snapshot: 'Dated listing', cached: 'Last saved result', saved: 'Saved listing' } as Record<string, string>)[kind];
    detail.textContent = [
      formatRent(rent),
      bedroomLabel(bedrooms),
      status,
      transitSeconds == null ? null : `${Math.ceil(transitSeconds / 60)} min transit`,
      drivingSeconds == null ? null : `${Math.ceil(drivingSeconds / 60)} min drive`,
    ]
      .filter(Boolean)
      .join(' · ');
    row.append(heading, detail);
    const save = saveButton(point, actions);
    if (save) row.append(save);
    for (const source of [{ url, name, kind: linkKind }, ...additionalLinks]) {
      const link = popupLink(source.url, listingLinkLabel({ name: source.name ?? 'Website', kind: source.kind ?? kind }) + ' ↗');
      if (!link) continue;
      link.style.display = 'block';
      row.append(link);
    }
    content.append(row);
  }
  return content;
}

export function ListingMap({
  points,
  total,
  visible,
  onSave,
  isSaved,
}: {
  points: MapPoint[];
  total: number;
  visible: boolean;
  onSave?: (point: MapPoint) => void;
  isSaved?: (point: MapPoint) => boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  // Pop-ups are built when opened, so they read the latest save state through this ref.
  const actions = useRef<SaveActions>({});
  actions.current = { save: onSave, isSaved };
  const instance = useRef<{ map: L.Map; clusters: L.MarkerClusterGroup; transit: L.LayerGroup } | null>(null);
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
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      updateWhenIdle: true,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    tiles.on('tileerror', () => setUnavailable(true));
    tiles.on('tileload', () => setUnavailable(false));
    const clusters = L.markerClusterGroup({
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) =>
        pinIcon(cluster.getAllChildMarkers().reduce((sum, marker) => sum + (marker.options.listingCount ?? 0), 0)),
    }).addTo(map);
    // Stops are drawn on a canvas below the pins, so hundreds of them stay quick.
    const transit = L.layerGroup().addTo(map);
    instance.current = { map, clusters, transit };
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
    const { map, clusters } = instance.current;
    clusters.clearLayers();
    const pins = [];
    for (const [key, listings] of locations) {
      const coordinate = key.split(',').map(Number) as L.LatLngTuple;
      const title = listings.length === 1 ? listings[0].title : listings.length + ' listings at this location';
      pins.push(
        L.marker(coordinate, { icon: pricePin(listings), title, alt: title, listingCount: listings.length }).bindPopup(
          () => popupContent(listings, actions.current),
          { maxWidth: 260 },
        ),
      );
    }
    clusters.addLayers(pins);
    if (pins.length) map.fitBounds(clusters.getBounds(), { padding: [32, 32], maxZoom: 14, animate: false });
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
        {points.length > 0 && onSave && ' · Tap a pin to see and save listings'}
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
