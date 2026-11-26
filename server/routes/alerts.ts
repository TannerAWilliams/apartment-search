/** GET and POST /api/alerts: saved alerts, the devices that get notifications, and a test alert. */
import { recordEvent } from '../ops.ts';
import { vValidator } from '@hono/valibot-validator';
import type * as v from 'valibot';
import type { AppEnv, Bucket } from '../contracts.ts';
import {
  addDevice,
  addRule,
  alertChannels,
  alertMatches,
  alertState,
  deleteRule,
  deliver,
  FREE_RULES,
  previewRule,
  removeDevice,
} from '../alerts.ts';
import { log } from '../log.ts';
import { type Plan, planFor } from '../plans.ts';
import { afterResponse, apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { AlertRequestSchema } from './inputs.ts';

async function alertAction(
  body: v.InferOutput<typeof AlertRequestSchema>,
  env: AppEnv & { BUCKET: Bucket },
  origin: string,
  owner: string | undefined,
) {
  const bucket = env.BUCKET;
  if (body.action === 'add-rule') {
    await addRule(bucket, body.rule, alertMatches(env), new Date(), owner);
  } else if (body.action === 'preview-rule') {
    // Nothing is saved: what the alert being written would match now, for the count and the map beside the form.
    const [state, preview] = await Promise.all([alertState(env, owner), previewRule(body.rule, alertMatches(env))]);
    return { ...state, preview };
  } else if (body.action === 'delete-rule') await deleteRule(bucket, body.id, owner);
  else if (body.action === 'add-device') await addDevice(bucket, body.subscription, body.label, new Date(), owner);
  else if (body.action === 'remove-device') await removeDevice(bucket, body.endpoint, owner);
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
          ...(owner ? { owner } : {}),
        },
      ],
      alertChannels(env),
      origin,
    );
    return { ...(await alertState(env, owner)), delivered };
  }
  return alertState(env, owner);
}

const STORAGE = 'Alerts need saved storage.';
/** The signed-in account an alert belongs to, in lower case; none for the app's own token or a public app. */
const ownerOf = (account: string | null | undefined) => (account ? account.toLowerCase() : undefined);
const NO_ACCOUNT = 'Create a free account or sign in to get email alerts.';
/**
 * What the free plan leaves out: more than one alert. A free account's one alert comes by email and to its
 * phone three hours after a match is found (server/alerts.ts); text messages are for a higher plan, not built yet.
 */
const ONE_ALERT = 'A free account keeps one alert. The paid plan keeps up to ten and sends each match as soon as it is found.';

export const alertRoutes = factory
  .createApp()
  .get('/alerts', needsStorage(STORAGE), async (c) => {
    if (!c.var.services.privateAuthenticated && !c.var.services.admin) return fail(c, 401, NO_ACCOUNT);
    try {
      const env = { ...c.var.appEnv, BUCKET: c.var.bucket };
      // The plan and the alerts are read together.
      const [plan, state]: [Plan, Awaited<ReturnType<typeof alertState>>] = await Promise.all([
        planFor(env, c.var.bucket, c.var.services.account, c.var.services.admin),
        alertState(env, ownerOf(c.var.services.account)),
      ]);
      return c.json({ ...state, plan }, 200);
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'Alerts could not be read. Try again shortly.');
    }
  })
  .post('/alerts', needsStorage(STORAGE), apiBodies, vValidator('json', AlertRequestSchema, refuse), async (c) => {
    if (!c.var.services.privateAuthenticated && !c.var.services.admin) return fail(c, 401, NO_ACCOUNT);
    const env = { ...c.var.appEnv, BUCKET: c.var.bucket };
    const origin = env.APP_ORIGIN ?? new URL(c.req.url).origin;
    const body = c.req.valid('json');
    const plan = await planFor(env, c.var.bucket, c.var.services.account, c.var.services.admin);
    const owner = ownerOf(c.var.services.account);
    if (plan === 'free' && body.action === 'add-rule' && (await alertState(env, owner)).rules.length >= FREE_RULES)
      return fail(c, 402, ONE_ALERT);
    const result = await alertAction(body, env, origin, owner);
    if (body.action === 'add-rule') await afterResponse(c.var.services, 'alert_event', () => recordEvent(c.var.bucket, 'alert'));
    return c.json({ ...result, plan }, 200);
  });
