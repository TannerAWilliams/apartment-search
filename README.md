# Apartment Search

Search New York–area rentals from many listing sites in one place, and compare them by asking rent and weekday-morning commute to your workplace. One Expo app runs on the web, iPhone and Android; the web app and its API run on Cloudflare.

Areas: all of New York City (Manhattan, Brooklyn, Queens, the Bronx, Staten Island), New Jersey, Long Island, Westchester County, the wider Metro-North region (Westchester, Rockland, Putnam, Dutchess and Orange counties), Connecticut and eastern Pennsylvania. Boroughs and Westchester are matched by county, or by ZIP code when a source gives no county.

[docs/features.md](docs/features.md) describes each feature and its limits. [docs/nyc-rental-sources.md](docs/nyc-rental-sources.md) catalogs every NYC rental source considered and why each is or isn't connected.

## Architecture

```
browser ──▶ apartments.5thof6.com ── Cloudflare Access sign-in
              │  Cf-Access-Jwt-Assertion (signed token)
              ▼
          apartment-search Worker, a Hono app (server/cloudflare.ts), checks the token (server/access.ts)
              ├── web app files ── Workers Static Assets (web-build/)
              ├── /api/* ── server/api.ts (Hono routes, Valibot request checks)
              ├── D1 apartment-search-observations ── one snapshot per source (server/d1-bucket.ts)
              └── Workflow apartment-cityrealty-sync ── complete syncs: CityRealty → Openigloo → Zumper

your computer ── scripts/sync-streeteasy.ts ── uploads the StreetEasy inventory daily (workers.dev URL, app token)
```

- **One Worker, two ways in.** `server/cloudflare.ts` serves the web app and the API at `apartments.5thof6.com` and its workers.dev URL. Every request, including the web app's files, needs one of:
  - a **Cloudflare Access sign-in**, with a passkey (Face ID or Touch ID) or an emailed one-time code. Sessions last 24 hours. Access signs a token for each request it lets through. The Worker verifies it against the team's published keys (issuer, audience, expiry, signature) and allows only the emails in `ACCESS_ALLOWED_EMAILS`. Workers with Static Assets don't receive `ctx.access`, so the Worker checks the token itself. Changes from a signed-in browser must come from the app's own pages (same `Origin`).
  - the **app access token** (`Authorization: Bearer <APP_ACCESS_TOKEN>`), for scripts such as the StreetEasy home sync.

  Every response carries `Strict-Transport-Security` (HTTPS only, for a year). `/health` returns `ok` to a signed-in caller.
- **Storage.** Each source's inventory, status and price history is one versioned snapshot in D1 (`apartment_objects` and `apartment_object_parts`, see `deploy/cloudflare/schema.sql`). Writes use etag compare-and-swap, so a failed or overlapping refresh never replaces saved data. Only current listings are kept, with no records of past listings.
- **Refreshes happen only when you ask.** Opening the app reads saved inventory and fetches nothing, and nothing runs on a schedule in Cloudflare. **More → Sources & sync** resyncs one source or all of them. Sources that take minutes (CityRealty, Openigloo, Zumper) run in the Workflow, one durable step at a time; the page polls their progress every 15 seconds. A source that failed with a retry time is skipped until that time passes. The only scheduled job is the StreetEasy sync on your own computer.
- **StreetEasy** refuses requests from cloud hosts (HTTP 403), so a computer you own downloads it and uploads it to the Worker (see [Daily StreetEasy sync](#daily-streeteasy-sync-from-your-own-computer)).
- **Static data.** The web app's files are served with a Content Security Policy and other security headers (`server/web-headers.ts`); fingerprinted bundles are cached for a year, everything else is revalidated. The 2.4 MB StreetEasy dashboard archive is published with the static files (`public/data/`) rather than built into the Worker, read through the assets binding when a dashboard series is first opened, checked against its SHA-256, and never served directly.
- **Logs.** Unexpected failures and failed source checks are written as one JSON object per line (`server/log.ts`) to [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), with source maps so stack traces point at the TypeScript. Look for the `event` field: `request_failed`, `storage_read_failed`, `dashboard_read_failed`, `source_check_failed`, `complete_sync_failed`, `alert_check_failed`, `alert_email_failed` or `alert_push_failed`; `alerts_sent` and `web_vital` record alerts and real-user performance.
- **Alerts.** Saved alerts (`server/alerts.ts`) are checked after each resync you start, after the sync Workflow, and after the StreetEasy upload from your computer, never on a schedule. Each alert's matches are compared with its last check, and new apartments and price drops go out by email (Cloudflare Email Service) and as notifications (standard Web Push with VAPID keys and encrypted messages, `server/web-push.ts`) to every device that turned them on.
- **Installable app.** The web app has a manifest, icons (`public/`) and a service worker (`web/`), so it can be added to the Home Screen; iPhone notifications need that. The service worker caches nothing, so the app always loads current code and listings.
- **Performance.** Screens other than search load on first use: the map, rent charts, alerts, tours, comparison, sources and import. The web build also leaves out the offline snapshot, which only native builds and the Worker use. Real visits report Core Web Vitals to Workers Logs (`src/web-vitals-report.ts`, using Google's `web-vitals`), and `bun run perf` runs a Lighthouse audit (below).

- **API.** The routes are a [Hono](https://hono.dev) app (`server/api.ts`): `config`, `search`, `search-check`, `refresh`, `market`, `housing`, `dashboard`, `building-report`, `geocode`, `alerts` and `vitals`, all under `/api/`. Each route checks its input with a [Valibot](https://valibot.dev) schema (`server/api-inputs.ts`; search filters in `src/search.ts`, which the app uses too) and answers a mismatch with a 422 naming the first problem. Every POST must be JSON (`Content-Type: application/json`), which also stops cross-site form posts, and within its size limit (4 KB, or 2 MiB for an authenticated source import). Hono infers each reply's type from the routes, and `test/api-contract.ts` fails the type check if a reply stops matching what the app reads.

## Listing sources

| Source | What the app imports |
| --- | --- |
| StreetEasy | All active rentals from the v6 API, uploaded by the [daily sync on your own computer](#daily-streeteasy-sync-from-your-own-computer). Searches are split into price ranges to stay inside the 1,000-result window, overlapping matches are deduplicated, and counts must reconcile with StreetEasy's reported total before inventory is replaced. It stops after 160 requests or 20,000 listings. |
| CityRealty | Every page of the public rental search, with active listings and addresses checked against their detail pages. Runs in the Workflow. |
| Openigloo | All active NYC rentals from its search interface (about 5,800 in November 2026). The search returns at most ten results, so the sync splits each borough and bedroom count by rent, and by neighborhood where listings share a price, a second apart. It saves only when at least 98% of the reported inventory is usable. Runs in the Workflow. |
| Zumper | Every individually priced apartment in the five boroughs, Jersey City, Hoboken, Newark, Hempstead, Huntington, Yonkers, White Plains, New Rochelle, Stamford, Norwalk and Greenwich, paging each market until Zumper reports no more, a second per page. Buildings shown as one entry with a price range are counted but not saved. Runs in the Workflow. |
| Apartments.com | Individually identified units with exact rents from the first two search pages for one- and two-bedroom rentals in each borough. Building-wide price ranges are excluded. |
| HotPads | A bounded exact-unit sample from NYC, Jersey City and Stamford. |
| Zillow, Compass, RentHop, Realtor.com | Public search adapters with documented regional samples. Provider errors show in Sources. |
| Apartment List | Identified NYC units marked available now on its first search page. |
| Redfin | Active, individually identified units from its public NYC search. |
| Trulia | The first two pages of one- and two-bedroom searches in the five boroughs and the same outer markets as Zumper. |
| AffordableHousing.com | Apartments available now from the first two pages in each borough, geocoded with the free U.S. Census batch geocoder. |
| NYC Housing Connect | Advertised rental lotteries from [NYC Open Data](https://data.cityofnewyork.us/d/vy5i-a666), shown in the Affordable tab. |
| FirstMover Open Data | The monthly [FirstMover](https://www.firstmovernyc.com/open-data) snapshot behind the rent charts and dated listings. |
| Rent.com, Apartment Guide, Craigslist, Facebook Marketplace, Linecity, Settled.nyc | Browse links only; not counted as listing feeds. |
| Authorized partner feeds | Optional, see [Partner feeds](#partner-feeds). |

A sample source replaces only the listings it confirmed; earlier units stay as cached with their original check dates until a complete check replaces them. Failed sources are reported, never filled in.

## Develop

Requires [Bun](https://bun.sh) 1.4.4 for the app, tests and scripts, and Node.js 22.12 or later for Wrangler, whose local server does not run under Bun.

**Languages and runtimes.** Every source file is TypeScript, checked in strict mode, with no `any` and no comments that switch the checker off. JSON from the network, storage or a request is `unknown` until the code checks it (`types/strict-json.d.ts`). `test/typed-codebase.test.ts` fails if a JavaScript or shell file, an `any` or a suppression comes back. Bun runs everything outside production: the tests (`bun test`), the service worker build (`Bun.build`), the scripts (Bun Shell, `Bun.file`, `Bun.spawn`) and the browser tests' web server (`Bun.serve`). In production the Worker runs on Cloudflare's own runtime, workerd, not on Bun, and the two differ in places (workerd refuses `fetch` with `redirect: 'error'`, for example). `bun run test:workerd` runs the built Worker in workerd and calls its main routes, and the test setup refuses what workerd refuses. Wrangler, Cloudflare's tool for local development and deploys, is the one part that needs Node.js.

```sh
bun install --frozen-lockfile
bun run db:local     # once: create the D1 tables in the local database
bun run dev          # build the web app and serve it at http://localhost:8787
```

`bun run dev` runs the real Worker locally with Wrangler, a local D1 database and a local Workflow, and sets `PUBLIC_APP=true` so the browser needs no token. Local data stays in `deploy/cloudflare/.wrangler/`. Put optional local credentials in `deploy/cloudflare/.dev.vars` (copy `.dev.vars.example`; Git ignores it). Rebuild after changing the app with `bun run build:web`; Wrangler reloads server changes itself.

`bun run start`, `bun run ios` and `bun run android` open the app in Expo. A native build reaches the API through `EXPO_PUBLIC_API_URL` and asks for the access token.

| Variable | Where | Purpose |
| --- | --- | --- |
| `ACCESS_ALLOWED_EMAILS` | Worker secret | Required for browser sign-in: comma-separated emails Access may let in. Kept out of the repository. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | `wrangler.jsonc` vars | The Access team domain and the application's audience tag. Sign-in is off unless these and the emails are set. |
| `APP_ACCESS_TOKEN` | Worker secret | The token scripts send, such as the StreetEasy home sync. |
| `TRAVELTIME_APP_ID`, `TRAVELTIME_API_KEY` | Worker secrets | Optional commute estimates. |
| `FREE_PARTNER_FEEDS_JSON` | Worker secret | Optional authorized feeds. |
| `STREETEASY_SYNC_ENABLED` | Worker variable | `false` pauses StreetEasy refreshes; saved data stays. |
| `STREETEASY_PUBLIC_SEARCH` | Worker variable | `true` checks the first page of StreetEasy's public search when no feed is configured. |
| `APP_ORIGIN` | `wrangler.jsonc` vars | The app's address, for links in alerts. |
| `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | `wrangler.jsonc` vars | Web Push identity for alert notifications. |
| `VAPID_PRIVATE_KEY` | Worker secret | Its private key. `bun scripts/vapid-keys.ts \| wrangler secret put VAPID_PRIVATE_KEY` makes a new pair and prints the public key. |
| `ALERT_EMAIL` binding, `ALERT_EMAIL_FROM` | `wrangler.jsonc` | Email alerts, once Email Routing is on for 5thof6.com; see [Email alerts](#email-alerts). |
| `PUBLIC_APP` | Worker variable | `true` opens the app without a token (local development). Anonymous callers can then request checks but never upload listings, and writes must be same-origin. |

## Test

```sh
bun run typecheck
bun run test             # unit and integration tests; external network is blocked
bun run test:coverage    # fails below 98% of lines or 96% of functions
bun run test:e2e         # typecheck, web build, unit tests, then Playwright
bun run test:workerd     # the built Worker in Cloudflare's runtime (bun run build:web first)
bun run build            # web build plus a Wrangler dry-run bundle of the Worker
bun run perf             # Lighthouse audit of the running app (bun run dev first); fails below its budgets
```

The test preload (`test/fixtures/offline-network.ts`) blocks external requests, so provider tests use synthetic responses and never refresh a real source; `test/fixtures/quiet-logs.ts` keeps the expected failure logs out of the report. D1 is tested against SQLite with the production schema (`test/fixtures/fake-d1.ts`), and the Workflow and Worker entry are tested with a stub of `cloudflare:workers`.

Coverage measures the application modules: every `.ts` file in `server/` and the non-UI files in `src/`. `test/module-coverage.test.ts` loads them all, so an untested module counts against the total. React UI modules are covered by the Playwright suite instead, which runs the exported web app with mocked API responses on desktop, Android-size and iPhone-size Chromium layouts. Its server sends the production security headers, and `e2e/fixtures.ts` fails any test whose page breaks the Content Security Policy. `scripts/coverage-scope.ts` holds the rules. Bun does not report branch coverage.

GitHub Actions (`.github/workflows/ci.yml`) runs the typecheck, unit tests with coverage, the build and the browser tests on every pull request and every push to main. It uses no secrets and deploys nothing.

## Deploy

Deploy from GitHub: **Actions → Deploy → Run workflow** (`.github/workflows/deploy.yml`). It runs the typecheck and unit tests, then builds and deploys. It needs the repository secret `CLOUDFLARE_API_TOKEN`, an API token made from Cloudflare's "Edit Cloudflare Workers" template. It only runs when you start it.

To deploy from your own computer instead:

```sh
node ./node_modules/wrangler/bin/wrangler.js login     # or set CLOUDFLARE_API_TOKEN
bun run deploy                                          # build the web app and deploy the Worker
```

`deploy/cloudflare/wrangler.jsonc` defines the Worker, its static assets, the D1 binding, the Workflow (limited to one run at a time) and a 30-second CPU limit. Before the first deploy from this file, compare it with the live Worker's settings (routes, workers.dev) so the deploy changes only code. Set secrets with `wrangler secret put NAME -c deploy/cloudflare/wrangler.jsonc`. Apply schema changes to the production database with `wrangler d1 execute apartment-search-observations --remote --file deploy/cloudflare/schema.sql -c deploy/cloudflare/wrangler.jsonc`; the schema only creates missing tables.

The Cloudflare Access application for `apartments.5thof6.com` (who may sign in, and how) is configured in Zero Trust; the Worker's custom domain and its check of the Access token are in this repository. Before the first deploy from this file, set the `ACCESS_ALLOWED_EMAILS` secret, or nobody can sign in.

### One-time move off the gate Worker

`apartments.5thof6.com` used to be served by a separate gate Worker, `apartment-search-access`, which checked the Access sign-in and forwarded requests with the app token. This Worker now does that itself. To switch:

1. `wrangler secret put ACCESS_ALLOWED_EMAILS -c deploy/cloudflare/wrangler.jsonc` with the email you sign in with.
2. Nothing to detach first: a deploy from GitHub Actions (or any non-interactive run) moves `apartments.5thof6.com` off `apartment-search-access` itself. An interactive `wrangler deploy` asks first.
3. Run the Deploy workflow (or `bun run deploy`), which attaches the domain to `apartment-search`. The Access application on the hostname keeps protecting it.
4. Open `apartments.5thof6.com`, sign in, and check that search works.
5. Delete `apartment-search-access` and its `APARTMENT_BACKEND_KEY` secret.

## Email alerts

Notifications work as soon as the Worker is deployed. Email needs two settings in Cloudflare first, because Email Service only sends from a domain with Email Routing, and free sends go to verified addresses:

1. Email → Email Routing → enable it for `5thof6.com`. The domain has no mail records today, so nothing else changes.
2. Email Routing → Destination addresses → add the address you sign in with, then open the verification email Cloudflare sends.
3. In `deploy/cloudflare/wrangler.jsonc`, add `"send_email": [{ "name": "ALERT_EMAIL" }]` and the variable `"ALERT_EMAIL_FROM": "alerts@5thof6.com"`, then deploy.

Alerts → **Send a test alert** checks both channels.

## Daily StreetEasy sync from your own computer

Cloud hosts, including the Worker, get HTTP 403 from StreetEasy, so the sync runs on a computer you own and uploads the result. It downloads the complete partitioned inventory with ordinary requests, requires the count to reconcile with StreetEasy's reported total, uploads it through the authenticated `/api/refresh` import, and then confirms the saved count.

One-time setup on a Mac or Linux computer that is usually on (Bun 1.4.4 required):

```sh
git clone https://github.com/TannerAWilliams/apartment-search.git && cd apartment-search
bun scripts/install-streeteasy-schedule.ts --origin=https://apartment-search.<subdomain>.workers.dev
```

Use the Worker's own URL, not `apartments.5thof6.com`, which needs an interactive Access sign-in. The installer asks for the Worker's `APP_ACCESS_TOKEN` and stores it in the macOS Keychain (or `~/.config/apartment-search/token`, mode 600, on Linux). It runs daily at 6:17 local time (`SYNC_HOUR` and `SYNC_MINUTE` change this); on a Mac, a run missed while asleep happens at wake. Logs go to `~/Library/Logs/apartment-search-streeteasy.log` or `~/.config/apartment-search/streeteasy.log`. Run it now with `bun scripts/streeteasy-daily.ts` (add `--manual` to fetch even when saved data is under a day old), and remove it with `bun scripts/install-streeteasy-schedule.ts --uninstall`. If you installed the daily sync before it moved from shell scripts to TypeScript, run the installer again once; it replaces the old job.

Failures leave saved listings unchanged. The runner skips work when saved StreetEasy data is under a day old, respects the source retry time, retries once if the inventory moves during the download, and refuses an upload above the Worker's 2 MiB request limit rather than sending a truncated one. The import was about 1.9 MB in November 2026, so a much larger inventory will need a larger limit. If StreetEasy starts refusing your home connection too, the run fails with that status in the log.

## Partner feeds

Set `FREE_PARTNER_FEEDS_JSON` to an array of approved no-cost HTTPS endpoints. Configure a feed only when you have permission to use and display it. Each item needs a unique `id`, a `name` for a custom source, a `url` and an optional bearer `token`; use IDs from `src/marketplaces.ts` for a platform badge.

The endpoint returns a JSON array or `{ listings, next, total }`, where `next` is a same-origin HTTPS URL (absolute or relative) or null on the last page, and the optional `total` counts all source rows. Each row has an ID, `status: "Active"`, `addressLine1`, a unit if known, `city`, `state`, `county`, `zipCode`, `bedrooms` (studio = 0) and monthly `price`, plus optional numeric `latitude` and `longitude`, `neighborhood`, `updatedAt`, an HTTPS `listingUrl` and the discovery facts in [docs/features.md](docs/features.md#discovery-facts). A reported partial feed, a broken page chain, a count mismatch, or more than 40 pages or 25,000 rows fails without replacing saved data. A feed with `id: "streeteasy"` powers the StreetEasy resync button; it needs a reconciled `total` and original StreetEasy links. CityRealty (`cityrealty`), Brown Harris Stevens (`bhs`), CitySnap (`citysnap`), Craigslist (`craigslist`) and the companies in the NYC directory can use the same contract.

For an approved REBNY RLS or other RESO Web API feed, use `format: "reso-web-api"` with the authorized Property endpoint and bearer token (`id: "rebny-rls"` for REBNY). The adapter reads OData `value`, `@odata.nextLink` and optional `@odata.count`, and imports active residential leases that allow listing and address display.

### Complete StreetEasy export

A provider with an authorized export of the entire active StreetEasy inventory can be added as:

```json
[{"id":"streeteasy","format":"streeteasy-complete-export-v1","url":"https://provider.example/active-rentals.json","token":"optional-provider-bearer-token"}]
```

The StreetEasy resync button then makes one HTTPS request without redirects or pagination. The response is one JSON object with `schema: "streeteasy-complete-export-v1"`, `scope: "all-markets"`, `complete: true`, a UTC ISO `generatedAt`, an exact integer `total`, and `listings` using the partner-feed fields with a unique numeric string `id`, active status and an absolute StreetEasy `listingUrl`. Limits are 25,000 rows and 16 MiB of decoded JSON. An export 12 hours old, future-dated, older than the saved one or failing validation cannot replace saved inventory.

## Rebuild the offline data

The rent charts and dated listings use the [FirstMover Open Data Project](https://github.com/benfwalla/firstmover-open-data-project); its license is at `src/data/FIRSTMOVER-LICENSE.txt`. The bundled data contains addresses, unit identifiers, asking rents, neighborhoods, coordinates, posting dates and source URLs, without photos or descriptions.

```sh
bun scripts/update-market.ts /path/to/2026-10.csv 2026-10         # monthly snapshot
bun scripts/update-rent-history.ts /path/to/months/20*.csv         # rent trend history
bun run test && bun run build
```

## Repository layout

| Path | Contents |
| --- | --- |
| `App.tsx`, `index.ts`, `src/` | The Expo app. Non-UI modules in `src/` (search, regions, listings, market data) are shared with the server. |
| `server/` | The Worker: `cloudflare.ts` entry (sign-in, static files), `api.ts` routes and `api-inputs.ts` request schemas, `refresh.ts` source orchestration, one module per source, `d1-bucket.ts` storage, `sync-workflow.ts` and `source-registry.ts` for the complete syncs. |
| `public/` | Files copied into the web build unchanged: `index.html` template, manifest, icons (`scripts/make-icons.ts`) and the StreetEasy dashboard archive, which only the Worker reads. |
| `web/` | The notification service worker in TypeScript, checked against the browser's service worker types and built to `sw.js` by `scripts/build-service-worker.ts`. |
| `types/` | `strict-json.d.ts`: JSON reads return `unknown` in every project. |
| `deploy/cloudflare/` | `wrangler.jsonc`, `schema.sql` and `.dev.vars.example`. |
| `scripts/` | The StreetEasy home sync and its installer, offline data rebuilds, the workerd smoke test, the Lighthouse audit and the coverage report. All run with Bun. |
| `test/`, `e2e/` | Bun unit and integration tests, and the Playwright suite ([e2e/README.md](e2e/README.md)). |
| `docs/`, `investigations/` | Feature and source references, and dated research notes. |
| `cloudflare/streeteasy-container-test/` | A one-off StreetEasy probe for Cloudflare Containers. Not deployed. |
