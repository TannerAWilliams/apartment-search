import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import { safeListingUrl } from './marketplaces.mjs';
import { bedroomLabel, formatRent } from './search.mjs';

const center = [40.75, -73.98];

function pinIcon(count) {
  const badge = document.createElement('span');
  const size = count > 1 ? 34 : 15;
  Object.assign(badge.style, {
    background: '#0645c2', color: '#fff', border: '2px solid white', borderRadius: '50%',
    width: size + 'px', height: size + 'px', display: 'grid', placeItems: 'center',
    fontSize: '11px', fontWeight: '700', boxShadow: '0 1px 4px #193e6780',
  });
  if (count > 1) badge.textContent = count.toLocaleString();
  return L.divIcon({ className: '', html: badge, iconSize: [size + 4, size + 4] });
}

function popupContent(listings) {
  const content = document.createElement('div');
  Object.assign(content.style, { maxHeight: '260px', overflowY: 'auto', minWidth: '160px' });
  for (const { title, rent, bedrooms, kind, url, name, transitSeconds, drivingSeconds } of listings) {
    const row = document.createElement('div');
    row.style.padding = '7px 2px';
    const href = safeListingUrl(url);
    const heading = document.createElement(href ? 'a' : 'strong');
    heading.textContent = title;
    if (href) heading.href = href;
    heading.style.fontWeight = '700';
    const detail = document.createElement('div');
    const status = { snapshot: 'Dated listing', cached: 'Last saved result', saved: 'Saved listing' }[kind];
    detail.textContent = [formatRent(rent), bedroomLabel(bedrooms), name, status,
      transitSeconds == null ? null : `${Math.ceil(transitSeconds / 60)} min transit`,
      drivingSeconds == null ? null : `${Math.ceil(drivingSeconds / 60)} min drive`].filter(Boolean).join(' · ');
    row.append(heading, detail);
    content.append(row);
  }
  return content;
}

export function ListingMap({ points, total, visible }) {
  const container = useRef(null);
  const instance = useRef(null);
  const [unavailable, setUnavailable] = useState(false);
  const locations = useMemo(() => {
    const grouped = new Map();
    for (const point of points) {
      const key = `${point.latitude},${point.longitude}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(point);
    }
    return grouped;
  }, [points]);

  useEffect(() => {
    if (!visible) return;
    const map = L.map(container.current, { scrollWheelZoom: false, maxZoom: 19 }).setView(center, 9);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, updateWhenIdle: true, referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    tiles.on('tileerror', () => setUnavailable(true));
    tiles.on('tileload', () => setUnavailable(false));
    const clusters = L.markerClusterGroup({
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) => pinIcon(cluster.getAllChildMarkers().reduce((sum, marker) => sum + marker.options.listingCount, 0)),
    }).addTo(map);
    instance.current = { map, clusters };
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resize.observe(container.current);
    return () => { resize.disconnect(); instance.current = null; map.remove(); };
  }, [visible]);

  useEffect(() => {
    if (!instance.current) return;
    const { map, clusters } = instance.current;
    clusters.clearLayers();
    const pins = [];
    for (const [key, listings] of locations) {
      const coordinate = key.split(',').map(Number);
      const title = listings.length === 1 ? listings[0].title : listings.length + ' listings at this location';
      pins.push(L.marker(coordinate, { icon: pinIcon(listings.length), title, alt: title, listingCount: listings.length })
        .bindPopup(() => popupContent(listings), { maxWidth: 260 }));
    }
    clusters.addLayers(pins);
    if (pins.length) map.fitBounds(clusters.getBounds(), { padding: [32, 32], maxZoom: 14, animate: false });
  }, [locations, visible]);

  return <section aria-label="Map of matching apartments" style={{ border: '1px solid #d7e0ec', background: '#fff' }}>
    <div ref={container} style={{ height: 'clamp(350px, 66vh, 800px)', background: '#edf1f4' }} />
    <div role="status" style={{ padding: '8px 12px', fontSize: 13, color: '#35445a' }}>
      {`${points.length.toLocaleString()} mapped${total > points.length ? ` · ${total - points.length} without coordinates` : ''}`}
      {unavailable && ' · Some street tiles could not load'}
    </div>
  </section>;
}
