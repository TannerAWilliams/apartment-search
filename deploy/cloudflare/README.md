# Cloudflare deployment

The Worker serves the Expo web app with Workers Static Assets. The existing API reads and writes D1 through the shared bucket interface. The Cloudflare entrypoint uses direct provider requests, so it does not require the Render listing relay.

Build with Bun 1.4.4.

```sh
bun install --frozen-lockfile
bun run build:web
mkdir -p dist/cloudflare
bun build deploy/cloudflare/private.ts --target=node --format=esm --minify --external cloudflare:workers --outfile=dist/cloudflare/private.mjs
```

Apply `schema.sql` to the D1 database. Bind it as `APARTMENTS` and bind `web-build` as `ASSETS`. Enable `nodejs_compat`, route all requests through the Worker to protect assets and API requests, and use `private.mjs` as the entrypoint with an `APP_ACCESS_TOKEN` secret for staging.

Bind the listing refresh Workflow as `CITYREALTY_SYNC` with workflow name `apartment-cityrealty-sync` and class `CityRealtySync`. The legacy binding also serves Openigloo and Zumper. Keep its concurrency at one. The app persists the active Workflow ID in the existing D1 bucket, so an interrupted browser session does not start another crawl or lose the job. There is no new D1 schema migration.

The two `apartment_object*` tables implement the app's versioned snapshot storage with transactional compare-and-swap, and are the only tables. Each source's snapshot holds its current listings and their price history only; nothing keeps records of past listings. (The earlier `rental_listing_*` and `source_observations` tables were dropped on 2026-11-20.) Keep a saved snapshot's original observation timestamp during a migration so the frontend can label its freshness correctly.

## Refresh rollout checklist

- Check for active or queued instances of the existing Workflow before switching versions. Time-bucket IDs from the old Worker are not registered in D1; wait for any such jobs to reach a terminal state before accepting refreshes on the new build.
- Compare routes, bindings, CPU limits, and observability with the running Worker before deploying. Preserve the existing access policy and StreetEasy pause. Do not treat the checked-in Wrangler limits as approval to increase the live CPU limit or enable logs.
- In an isolated test, start Openigloo, check the recorded job ID after four minutes, reload the app, and verify the same run remains visible. Verify the source timestamp advances only when a successful import is published. An incomplete run must retain the previous snapshot.
- There is no Cloudflare cron in this release. Before adding one, qualify checkpointed batches under the intended plan's [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/) and provider pacing. A schedule alone does not make a full run fit the Free plan.
