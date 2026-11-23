# Cloudflare configuration

- `wrangler.jsonc`: the `apartment-search` Worker. Its entry is `server/cloudflare.ts`, which Wrangler bundles. It serves `web-build/` as static assets, binds the D1 database as `APARTMENTS` and the sync Workflow as `SYNC_WORKFLOW`, attaches the custom domain `apartments.5thof6.com` (behind Cloudflare Access) and keeps workers.dev for scripts, and runs every request through the Worker first so sign-in also protects the web app's files.
- `schema.sql`: the two D1 tables. `apartment_objects` holds one versioned snapshot per key (a source's inventory and price history, refresh status, caches), and `apartment_object_parts` splits large snapshots into rows. Writes are conditional on the snapshot's etag. Nothing keeps records of past listings; the earlier `rental_listing_*` and `source_observations` tables were dropped on 2026-11-20.
- `.dev.vars.example`: local values for `bun run dev`.

The Workflow (`server/sync-workflow.ts`) runs CityRealty, then Openigloo in 25 search steps plus a save step, then Zumper. A resync of one source runs only that source. Its concurrency limit of one is set in `wrangler.jsonc`. Keep its name, `apartment-cityrealty-sync`, and class, `CityRealtySync`: renaming creates a new Workflow and leaves the existing instances behind.

When migrating saved data, keep each snapshot's original observation timestamp so the app labels its freshness correctly.

Setup, local development and deployment are in the [main README](../../README.md#develop).
