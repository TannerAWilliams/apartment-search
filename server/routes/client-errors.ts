/**
 * POST /api/client-error: a screen that crashed in someone's browser (the app's error boundary sends it). Each is
 * written to Workers Logs and the latest 30 are kept in storage, so a crash someone reports can be found and fixed.
 */
import { vValidator } from '@hono/valibot-validator';
import * as v from 'valibot';
import type { Bucket } from '../contracts.ts';
import { log } from '../log.ts';
import { apiBodies, factory, refuseWith } from './context.ts';

export const CLIENT_ERRORS_KEY = 'ops/client-errors.json';
const KEPT = 30;
const text = (max: number) =>
  v.optional(
    v.pipe(
      v.string(),
      v.transform((value) => value.slice(0, max)),
    ),
    '',
  );
// Short enough together to fit the API's 4 KB request limit (the browser trims them the same way).
const ClientErrorSchema = v.object({ message: text(300), stack: text(1500), componentStack: text(1500), path: text(200) });
type ClientError = v.InferOutput<typeof ClientErrorSchema> & { at: string };

export async function recordClientError(bucket: Bucket, error: Omit<ClientError, 'at'>, now = new Date()) {
  const stored = await (await bucket.get(CLIENT_ERRORS_KEY))?.json().catch(() => null);
  const recent = Array.isArray(stored) ? (stored as ClientError[]) : [];
  await bucket.put(CLIENT_ERRORS_KEY, JSON.stringify([{ ...error, at: now.toISOString() }, ...recent].slice(0, KEPT)));
}

export const clientErrorRoutes = factory
  .createApp()
  .post('/client-error', apiBodies, vValidator('json', ClientErrorSchema, refuseWith(400)), async (c) => {
    const error = c.req.valid('json');
    log.error('client_crash', { message: error.message, path: error.path });
    if (c.var.appEnv.BUCKET) await recordClientError(c.var.appEnv.BUCKET, error);
    return c.body(null, 204);
  });
