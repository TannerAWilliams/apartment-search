/** GET and POST /api/alerts: saved alerts, the devices that get notifications, and a test alert. */
import { vValidator } from '@hono/valibot-validator';
import type * as v from 'valibot';
import type { AppEnv, Bucket } from '../contracts.ts';
import { addDevice, addRule, alertChannels, alertMatches, alertState, deleteRule, deliver, removeDevice } from '../alerts.ts';
import { log } from '../log.ts';
import { apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { AlertRequestSchema } from './inputs.ts';

async function alertAction(body: v.InferOutput<typeof AlertRequestSchema>, env: AppEnv & { BUCKET: Bucket }, origin: string) {
  const bucket = env.BUCKET;
  if (body.action === 'add-rule') await addRule(bucket, body.rule, alertMatches(env));
  else if (body.action === 'delete-rule') await deleteRule(bucket, body.id);
  else if (body.action === 'add-device') await addDevice(bucket, body.subscription, body.label);
  else if (body.action === 'remove-device') await removeDevice(bucket, body.endpoint);
  else {
    const delivered = await deliver(
      bucket,
      [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          ruleId: 'test',
          title: 'Test alert from Walkup',
          lines: ['Alerts are working. New apartments and price drops in your saved alerts will arrive like this.'],
          newCount: 0,
          dropCount: 0,
        },
      ],
      alertChannels(env),
      origin,
    );
    return { ...(await alertState(env)), delivered };
  }
  return alertState(env);
}

const STORAGE = 'Alerts need saved storage.';

export const alertRoutes = factory
  .createApp()
  .get('/alerts', needsStorage(STORAGE), async (c) => {
    try {
      return c.json(await alertState({ ...c.var.appEnv, BUCKET: c.var.bucket }), 200);
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'Alerts could not be read. Try again shortly.');
    }
  })
  .post('/alerts', needsStorage(STORAGE), apiBodies, vValidator('json', AlertRequestSchema, refuse), async (c) => {
    const env = { ...c.var.appEnv, BUCKET: c.var.bucket };
    return c.json(await alertAction(c.req.valid('json'), env, env.APP_ORIGIN ?? new URL(c.req.url).origin), 200);
  });
