# Cloudflare configuration

- `wrangler.jsonc`: the `apartment-search` Worker. Its entry is `server/cloudflare.ts`, which Wrangler bundles. It serves `web-build/` as static assets, binds the D1 database as `APARTMENTS` and the sync Workflow as `CITYREALTY_SYNC`, and runs every request through the Worker first so the access token also protects the web app's files.
- `schema.sql`: the two D1 tables. `apartment_objects` holds one versioned snapshot per key (a source's inventory and price history, refresh status, caches), and `apartment_object_parts` splits large snapshots into rows. Writes are conditional on the snapshot's etag. Nothing keeps records of past listings; the earlier `rental_listing_*` and `source_observations` tables were dropped on 2026-11-20.
- `.dev.vars.example`: local values for `bun run dev`.

The Workflow (`server/cityrealty-workflow.ts`) runs CityRealty, then Openigloo in 25 search steps plus a save step, then Zumper. A resync of one source runs only that source. Keep its name, `apartment-cityrealty-sync`, so existing instances stay readable.

When migrating saved data, keep each snapshot's original observation timestamp so the app labels its freshness correctly.

Setup, local development and deployment are in the [main README](../../README.md#develop).
