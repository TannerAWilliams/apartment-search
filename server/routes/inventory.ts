/**
 * The inventory file browsers search themselves (server/inventory.ts, docs/architecture/search.md): its head,
 * which changes when the listings do, and each version's file, which never changes.
 */
import { readFile, readHead, refreshInventorySoon } from '../inventory.ts';
import { factory, fail } from './context.ts';

/** Sent as stored: the file is already compressed, so Cloudflare must not compress it again. */
const asStored = { encodeBody: 'manual' } as ResponseInit;

export const inventoryRoutes = factory
  .createApp()
  .get('/inventory', async (c) => {
    const { appEnv: env, services } = c.var;
    const store = env.INVENTORY;
    if (!store || !env.BUCKET) return fail(c, 404, 'This server keeps no inventory file.');
    const head = await readHead(store);
    // None yet, or one built by older code (a deploy may have changed scoring): build it after this response.
    // Until it is there the app searches through the server, as it does where there is no file at all.
    if (!head || head.build !== (env.CF_VERSION_METADATA?.id ?? '')) {
      const build = refreshInventorySoon({ ...env, BUCKET: env.BUCKET });
      if (services.waitUntil) services.waitUntil(build);
      else await build;
    }
    if (!head) return fail(c, 404, 'The inventory file is being built.');
    // Browsers ask again after half a minute; a version's file is theirs to keep.
    return c.json(head, 200, { 'Cache-Control': 'public, max-age=30' });
  })
  .get('/inventory/:version', async (c) => {
    // Every listing in one file is for the app's own pages. Browsers say where a request comes from in a header
    // that a page's script cannot set, so another website cannot fetch the file through its visitors, and a
    // plain download is refused. Someone who forges the header can still read it, as they could read search
    // results page by page; the Worker's rate limit (server/cloudflare.ts) slows that too.
    if (c.req.header('Sec-Fetch-Site') !== 'same-origin') return fail(c, 403, 'The inventory file is for the app’s own pages.');
    const store = c.var.appEnv.INVENTORY;
    const version = c.req.param('version');
    if (!store || !/^[0-9a-f]{24}$/.test(version)) return fail(c, 404, 'That inventory file is gone. Ask for the current one.');
    // Brotli for the browsers that read it, gzip for the rest and for a file stored before Brotli. Cloudflare
    // rewrites Accept-Encoding on the way in and keeps what the browser sent beside it.
    const accepted =
      (c.req.raw as Request & { cf?: { clientAcceptEncoding?: string } }).cf?.clientAcceptEncoding ?? c.req.header('Accept-Encoding');
    // Asked for only once the head says it is there: a location that looked for it sooner would remember
    // that it was missing for as long as it keeps a file, a day.
    const head = /\bbr\b/.test(accepted ?? '') ? await readHead(store) : null;
    const brotli = head?.version === version && head.encodings?.includes('br') ? await readFile(store, version, 'br') : null;
    const file = brotli ?? (await readFile(store, version, 'gzip'));
    if (!file) return fail(c, 404, 'That inventory file is gone. Ask for the current one.');
    return new Response(file, {
      ...asStored,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Encoding': brotli ? 'br' : 'gzip',
        'Cache-Control': 'public, max-age=31536000, immutable',
        Vary: 'Accept-Encoding',
      },
    });
  });
