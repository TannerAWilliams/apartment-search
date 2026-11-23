/** Security and caching headers, set with Hono's secure-headers middleware. */
import { secureHeaders } from 'hono/secure-headers';

/**
 * Hono's secure headers on every response. The Content Security Policy allows only what the app loads: its
 * bundle, styles that React Native Web writes at runtime, OpenStreetMap tiles, and the public exports the
 * page reads itself when the Worker could not (FirstMover on GitHub, NYC Open Data). Listing links open in
 * new tabs and are not restricted.
 */
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org'],
    connectSrc: ["'self'", 'https://api.github.com', 'https://raw.githubusercontent.com', 'https://www.firstmovernyc.com', 'https://data.cityofnewyork.us'],
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
  // HTTPS only, for a year. Browsers ignore it over plain HTTP, such as local development.
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  xFrameOptions: 'DENY',
  // Hono's default Referrer-Policy, no-referrer, means listing sites never learn which app sent you.
  permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
});

/**
 * Fingerprinted build files never change, so browsers keep them for a year; everything else is
 * revalidated on each load. Private, because the app is behind sign-in.
 */
export const cacheControl = (pathname: string) =>
  pathname.startsWith('/_expo/static/') ? 'private, max-age=31536000, immutable' : 'private, no-cache';

/** A copy of a static-asset response, whose headers can then be changed, with the caching header above. */
export function withCacheControl(response: Response, pathname: string) {
  const result = new Response(response.body, response);
  if (response.ok || response.status === 304) result.headers.set('Cache-Control', cacheControl(pathname));
  return result;
}
