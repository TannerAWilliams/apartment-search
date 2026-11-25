/**
 * The inventory file browsers search themselves (server/inventory.ts, docs/architecture/search.md): its head,
 * which changes when the listings do, and each version's file, which never changes.
 */
import { readFile, readHead, refreshInventorySoon } from '../inventory.ts';
import { factory, fail } from './context.ts';

/** Sent as stored: the file is already gzipped, so Cloudflare must not compress it again. */
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
    const store = c.var.appEnv.INVENTORY;
    const version = c.req.param('version');
    const file = store && /^[0-9a-f]{24}$/.test(version) ? await readFile(store, version) : null;
    if (!file) return fail(c, 404, 'That inventory file is gone. Ask for the current one.');
    return new Response(file, {
      ...asStored,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });
