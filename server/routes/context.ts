/**
 * What every API route shares: the context type, the Hono factory that creates route groups and middleware
 * with it, and the request helpers. See server/api.ts for how the routes are put together.
 */
import { bodyLimit } from 'hono/body-limit';
import { createFactory, createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv, Bucket } from '../contracts.ts';
import type { D1Database } from '../storage/d1-bucket.ts';
import type { ArchiveLoader } from '../dashboard-snapshot.ts';
import type { SourceFetch } from '../contracts.ts';

export type SyncJob = { start(delay: boolean, sources?: string[]): Promise<void>; pending(): Promise<string | boolean | null> };
/** What a request can use besides the settings and storage. The Worker entry passes the real ones; tests pass stand-ins. */
export type ApiServices = {
  /** Signed in with an email code or the app access token. */
  privateAuthenticated: boolean;
  /** The email of the person signed in with an email code, so the app can offer to sign out. */
  account?: string | null;
  fetcher: SourceFetch;
  /** Runs work after the response is sent: the Worker's `ctx.waitUntil`. */
  waitUntil?: (work: Promise<unknown>) => void;
  syncJob?: SyncJob;
  /** Reads the StreetEasy dashboard archive, which is kept out of the Worker script. */
  dashboardArchive: ArchiveLoader;
  /** The D1 database, for the market history tables. Absent where there is no database. */
  database?: D1Database;
};
export type ApiVariables = { appEnv: AppEnv; services: ApiServices };
export type ApiEnv = { Variables: ApiVariables };

/** Creates the API's route groups and middleware, typed with ApiEnv. */
export const factory = createFactory<ApiEnv>();

/** An error reply: `{ error }` with the given status. */
export const fail = <S extends ContentfulStatusCode>(c: Context, status: S, error: string) => c.json({ error }, status);

type Checked = { success: boolean; issues?: readonly { message: string }[] };
/** A validator hook that refuses input not matching the route's schema, with the first problem. */
export const refuseWith =
  <S extends ContentfulStatusCode>(status: S) =>
  (result: Checked, c: Context) =>
    result.success ? undefined : fail(c, status, result.issues?.[0]?.message ?? 'Check the request and try again.');
export const refuse = refuseWith(422);

const REQUEST_LIMIT = 4096;
const IMPORT_LIMIT = 2 * 1024 * 1024;
/** The Content-Type Hono's JSON validator reads; any other body would reach the handler as {}. */
const JSON_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

/**
 * A POST body is JSON, within the route's size limit (Hono's body-limit middleware), so a body that is too
 * large is refused before the route reads it. Requiring the JSON type also stops cross-site form posts.
 */
export const jsonBodies = (limit: (path: string) => number) =>
  createMiddleware(async (c, next) => {
    if (!JSON_TYPE.test(c.req.header('Content-Type') ?? '')) return fail(c, 400, 'Send a JSON request.');
    const limiter = bodyLimit({ maxSize: limit(c.req.path), onError: (c) => fail(c, 413, 'The request is too large.') });
    // Reading a body that breaks off fails before the route runs; errors from the route itself are Hono's to handle.
    let reached = false;
    try {
      return await limiter(c, () => {
        reached = true;
        return next();
      });
    } catch (cause) {
      if (reached) throw cause;
      return fail(c, 400, 'Send a JSON request.');
    }
  });
/** The API's limits: 2 MiB for a source import, 4 KB for everything else. */
export const apiBodies = jsonBodies((path) => (path === '/api/refresh' ? IMPORT_LIMIT : REQUEST_LIMIT));

/** Routes that need saved storage refuse without it, before reading the request; their handlers get it as `c.var.bucket`. */
export const needsStorage = (message: string) =>
  createMiddleware<ApiEnv & { Variables: { bucket: Bucket } }>(async (c, next) => {
    const bucket = c.var.appEnv.BUCKET;
    if (!bucket) return fail(c, 400, message);
    c.set('bucket', bucket);
    return next();
  });
