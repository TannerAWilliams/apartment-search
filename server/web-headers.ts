/** Security and caching headers, set with Hono's secure-headers middleware. */
import { PHOTO_HOSTS } from '../src/listings.ts';
import { Hono } from 'hono';
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
    // Only the app's own scripts. Cloudflare Web Analytics is kept off the pages (no-transform, below): Safari's
    // Private Browsing blocks its script as a tracker and then tells the visitor the page may be broken.
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    // OpenFreeMap's map style draws its streets in a worker and reads its tiles, fonts and icons from its own host.
    workerSrc: ["'self'", 'blob:'],
    childSrc: ['blob:'],
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
      'https://tile.openstreetmap.org',
      'https://tiles.openfreemap.org',
      ...PHOTO_HOSTS.map((host) => 'https://' + host),
    ],
    connectSrc: [
      "'self'",
      'https://api.github.com',
      'https://raw.githubusercontent.com',
      'https://www.firstmovernyc.com',
      'https://data.cityofnewyork.us',
      'https://tiles.openfreemap.org',
    ],
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
 * revalidated on each load. Private, because the app is behind sign-in. no-transform keeps Cloudflare from
 * adding its Web Analytics script to the pages.
 */
export const cacheControl = (pathname: string) =>
  pathname.startsWith('/_expo/static/') ? 'private, max-age=31536000, immutable' : 'private, no-cache, no-transform';

/** A copy of a static-asset response, whose headers can then be changed, with the caching header above. */
export function withCacheControl(response: Response, pathname: string) {
  const result = new Response(response.body, response);
  if (response.ok || response.status === 304) result.headers.set('Cache-Control', cacheControl(pathname));
  return result;
}

/**
 * The same headers for the pages and files Cloudflare serves itself, as its `_headers` file (written into the
 * web build by scripts/build-service-worker.ts). The page and the app's code are static, so Cloudflare serves
 * them from its edge without starting the Worker; the Worker's own responses get their headers from
 * `securityHeaders` above. Rules apply in order, and a later one replaces a header only after detaching it.
 */
export async function assetHeadersFile() {
  const response = await new Hono()
    .use(securityHeaders)
    .get('/', (c) => c.body(null))
    .request('/');
  const security = [...response.headers]
    .filter(([name]) => name !== 'content-type' && name !== 'content-length')
    .map(([name, value]) => `  ${name}: ${value}`);
  return [
    '/*',
    ...security,
    `  Cache-Control: ${cacheControl('/')}`,
    '',
    '/_expo/static/*',
    '  ! Cache-Control',
    `  Cache-Control: ${cacheControl('/_expo/static/')}`,
    '',
  ].join('\n');
}
