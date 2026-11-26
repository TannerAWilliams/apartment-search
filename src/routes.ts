/**
 * The app's addresses on the web: each screen has its own path (/market, /search, /profile), so links, Back
 * and reload work like any website. The Worker serves the app for these paths (server/cloudflare.ts).
 */

/** Screens whose path is not simply their name. */
const NAMED: Record<string, string> = { home: '/', chart: '/market', results: '/search', more: '/profile' };
/** Screens whose path is their name: /saved, /alerts. */
const PLAIN = [
  'saved',
  'sources',
  'marketplaces',
  'affordable',
  'alerts',
  'shared',
  'apply',
  'neighborhoods',
  'renewal',
  'admin',
  'terms',
  'privacy',
  'list',
  'afford',
  'about',
  'pricing',
];
const BY_PATH = new Map<string, string>([
  ...Object.entries(NAMED).map(([tab, path]) => [path, tab] as const),
  ...PLAIN.map((tab) => ['/' + tab, tab] as const),
  ['/home', 'home'],
  ['/welcome', 'home'],
]);

/** Every path the app answers, for the Worker; a listing's own page is /listing/ and its ID. */
export const APP_PATHS = [...BY_PATH.keys()];
/** A shared list opened by its link, for someone without an account: /s/ and the link's token. */
const SHARED_LINK = /^\/s\/([0-9a-f]{32})$/;
export const isAppPath = (path: string) =>
  BY_PATH.has(path.replace(/\/+$/, '') || '/') || /^\/listing\/[^/]+$/.test(path) || SHARED_LINK.test(path);

/** The path for a screen; a listing's page is "listing=ID" as a screen, its ID kept URL-encoded. */
export function pathForTab(tab: string) {
  if (tab.startsWith('listing=')) return '/listing/' + tab.slice('listing='.length);
  if (tab.startsWith('link=')) return '/s/' + tab.slice('link='.length);
  return NAMED[tab] ?? (PLAIN.includes(tab) ? '/' + tab : '/');
}

/**
 * The screen for an address. Links from before paths ("/#saved", "/#listing=ID") still open their screen;
 * anything unknown opens the home page.
 */
export function tabForLocation(pathname: string, hash = '') {
  const legacy = hash.replace(/^#/, '');
  if (legacy.startsWith('listing=')) return legacy;
  if (legacy) return legacy in NAMED || PLAIN.includes(legacy) ? legacy : 'home';
  const listing = /^\/listing\/([^/]+)$/.exec(pathname);
  if (listing) return 'listing=' + listing[1]!;
  const link = SHARED_LINK.exec(pathname);
  if (link) return 'link=' + link[1]!;
  return BY_PATH.get(pathname.replace(/\/+$/, '') || '/') ?? 'home';
}
