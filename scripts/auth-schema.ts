#!/usr/bin/env bun
/**
 * Prints the SQL for Better Auth's tables (users, sessions, accounts, sign-in codes and rate limits), from
 * the app's own auth settings, so the migrations in deploy/cloudflare/migrations/ can create them. Run after changing server/auth.ts:
 *   bun scripts/auth-schema.ts
 */
import { Database } from 'bun:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../server/auth.ts';

export async function authSchema() {
  const { compileMigrations } = await getMigrations(
    authOptions({ BETTER_AUTH_SECRET: 'schema-only-secret-'.padEnd(40, 'x') }, new Database(':memory:')),
  );
  return (await compileMigrations())
    .trim()
    .replaceAll('create table', 'create table if not exists')
    .replaceAll('create index', 'create index if not exists');
}

if (import.meta.main) await Bun.write(Bun.stdout, await authSchema());
