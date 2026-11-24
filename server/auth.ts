/**
 * Sign-in with Better Auth: you type your email, get a one-time code by email, and type it in. Only the
 * emails in ACCESS_ALLOWED_EMAILS can sign in; others get no code and no account. The web app keeps the
 * session in a cookie; the native app keeps the session token and sends it as a bearer token.
 * Better Auth stores users, sessions, codes and rate limits in the app's D1 database (deploy/cloudflare/migrations/).
 */
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';
import { log } from './log.ts';

type SendEmail = { send(message: { from: string; to: string[]; subject: string; text: string; html: string }): Promise<unknown> };
/** The settings sign-in reads. */
export type AuthEnv = {
  /** Secret: signs sessions. Sign-in is off without it. */
  BETTER_AUTH_SECRET?: string;
  APP_ORIGIN?: string;
  /** "true" lets anyone create an account with their email; otherwise only ACCESS_ALLOWED_EMAILS can. */
  OPEN_SIGNUPS?: string;
  ACCESS_ALLOWED_EMAILS?: string;
  /** The Email Service binding and sender that alerts use, which also send the codes. */
  ALERT_EMAIL?: SendEmail;
  ALERT_EMAIL_FROM?: string;
};
/** A database Better Auth accepts: D1 in the Worker, bun:sqlite in tests. */
export type AuthDatabase = NonNullable<BetterAuthOptions['database']>;

export const AUTH_BASE_PATH = '/api/auth';
const CODE_MINUTES = 10;

/** The allowed emails, lowercased. */
/**
 * Whether an email may sign in: anyone when OPEN_SIGNUPS is "true" (a new account starts on the free plan),
 * otherwise only the addresses in ACCESS_ALLOWED_EMAILS.
 */
export function mayUseEmail(env: Pick<AuthEnv, 'ACCESS_ALLOWED_EMAILS' | 'OPEN_SIGNUPS'>, email: string) {
  return env.OPEN_SIGNUPS === 'true' || allowedEmails(env).includes(email.toLowerCase());
}

export const allowedEmails = (env: Pick<AuthEnv, 'ACCESS_ALLOWED_EMAILS'>) =>
  (env.ACCESS_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

/** Better Auth's settings for this app. The schema generator and tests use them too, so all three match. */
export function authOptions(env: AuthEnv, database: AuthDatabase) {
  const allowed = { has: (email: string) => mayUseEmail(env, email) };
  const origin = env.APP_ORIGIN?.replace(/\/$/, '');
  return {
    database,
    secret: env.BETTER_AUTH_SECRET,
    basePath: AUTH_BASE_PATH,
    ...(origin ? { baseURL: origin, trustedOrigins: [origin] } : {}),
    // Sessions last 30 days; a signed cookie spares most requests a database read.
    session: { expiresIn: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60, cookieCache: { enabled: true, maxAge: 5 * 60 } },
    // Limits are kept in the database, so they hold across Worker isolates.
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 30,
      customRules: { '/email-otp/send-verification-otp': { window: 60, max: 3 } },
    },
    databaseHooks: {
      user: {
        create: {
          // No account for an email that is not allowed, however the request got here.
          async before(user) {
            if (!allowed.has(user.email.toLowerCase())) throw new APIError('FORBIDDEN', { message: 'This email cannot sign in.' });
            return { data: user };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_MINUTES * 60,
        allowedAttempts: 3,
        async sendVerificationOTP({ email, otp, type }) {
          // Codes go only to allowed emails; anyone else is told nothing, so the form cannot test which emails are allowed.
          if (type !== 'sign-in' || !allowed.has(email.toLowerCase())) return;
          if (!env.ALERT_EMAIL || !env.ALERT_EMAIL_FROM) {
            log.error('sign_in_email_unavailable', new Error('ALERT_EMAIL and ALERT_EMAIL_FROM must be set to send sign-in codes.'));
            return;
          }
          const text = `Your Walkup sign-in code is ${otp}. It expires in ${CODE_MINUTES} minutes.`;
          await env.ALERT_EMAIL.send({
            from: env.ALERT_EMAIL_FROM,
            to: [email],
            subject: 'Your Walkup sign-in code',
            text,
            html: `<p>Your Walkup sign-in code is <strong>${otp}</strong>.</p><p>It expires in ${CODE_MINUTES} minutes.</p>`,
          });
        },
      }),
      // The native app sends its session token as a bearer token.
      bearer(),
    ],
  } satisfies BetterAuthOptions;
}

export const createAuth = (env: AuthEnv, database: AuthDatabase) => betterAuth(authOptions(env, database));
export type Auth = ReturnType<typeof createAuth>;

/** The signed-in user's email when the request has a valid session for an allowed email, otherwise null. */
export async function sessionEmail(auth: Auth, env: AuthEnv, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  const email = session?.user.email.toLowerCase();
  return email && mayUseEmail(env, email) ? email : null;
}
