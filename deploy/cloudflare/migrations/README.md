# D1 migrations

Each file changes the schema once, in order. Wrangler records the ones applied in the database's
`d1_migrations` table, and the deploy workflow applies any new ones before deploying the Worker.

- Add a change: `node ./node_modules/wrangler/bin/wrangler.js d1 migrations create apartment-search-observations "what it does" -c deploy/cloudflare/wrangler.jsonc`, then write the SQL.
- Apply locally: `bun run db:local`. The unit tests and the workerd check build their databases from these files too.
- Never edit a file that has been applied; add a new one.
- Sign-in tables come from `bun scripts/auth-schema.ts`; a test checks the migrations create every table the auth settings need.
