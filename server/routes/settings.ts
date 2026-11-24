/** GET and POST /api/settings: platform settings on the profile page. Anyone signed in can read them; only an admin can change them. */
import { vValidator } from '@hono/valibot-validator';
import { readSettings, updateSettings } from '../nightly.ts';
import { apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { SettingsRequestSchema } from './inputs.ts';

const STORAGE = 'Settings need saved storage.';

export const settingsRoutes = factory
  .createApp()
  .get('/settings', needsStorage(STORAGE), async (c) =>
    c.json({ ...(await readSettings(c.var.bucket)), admin: c.var.services.admin === true }, 200),
  )
  .post('/settings', needsStorage(STORAGE), apiBodies, vValidator('json', SettingsRequestSchema, refuse), async (c) => {
    if (!c.var.services.admin) return fail(c, 403, 'Only an admin can change platform settings.');
    const settings = await updateSettings(c.var.bucket, c.req.valid('json'));
    return c.json({ ...settings, admin: true }, 200);
  });
