/**
 * GET and POST /api/household: the signed-in account's shared list (server/households.ts).
 * GET and POST /api/shared-list/TOKEN: the same list through its link, for anyone who has it: read it, leave a note.
 */
import { vValidator } from '@hono/valibot-validator';
import { addGuestNote, changeHousehold, findHousehold, sharedByLink } from '../households.ts';
import { IMPORT_BODIES, apiBodies, factory, fail, needsStorage, refuse } from './context.ts';
import { GuestNoteSchema, HouseholdRequestSchema } from './inputs.ts';

const STORAGE = 'Shared lists need saved storage.';
const NO_ACCOUNT = 'Sign in to share a list.';
const NO_LIST = 'This link no longer opens a shared list. Ask whoever sent it for a new one.';
/** A link's token, as they are made: 32 hexadecimal characters. */
const TOKEN = /^[0-9a-f]{32}$/;

export const householdRoutes = factory
  .createApp()
  .get('/household', needsStorage(STORAGE), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    return c.json({ household: await findHousehold(c.var.bucket, account.toLowerCase()), me: account.toLowerCase() }, 200);
  })
  .post('/household', needsStorage(STORAGE), IMPORT_BODIES, vValidator('json', HouseholdRequestSchema, refuse), async (c) => {
    const account = c.var.services.account;
    if (!account) return fail(c, 404, NO_ACCOUNT);
    // A refused change (SearchInputError) becomes a 422 with its message in the API's error handler.
    const household = await changeHousehold(c.var.bucket, account, c.req.valid('json'));
    return c.json({ household, me: account.toLowerCase() }, 200);
  })
  .get('/shared-list/:token', needsStorage(STORAGE), async (c) => {
    const token = c.req.param('token') ?? '';
    const list = TOKEN.test(token) ? await sharedByLink(c.var.bucket, token) : null;
    // Never kept by a browser or a cache: a link that is turned off stops working at once.
    return list ? c.json({ list }, 200, { 'Cache-Control': 'no-store' }) : fail(c, 404, NO_LIST);
  })
  .post('/shared-list/:token', needsStorage(STORAGE), apiBodies, vValidator('json', GuestNoteSchema, refuse), async (c) => {
    const token = c.req.param('token') ?? '';
    const list = TOKEN.test(token) ? await addGuestNote(c.var.bucket, token, c.req.valid('json')) : null;
    return list ? c.json({ list }, 200, { 'Cache-Control': 'no-store' }) : fail(c, 404, NO_LIST);
  });
