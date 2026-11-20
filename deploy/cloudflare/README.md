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

Bind the CityRealty workflow as `CITYREALTY_SYNC` with workflow name `apartment-cityrealty-sync` and class `CityRealtySync`. Set its concurrency to one and the Worker's `limits.cpu_ms` to `5000` for the full-inventory refresh.

The two `apartment_object*` tables implement the app's versioned snapshot storage with transactional compare-and-swap, and are the only tables. Each source's snapshot holds its current listings and their price history only; nothing keeps records of past listings. (The earlier `rental_listing_*` and `source_observations` tables were dropped on 2026-11-20.) Keep a saved snapshot's original observation timestamp during a migration so the frontend can label its freshness correctly.
