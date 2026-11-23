# Cloudflare configuration

- `wrangler.jsonc`: the `apartment-search` Worker. Its entry is `server/cloudflare.ts`, which Wrangler bundles. It serves `web-build/` as static assets, binds the D1 database as `APARTMENTS` and the sync Workflow as `SYNC_WORKFLOW`, attaches the custom domain `apartments.5thof6.com` and keeps workers.dev for scripts, and runs every request through the Worker first so sign-in is checked before the API answers.
- `migrations/`: the D1 schema, one numbered migration per change, applied in order by the deploy (see `migrations/README.md`). `listing_snapshots`, `listings` and `price_history` hold each source's latest check, one row per listing and per unit's prices; `apartment_objects` and `apartment_object_parts` hold smaller versioned documents (refresh status, rent charts, caches); the rest are sign-in tables. Writes are conditional on a version tag. Nothing keeps records of past listings.
- `.dev.vars.example`: local values for `bun run dev`.

The Workflow (`server/sync-workflow.ts`) runs CityRealty, then Openigloo in 25 search steps plus a save step, then Zumper. A resync of one source runs only that source. Its concurrency limit of one is set in `wrangler.jsonc`. Keep its name, `apartment-cityrealty-sync`, and class, `CityRealtySync`: renaming creates a new Workflow and leaves the existing instances behind.

When migrating saved data, keep each snapshot's original observation timestamp so the app labels its freshness correctly.

Setup, local development and deployment are in the [main README](../../README.md#develop).
