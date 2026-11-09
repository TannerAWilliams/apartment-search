import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { handleApi } from './api.mjs';
import { MIME } from './mime.mjs';

const { values } = parseArgs({ options: {
  host: { type: 'string' },
  port: { type: 'string' },
  strictPort: { type: 'boolean' },
} });
const host = values.host || process.env.HOST || '127.0.0.1';
const port = Number(values.port || process.env.PORT || 3000);
const root = fileURLToPath(new URL('../web-build', import.meta.url));
const token = process.env.APP_ACCESS_TOKEN;
const hasLiveFeeds = process.env.RENTCAST_API_KEY || process.env.PARTNER_FEEDS_JSON;
if (hasLiveFeeds && !['127.0.0.1', '::1', 'localhost'].includes(host) && (!token || token.length < 24)) {
  throw new Error('Set APP_ACCESS_TOKEN to at least 24 characters before exposing a live feed server on the network.');
}

createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of incoming) {
        bytes += chunk.length;
        if (bytes > 4096) {
          outgoing.writeHead(413).end('Search request is too large.');
          return;
        }
        chunks.push(chunk);
      }
      const response = await handleApi(new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        body: bytes ? Buffer.concat(chunks) : undefined,
      }), process.env, { requireToken: Boolean(token) });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
        .end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (!['GET', 'HEAD'].includes(incoming.method)) {
      outgoing.writeHead(405).end();
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) {
      outgoing.writeHead(404).end();
      return;
    }
    const content = await readFile(file);
    outgoing.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
      .end(incoming.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      outgoing.writeHead(404).end('Page not found. Run npm run build:web to build the mobile website.');
    } else {
      outgoing.writeHead(500).end('The apartment search server encountered an error.');
    }
  }
}).listen(port, host, () => console.log(`Apartment Search is serving on port ${port}`));
