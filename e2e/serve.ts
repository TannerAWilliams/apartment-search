/** Serves the web build for the browser tests, with the production Worker's headers. */
import { cacheControl, WEB_HEADERS } from '../server/web-headers.ts';

const root = new URL('../web-build/', import.meta.url);

Bun.serve({
  hostname: '127.0.0.1',
  port: 4173,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname.startsWith('/api/')) return new Response('Unexpected unmocked API call', { status: 500 });
    // URL resolution removes `..`, so a path that climbs out of the build folder ends up outside `root`.
    const path = new URL('.' + (pathname === '/' ? '/index.html' : pathname), root);
    if (!path.href.startsWith(root.href)) return new Response(null, { status: 403 });
    const file = Bun.file(path);
    if (!await file.exists()) return new Response(null, { status: 404 });
    // The production Worker's headers, so every browser test also runs under its Content Security Policy.
    // Bun sets Content-Type from the file's extension.
    return new Response(file, { headers: { ...WEB_HEADERS, 'Cache-Control': cacheControl(pathname) } });
  },
  error: () => new Response(null, { status: 404 }),
});
