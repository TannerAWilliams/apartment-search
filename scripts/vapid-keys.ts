// Creates the Web Push (VAPID) key pair for alert notifications. The private key goes straight into the
// Worker secret, never to the screen; the public key is printed for VAPID_PUBLIC_KEY in wrangler.jsonc:
//   bun scripts/vapid-keys.ts | bun ./node_modules/wrangler/bin/wrangler.js secret put VAPID_PRIVATE_KEY -c deploy/cloudflare/wrangler.jsonc
// Replacing the keys signs every device out of notifications until it turns them on again.
import { generateVapidKeys } from '../server/web-push.ts';

const { publicKey, privateKey } = await generateVapidKeys();
await Bun.write(Bun.stderr, `VAPID_PUBLIC_KEY=${publicKey}\n`);
await Bun.write(Bun.stdout, privateKey);
