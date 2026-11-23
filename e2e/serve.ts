import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { cacheControl, WEB_HEADERS } from '../server/web-headers.ts';

const root = resolve('web-build');
const types: Readonly<Record<string, string | undefined>> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) { response.writeHead(500).end('Unexpected unmocked API call'); return; }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const content = await readFile(file);
    // The production Worker's headers, so every browser test also runs under its Content Security Policy.
    response.writeHead(200, { ...WEB_HEADERS, 'Cache-Control': cacheControl(pathname), 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(content);
  } catch { response.writeHead(404).end(); }
}).listen(4173, '127.0.0.1');
