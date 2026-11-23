/**
 * Headers for the web app's own files. The policy allows only what the app loads: its bundle, styles that
 * React Native Web writes at runtime, OpenStreetMap tiles, and the public exports the page reads itself
 * when the Worker could not (FirstMover on GitHub, NYC Open Data). Listing links open in new tabs and are
 * not restricted.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://www.firstmovernyc.com https://data.cityofnewyork.us",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const WEB_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // Listing sites never learn which app sent you.
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * Fingerprinted build files never change, so browsers keep them for a year; everything else is
 * revalidated on each load. Private, because the app is behind sign-in.
 */
export const cacheControl = (pathname: string) =>
  pathname.startsWith('/_expo/static/') ? 'private, max-age=31536000, immutable' : 'private, no-cache';

/** A copy of a static-asset response with the security and caching headers above. */
export function withWebHeaders(response: Response, pathname: string) {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(WEB_HEADERS)) result.headers.set(name, value);
  if (response.ok || response.status === 304) result.headers.set('Cache-Control', cacheControl(pathname));
  return result;
}
