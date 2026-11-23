/** Serves the web build for the browser tests, with the production Worker's headers. */
import { resolve, sep } from 'node:path';
import { cacheControl, WEB_HEADERS } from '../server/web-headers.ts';

const root = resolve('web-build');

Bun.serve({
  hostname: '127.0.0.1',
  port: 4173,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname.startsWith('/api/')) return new Response('Unexpected unmocked API call', { status: 500 });
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) return new Response(null, { status: 403 });
    const file = Bun.file(path);
    if (!await file.exists()) return new Response(null, { status: 404 });
    // The production Worker's headers, so every browser test also runs under its Content Security Policy.
    // Bun sets Content-Type from the file's extension.
    return new Response(file, { headers: { ...WEB_HEADERS, 'Cache-Control': cacheControl(pathname) } });
  },
  error: () => new Response(null, { status: 404 }),
});
