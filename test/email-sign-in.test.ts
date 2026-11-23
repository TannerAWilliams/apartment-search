import { expect, test } from 'bun:test';
import { fakeD1 } from './fixtures/fake-d1.ts';
import { authSchema } from '../scripts/auth-schema.ts';

const { default: worker } = await import('../server/cloudflare.ts');

const ORIGIN = 'https://app.test';
const ALLOWED = 'renter@example.test';

async function environment() {
  const { d1 } = await fakeD1();
  const sent: { to: string[]; text: string }[] = [];
  const env = {
    APARTMENTS: d1,
    APP_ORIGIN: ORIGIN,
    BETTER_AUTH_SECRET: 'test-only-better-auth-secret-0123456789abcdef',
    ACCESS_ALLOWED_EMAILS: ALLOWED.toUpperCase() + ', other@example.test',
    ALERT_EMAIL: {
      async send(message: { to: string[]; text: string }) {
        sent.push(message);
      },
    },
    ALERT_EMAIL_FROM: 'sign-in@example.test',
    ASSETS: { fetch: async (request: Request) => new Response('asset ' + new URL(request.url).pathname) },
  };
  return { env, sent };
}

const call = (env: object, path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(ORIGIN + path, init), env as Parameters<typeof worker.fetch>[1]);
const post = (env: object, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(env, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
const code = (text: string) => text.match(/\b(\d{6})\b/)?.[1] ?? '';

/** Signs in with an email code and returns the session cookie and bearer token. */
async function signIn(env: object, sent: { text: string }[]) {
  expect((await post(env, '/api/auth/email-otp/send-verification-otp', { email: ALLOWED, type: 'sign-in' })).status).toBe(200);
  const response = await post(env, '/api/auth/sign-in/email-otp', { email: ALLOWED, otp: code(sent.at(-1)?.text ?? '') });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return { cookie, token: response.headers.get('set-auth-token') ?? '' };
}

test('the D1 schema has the tables the auth settings need', async () => {
  const schema = await Bun.file(new URL('../deploy/cloudflare/schema.sql', import.meta.url)).text();
  expect(schema).toContain(await authSchema());
});

test('an allowed email signs in with a code, and the session opens the API', async () => {
  const { env, sent } = await environment();
  expect((await call(env, '/api/config')).status).toBe(401);
  // The app's pages load signed out, so they can show the sign-in form.
  expect(await (await call(env, '/')).text()).toBe('asset /');

  const { cookie, token } = await signIn(env, sent);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.to).toEqual([ALLOWED]);
  expect((await call(env, '/api/config', { headers: { Cookie: cookie } })).status).toBe(200);
  // The native app sends the session token instead of a cookie.
  expect(token).not.toBe('');
  expect((await call(env, '/api/config', { headers: { Authorization: 'Bearer ' + token } })).status).toBe(200);
});

test('an email that is not allowed gets no code and cannot sign in', async () => {
  const { env, sent } = await environment();
  // The reply is the same as for an allowed email, so the form cannot reveal who may sign in.
  expect((await post(env, '/api/auth/email-otp/send-verification-otp', { email: 'stranger@example.test', type: 'sign-in' })).status).toBe(
    200,
  );
  expect(sent).toHaveLength(0);
  expect((await post(env, '/api/auth/sign-in/email-otp', { email: 'stranger@example.test', otp: '123456' })).status).not.toBe(200);
});

test('a wrong code fails, and a session cookie cannot be used from another site', async () => {
  const { env, sent } = await environment();
  await post(env, '/api/auth/email-otp/send-verification-otp', { email: ALLOWED, type: 'sign-in' });
  const wrong = code(sent[0]?.text ?? '') === '000000' ? '111111' : '000000';
  expect((await post(env, '/api/auth/sign-in/email-otp', { email: ALLOWED, otp: wrong })).status).not.toBe(200);

  const { cookie, token } = await signIn(env, sent);
  const body = { check: 'now' };
  const crossSite = await post(env, '/api/refresh', body, { Cookie: cookie, Origin: 'https://evil.example' });
  expect(crossSite.status).toBe(403);
  // A bearer token is not sent by browsers on their own, so it needs no Origin.
  const native = await call(env, '/api/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  expect(native.status).not.toBe(403);
});

test('sign-in is off without its secret', async () => {
  const { env } = await environment();
  const off = { ...env, BETTER_AUTH_SECRET: undefined };
  expect((await post(off, '/api/auth/email-otp/send-verification-otp', { email: ALLOWED, type: 'sign-in' })).status).toBe(404);
  expect((await call(off, '/')).status).toBe(401);
});

test('without an email binding, a code request is answered but logged as unsendable', async () => {
  const { log } = await import('../server/log.ts');
  const { env } = await environment();
  const lines: string[] = [];
  const sink = log.sink;
  log.sink = (_level, line) => lines.push(line);
  try {
    const response = await post({ ...env, ALERT_EMAIL: undefined }, '/api/auth/email-otp/send-verification-otp', {
      email: ALLOWED,
      type: 'sign-in',
    });
    expect(response.status).toBe(200);
  } finally {
    log.sink = sink;
  }
  expect(lines.some((line) => line.includes('sign_in_email_unavailable'))).toBe(true);
});

test('when the sign-in database fails, the request is refused and the failure logged', async () => {
  const { log } = await import('../server/log.ts');
  const { env } = await environment();
  const broken = {
    ...env,
    APARTMENTS: {
      ...env.APARTMENTS,
      prepare: () => {
        throw new Error('D1 down');
      },
    },
  };
  const lines: string[] = [];
  const sink = log.sink;
  log.sink = (_level, line) => lines.push(line);
  try {
    const response = await call(broken, '/api/config', { headers: { Authorization: 'Bearer session-token-from-the-app' } });
    expect(response.status).toBe(401);
  } finally {
    log.sink = sink;
  }
  expect(lines.some((line) => line.includes('session_check_failed'))).toBe(true);
});
