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

Bind the CityRealty workflow as `CITYREALTY_SYNC` with workflow name `apartment-cityrealty-sync` and class `CityRealtySync`. This lets a full refresh finish after the initiating request returns.

The two `apartment_object*` tables implement the app's versioned snapshot storage with transactional compare-and-swap. The separate `rental_listing_*` tables preserve the imported listing history. Keep a saved snapshot's original observation timestamp during a migration so the frontend can label its freshness correctly.
