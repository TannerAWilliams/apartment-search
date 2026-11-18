# Apartment Search

The homepage defaults to saved active inventory from all connected providers across all regions, with no bedroom or rent cap. The manual StreetEasy button requests the full active inventory before applying search filters. Other providers and charts retain their documented source-specific coverage.

Compare rentals by asking rent and weekday-morning transit or driving time to your workplace. The same Expo app runs on mobile web, iPhone, and Android. The built-in search, listing links, and rent chart require no paid API or API key.

## Listings and platforms

| Source | What the app imports |
| --- | --- |
| StreetEasy | The StreetEasy v6 sync requests all active rentals without an area filter on explicit request. It partitions searches into bounded price ranges to stay within the observed 1,000-result search window, deduplicates overlapping gross/discounted-rent matches, and requires counts to reconcile before replacing inventory. It stops after 160 requests or 20,000 reported listings. Sync status shows the number received and the reported inventory. The separate [FirstMover Open Data](https://www.firstmovernyc.com/open-data) monthly snapshot supplies the rent charts and dated listings. |
| Apartments.com | Individually identified, available units with exact asking rents from the first two public search pages for one- and two-bedroom rentals in each borough. Building-wide price ranges are excluded. |
| HotPads | A bounded exact-unit sample from NYC, Jersey City and Stamford. Building summaries and rent ranges are excluded. |
| Openigloo | A bounded live sample from its published NYC search interface. The app requests up to ten results per borough and bedroom count (one and two bedrooms), without a rent cap. |
| Zillow, Compass, RentHop, and Realtor.com | Connected public search adapters. Refresh now attempts their documented regional samples; they are no longer disabled as feed-only sources. Provider errors remain visible in Sources. |
| Apartment List | Identified NYC units marked available now on its first public search page. Community starting prices and future availability are excluded. |
| Redfin | Active, individually identified units from its public NYC search results. Community prices and rent ranges are excluded. |
| Trulia | The first two pages of each Manhattan and Brooklyn one- and two-bedroom search, without a rent cap. |
| Zumper | Individual apartments with exact prices from the first two public search pages and the first low-price sort page in each borough. |
| AffordableHousing.com | Apartments marked available now from the first two pages in Manhattan and Brooklyn. The importer uses the free U.S. Census batch geocoder when coordinates are available by exact address. |
| Rent.com, Apartment Guide, Craigslist, Facebook Marketplace, Linecity, and Settled.nyc | Browse links until a working data connection is established. These are not counted as successful listing feeds. |
| NYC Housing Connect | [NYC Open Data](https://data.cityofnewyork.us/d/vy5i-a666) advertised rental lotteries. The Affordable tab shows application dates, building addresses, and bedroom counts. |
| Authorized no-cost partner feed | Optional. Configure a feed only when you have permission to use and display it at no API cost. The bundled public sources require no feed credentials. |

**Listing websites** shows direct source and saved links for a unit, followed by separate address searches. An address search can surface multiple units in a building. Matching known units uses the normalized street, ZIP, state, and unit number. A shared building address alone does not merge apartments. The **Available rentals** view and map show only apartments reported active in a recently checked source. The **Listing company** filter and company coverage cards use the advertiser field from the dated snapshot, including Compass, SERHANT., Corcoran, Douglas Elliman, Brown Harris Stevens, and other NYC brokerages and managers. Company-site links are separate from the original ad URL supplied by each source. Save or add Manhattan and Brooklyn listings separately. The saved list stays on the current device.

Snapshot prices are from when the rentals first appeared in the month. Check the original website or another exact-unit link for current availability or price. Map popups list the known exact-unit links. Separate address searches open Google results for the named site. Use More → Rental platforms to browse Manhattan and Brooklyn. Transit and driving directions open in Google Maps. Edit the workplace to use a different preset, coordinates, or a full street address. The default workplace is Rockefeller Center.

Results default to **Lowest rent** among available rentals. **Lowest rent**, **Fastest transit**, and **Fastest drive** sort all matching rentals before limiting the displayed list. Use **Import CSV** to add up to 500 collected listings per file to this device’s Saved list. The header is `url,address,unit,city,state,zip,bedrooms,rent` with optional `county,neighborhood,latitude,longitude` columns. Use studio = 0, five-digit ZIPs, and plain numeric rents. Coordinates are optional and support map placement when provided.

## Commute estimates

Open **Commute**, choose your workplace, and optionally enter maximum transit and driving minutes. When both limits are set, a rental must meet both. Searches calculate typical weekday-morning trips from geocoded rentals to work using the [TravelTime matrix](https://docs.traveltime.com/api/reference/time-filter-fast), with no live-traffic guarantee. Estimates over three hours and routes the provider cannot find appear as unavailable.

Set `TRAVELTIME_APP_ID` and `TRAVELTIME_API_KEY` on the server to enable automatic estimates when the app opens or runs a search. The app only sends coordinates to the routing provider. When routing is disconnected, the app keeps ordinary rent and map search available and hides the commute limits.

## Refresh sources

The private hosted app checks FirstMover’s published monthly exports, the city’s Housing Connect export, and the active rental sources above. The FirstMover check uses the publisher’s release links and conditional requests for the CSV. Housing Connect listings reflect the city’s published export and application dates. The Affordable tab also links to official Mitchell-Lama and Section 8 resources. Settled.nyc feed access is unverified.

Opening the browser reads saved inventory immediately and starts a source check, including StreetEasy when its daily cache is due. A fresh server process with no saved inventory first attempts the limited Openigloo startup check described below. **More → Sources & sync** holds per-source and all-source resync controls, import, freshness and coverage details. Every implemented provider stays visible in the website filters even before its first successful sync. Retry limits still apply. The default search includes saved active observations with their original check dates, labelled as last saved results when a refresh fails or expires. It excludes dated historical export rows. API callers can omit `includeCached` for strictly recent inventory. Rent charts continue to use dated snapshots.

The Bun server acknowledges refresh jobs immediately and the page polls progress. Each completed source publishes its inventory and status independently; relay warmup only affects StreetEasy and HotPads. A failed page in a bounded public sample no longer discards other successful pages. Missing pages are counted explicitly; previously saved units are retained as cached with their original observation dates until a complete source check replaces them. StreetEasy and configured complete partner feeds keep their strict inventory validation. No recurring task, paid service, or provider access bypass is added.

On native Render hosting, set `LISTING_FETCH_TRANSPORT=direct` to use the app's own server requests instead of requiring a second sleeping Render service for StreetEasy and HotPads. Existing relay settings are preserved for an explicit switch back to `relay`. This changes only the app's retrieval path and does not establish provider access when the upstream rejects the host.

The private app also serves a manual Bun refresh runner at `/_refresh-runner.mjs`. Download it through owner-only service access and pass the service credential on stdin. Keep the credential out of files, command arguments, and logs.

## Rent chart

Compare six months of median initial asking rents for studios through four bedrooms. Choose a neighborhood, borough or city, or ZIP, and pin up to two areas to compare with your selection. Choose **By bedroom** for the latest snapshot’s size breakdown. Each value includes its listing count, and months with missing observations appear as gaps. The chart uses all included rentals for the selected area, independent of the search budget and commute filters.

The market chart uses the dated public snapshot so a small live sample cannot skew area medians. It excludes entire houses, townhouses, and commercial or land records where the source identifies them. Duplicate source links and confirmed units are consolidated. The source coverage is NYC and parts of North Jersey. Switch to **Saved listings** to chart rentals you collected in other areas. That chart summarizes the saved list, whose prices can come from different dates.

### Rebuild the offline snapshot

Download a monthly CSV from [FirstMover Open Data](https://www.firstmovernyc.com/open-data). Use Python 3 to regenerate the compressed offline dataset, then rebuild the app.

```sh
bun scripts/update-market.ts /path/to/2026-10.csv 2026-10
bun run test
bun run build
```

The data comes from the [FirstMover Open Data Project](https://github.com/benfwalla/firstmover-open-data-project). Its license is included at `src/data/FIRSTMOVER-LICENSE.txt`. The bundled data contains addresses, unit identifiers, asking rents, neighborhoods, coordinates, posting dates, and source URLs. Photos and listing descriptions are excluded.

Run `bun scripts/update-rent-history.ts /path/to/months/20*.csv` with dated FirstMover CSVs to rebuild the offline trend data. Hosted refreshes retain the previous month’s medians when a new monthly release arrives.

## Run locally

Use Bun 1.4.4.

```sh
bun install --frozen-lockfile
bun run build:web
bun run dev
```

Open http://127.0.0.1:3000. Run `bun run start` to open the app in a compatible Expo Go build. Use `bun run ios` or `bun run android` for a simulator or emulator. The public snapshot, chart, and saved list work offline. A signed App Store or Play Store build uses the owner's store and signing setup.

A custom address is sent to the [free U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) when submitted to the server. Addresses are not persisted by the server. Native builds can use a preset or coordinates offline. To connect a native build to your own geocoding server or authorized free feeds, set `EXPO_PUBLIC_API_URL` to your server origin. For a LAN test set `HOST=0.0.0.0`, use the computer's LAN IP and port, and configure a random `APP_ACCESS_TOKEN` of at least 24 characters if serving free partner feeds. Enter that token in the app when prompted. Use HTTPS on a remote server.

### Optional free partner feed

Set `FREE_PARTNER_FEEDS_JSON` in the server environment to an array of approved no-cost HTTPS endpoints. Each item needs a unique `id`, a `name` for a custom source, a `url`, and an optional bearer `token`. Use IDs from `src/marketplaces.ts` for a platform badge. The endpoint returns a JSON array or an object with `listings`. A paginated feed returns `{ listings, next, total }` where `next` is an HTTPS URL on the same origin (absolute or relative), or null on the last page. Optional `total` counts all source rows, including those excluded by normalization. A reported partial feed, invalid page chain, count mismatch, or refresh over 40 pages or 25,000 rows fails without replacing the last saved snapshot.

Each row supplies an ID, `status: "Active"`, `addressLine1`, a unit if known, `city`, `state`, `county`, `zipCode`, `bedrooms` (studio = 0), and monthly `price`. Include numeric `latitude` and `longitude`, `neighborhood`, `updatedAt`, and an HTTPS `listingUrl` for the original listing. Only source URLs supplied by the feed are presented as direct links. Page counts describe the supplied feed, whose coverage may be smaller than the source website's inventory. On hosted deployments, a configured feed with `id: "streeteasy"` powers the existing StreetEasy check on page open and the StreetEasy resync button. It requires a reconciled `total` and original StreetEasy listing links. The partner feed follows the same daily refresh interval. An incomplete refresh preserves the last saved inventory.

CityRealty (`cityrealty`), Brown Harris Stevens (`bhs`), CitySnap (`citysnap`), Craigslist (`craigslist`), and the companies in the NYC directory can use this contract once their provider supplies an authorized feed. Until then, their browse links and connection status are available without adding inventory to search.

For an approved REBNY RLS or other compatible RESO Web API feed, use `format: "reso-web-api"` with the authorized HTTPS Property endpoint and its bearer token. For REBNY, use `id: "rebny-rls"`. The adapter reads OData `value`, `@odata.nextLink`, and optional `@odata.count` and imports active residential leases that allow listing and address display. Ask the provider for an active-rental query and a feed scoped to your licensed market so the snapshot fits the pagination limit. If the provider supplies its `ListingURL` field, the original link appears on the listing. CitySnap and CityRealty draw on REBNY data, so adding an RLS feed provides a distinct source named REBNY RLS.

## Verify

```sh
bun run test
bun run typecheck
bun run build:web
bun ./node_modules/expo/bin/cli export --platform ios --platform android
```

`bun run build` also packages the web bundle and server into the private hosted Worker.


### StreetEasy access and completeness

A successful HTTP response is not proof of a complete sync. The v6 endpoint can
report thousands of rentals but return empty pages beyond its search window.
The importer checks each partition and the final unique-ID count, rejects
conflicting duplicate records, and preserves the last snapshot when a check fails.

Server-side fetching is required: the API did not allow this app's origin in its
CORS preflight response during the November 12, 2026 check. Browser-like headers
were not needed for successful command-line requests. The hosted Worker still
received HTTP 403 in the same check. This loader fix does not establish that
StreetEasy permits access from every hosting network. A browser or external
sync worker requires its own verified deployment and unattended access; OCR,
spoofed headers, or a successful first page do not establish complete coverage.


Set `STREETEASY_PUBLIC_SEARCH=true` to check the first page of the public NYC and New Jersey rental search when no StreetEasy partner feed is configured. This checks one page with ordinary HTTP and serves only supported rows marked active. The source shows the page count and provider-reported total separately, and keeps older observations as cached if they were not confirmed in the sample. An error or access denial is surfaced normally.

Set `STREETEASY_SYNC_ENABLED=false` to pause StreetEasy listing refreshes. Saved records and historical charts remain available.

### Complete StreetEasy export

If a provider gives you a current, authorized export of the entire active StreetEasy inventory, add one entry to `FREE_PARTNER_FEEDS_JSON`:

```json
[{"id":"streeteasy","format":"streeteasy-complete-export-v1","url":"https://provider.example/active-rentals.json","token":"optional-provider-bearer-token"}]
```

Configure the real URL and optional token as server settings, not in source control. With this format the StreetEasy resync button makes one HTTPS request without redirects or pagination. App open checks the export when the saved data reaches 12 hours old. The provider must generate an export at least twice a day; the app measures age from the provider timestamp, even when a file is downloaded again.

The response must be one JSON object with `schema: "streeteasy-complete-export-v1"`, `scope: "all-markets"`, `complete: true`, a UTC ISO timestamp `generatedAt`, an exact integer `total`, and `listings`. Use the listing fields from the partner-feed contract above, a unique numeric string `id`, active status, and an absolute original StreetEasy `listingUrl` for every row. No pagination, duplicate IDs, inactive rows, or partial exports are allowed. A genuine complete zero-row export is valid. Limits are 25,000 rows and 16 MiB of decoded JSON. A file 12 hours old, future-dated, older than the saved export, or failing validation cannot replace saved inventory. An HTTP response compressed via standard `Content-Encoding` is supported by the HTTP client.

This is the app's input contract for an authorized provider. Matching the count verifies delivery of the declared snapshot. Confirm the provider's actual coverage and display permission when setting up the connection.

### External StreetEasy recovery runner

The owner-only Site serves `/_streeteasy-sync.mjs`. On an authorized Bun 1.4.4
host with StreetEasy access, this runner downloads complete partitioned inventory
and submits it through the authenticated import endpoint, then verifies saved
counts. Pass a current owner service credential through stdin, not a command
argument or a committed file. Use the host's approved secret delivery mechanism.

Pass `--manual` to fetch on demand even when saved data is less than a day old. This mode updates only StreetEasy. No daily automation is needed or installed. The browser button calls the hosted Worker, which can use the configured authenticated Render relay described below. Without that relay, StreetEasy may reject the Worker with HTTP 403. Failed refreshes preserve stored listings. The runner respects retry times, retries inventory
movement once, and does not solve CAPTCHAs or bypass authentication. Non-manual recovery
affects only missing, failed, or day-old StreetEasy inventory; stale or incomplete receipts are rejected.
The runner requires an accessible external host and credential delivery for each manual invocation. Publishing this file does **not** connect that host to the browser button. No daily schedule is configured.

### Sources and manual refresh

More → Sources & sync lists connected feeds and browse-only websites separately. It shows each source's last fetch attempt, last successful saved data, counts, coverage and failure. Individual resync targets only that source; Resync all connected providers respects source retry limits. Browse-only websites have disabled resync controls until a feed is configured. No automatic daily schedule is installed.

Trulia and Zumper now include bounded Jersey City and Stamford samples alongside Manhattan and Brooklyn. These are explicitly samples, not exhaustive NY/NJ/CT coverage.

### Optional free listing relay

`server/relay-service.ts` runs on a Render Free web service using Bun-compatible built-in APIs:
`bun server/relay-service.ts` (Bun 1.4.4). It keeps no data.
Configure a random `LISTING_RELAY_TOKEN` secret of at least 32 characters on Render.
Configure the same secret and `LISTING_RELAY_URL` on the private Site. The Site then
routes only StreetEasy search pages and the three supported HotPads pages through
Render. No browser receives the secret. All other sources use their existing path.
The relay cannot fetch arbitrary URLs, follows no redirects, limits response size,
concurrency and hourly requests, and preserves upstream failures/rate limits.
Render Free sleeps when idle; the Site wakes it before starting short source timers.
The first refresh may take an extra minute. Normal source cooldowns and inventory
completeness checks still apply; a failed source never replaces its previous data.
This is not a guarantee of permanent provider access or exhaustive coverage for
sources other than the count-reconciled StreetEasy API. No scheduled job is added.



## Full app on Render Free

The Bun entrypoint can serve the complete web UI and API with a temporary,
single-process listing cache. Build with `bun install --frozen-lockfile && bun run build:web`, then run
`bun server/main.ts` with `HOST=0.0.0.0` and a random
`APP_ACCESS_TOKEN` of at least 32 characters in Render's secret environment.
Render supplies `PORT` and `RENDER_EXTERNAL_URL`. Do not put the access password
in source, URLs or logs. Reveal it from your own Render Environment dashboard to
sign into the private form; the browser receives a Secure, HttpOnly, SameSite
session cookie. `/health` reveals only liveness; listings and assets require auth.
POST `/logout` clears the session cookie; rotating the access password invalidates
all sessions.

**Temporary means temporary:** cached listings, refresh timestamps and rent
chart refreshes reset on service restart, redeployment or free-service sleep.
Saved apartments remain device-local. The homepage reads saved inventory without
refreshing providers from the browser; an empty server process makes one Openigloo startup attempt. Further checks start from More → Sources & sync.
Failed providers are reported rather than fabricated. Render does not
remove provider CAPTCHAs or guarantee StreetEasy/HotPads access. The previous
Sites deployment and its saved data are not deleted by this deployment.

Render Free can sleep after 15 idle minutes and take about a minute to wake.
The free instance-hours and build/bandwidth quotas are workspace-wide. No paid
database, persistent disk or paid worker is provisioned by this app.

### Public Render browsing

Set `PUBLIC_APP=true` to explicitly enable public browsing without a login. Keep
`APP_ACCESS_TOKEN` server-side for trusted imports; never add it to the browser.
Anonymous visitors may request source refreshes but cannot upload listing data.
POST requests must be same-origin. The single Render process limits anonymous
API traffic to 240 requests/minute and source refresh initiation to once/minute
across all visitors, returning HTTP 429 with `Retry-After` when busy. These are
basic resource limits, not a bot-proof security boundary; a non-browser client
can spoof Origin. Limits reset on restart and are not distributed across replicas.
Public access does not make a blocked provider available, remove CAPTCHAs, or
promise complete inventory. The independent Sites deployment stays private.

## UI design target

Design new and changed screens mobile-first for Tanner's iPhone 17 in portrait (approximately 402 CSS pixels wide), while retaining usable desktop layouts. Keep primary actions and navigation within the viewport, avoid horizontal page overflow, use readable text and touch-friendly controls, and let longer forms/lists scroll vertically. Treat the visible height as variable because browser chrome and the on-screen keyboard change it.

This is a design preference, not a requirement to run every build or automated test on an iPhone 17. Use proportionate layout review and existing regression checks; optional device-emulation tests must not block unrelated work. Do not describe Chromium emulation as physical-device or Safari verification.



## Mobile browsing

Search opens saved inventory in a list, with compact cards and optional Map view. Filters open in a dismissible sheet; Search, Saved, and More stay reachable at the bottom. More → Sources & sync contains explicit resync controls and CSV/manual import. Browser navigation does not refresh providers; an empty server startup makes one Openigloo attempt. Sources retains detailed last-attempt, last-success, partial-coverage and error information. Card Details expands directions and provenance; missing or conflicting data is not guessed.

### Durable PostgreSQL inventory (optional)

Set `DATABASE_URL` in the Bun service's secret environment to use an existing
PostgreSQL database instead of the temporary memory bucket. The app creates the
`apartment_objects` table if needed. Source payloads, metadata and conditional-write
ETags survive server restarts; competing writers serialize quota checks and publish
whole objects atomically. A database connection/schema failure stops startup rather
than silently switching to an empty temporary cache. `/api/config.storageMode`
reports `persistent`, `temporary`, or `none`.

Use a provider connection string with verified TLS according to its documentation;
do not disable certificate verification. No database, account, paid plan or secret
is provisioned by this code. Enabling this does not migrate the old in-memory inventory: a new database starts
empty. Export/import any authorized inventory before switching, or perform a fresh
manual sync; never imply old data was transferred. Render's existing service remains temporary until an
operator supplies a durable database connection. Backups and restore verification
remain the database operator's responsibility. This does not fix provider 403s,
make stale listings fresh, or add scheduled refresh behavior.

`test/postgres-bucket.test.ts` exercises real embedded PostgreSQL through PGlite,
including on-disk reopen, conditional writes, quota rollback, immutable input and
connection failures. This is not verification of a hosted PostgreSQL server, TLS,
network failures or multi-process production load. Run the full suite and a hosted
database recovery check before production rollout.

Saved apartments now include explicit-save notes and viewing status in Details. These are device-local, not cross-device sync. Notes are retained when an apartment is removed and become visible if the same apartment is saved again; clearing the notes and saving removes their text. Failed reads do not overwrite existing notes. Unsaved edits are lost when details close. Browser storage can still be cleared by the user or browser. The notes Playwright scenario is authored but browser execution is pending in a browser-capable runner.

#### Observed listing price history
Successful manual refreshes of direct rentals, Openigloo samples, and configured feeds now record source-specific price observations in the **same stored snapshot** as the inventory. Failed validation, provider failures, or failed snapshot writes do not replace either inventory or history. This begins with future successful refreshes; it is not retroactive market data. The history tracks first/last observed checks and price or fee-basis changes. Missing units remain unknown, never automatically marked rented or delisted, because sources can be incomplete. There are no automatic notifications or scheduled fetches.

Retention is bounded to the 24 most recent price changes per source/unit identity and 20,000 most recently observed identities per source; truncation is labeled in stored data. Units absent from a later sample retain their observation records until retention evicts them. Listing Details displays the recorded observation timeline, first/last checks, fee basis, and retention warning. Listings without valid recorded history show an explicit empty state. It survives restarts only with durable storage configured; the default temporary bucket does not provide durability. Existing snapshots without history start clean. Historical snapshot feeds (FirstMover) and affordable-housing opportunities are not mixed into these observed asking-price histories.

Source snapshots use etag compare-and-swap: an overlapping refresh whose source object changed cannot overwrite the winning inventory/history, even after the global refresh lease expires. Older observation timestamps are rejected, including empty snapshots. Duplicate source/unit observations are rejected rather than recording contradictory same-check prices. The 20,000-unit retention bound applies to the archived history map; current inventory still includes each current listing's bounded history. This is conservative observation tracking, not an authoritative listing-availability ledger.

#### Optional structured discovery facts
Configured feeds can supply `bathrooms` (positive half-step count through 20), `squareFeet` (positive through 100,000), `petsAllowed` (strict boolean), and `laundry` (`in_unit`, `in_building`, or `none`). Missing or invalid values remain unknown, not false or zero. No amenities are inferred from descriptions, addresses, or photos. Listing Details shows reported facts and unknown labels; Filters can require minimum bathrooms/area, explicitly allowed pets, and a reported laundry category. All selected requirements must match, excluding units with unknown required facts. Restrictions and measurement accuracy still need landlord verification. This does not imply existing providers supply these fields; many current results will remain unknown. Photo collection/display is not added because there is no established licensed media input. Existing source links remain the way to inspect provider photos.

When independent sources disagree on a known feature, that feature becomes unknown, does not satisfy a requirement, and a conflict notice is shown. Unknown preferred-source facts are not filled from an alternate source without field-level provenance. Newer observations from the same source can replace older facts without inventing an independent-source disagreement. Minimum bathrooms is a threshold, not an exact-bathroom match.
Discovery merging treats overlapping multi-source records as ambiguous: without field-level provenance, only matching single-source identities are considered definite same-source updates. Conflicting known facts in every other merge become unknown rather than silently selecting one source's claim.

#### Private cross-device shortlist foundation (NOT enabled)
`server/private-shortlist.ts` provides an **unmounted** service boundary, not working end-user sync. It refuses requests without a configured verifier and store. The existing public mode and app-wide access password/session do not identify individual people and MUST NOT be used as the verifier. No production routes, permissions, accounts, credentials, or data migrations were changed.

Before wiring it, provide an identity adapter that cryptographically verifies bearer tokens against an explicitly trusted issuer, expected audience, signing keys/algorithm, expiration and applicable token constraints. Return the verified issuer and subject only, never an unverified decoded claim or caller-provided ID. Add the actual login/token lifecycle on web/native clients, revocation/logout behavior, and issuer integration tests. Provide a dedicated durable private-data store and deployment-specific per-user rate limits/quotas; review data retention, backups, and operational access before storing real notes. The current factory's injected test verifier is a synthetic fixture, not that production adapter.

The foundation scopes keys by verified issuer+subject, ignores caller identity, returns private/no-store responses, uses revision-conditional writes to reject stale-device overwrites with 409, and does not use cookies. Payloads are limited to 256 KiB and 100 explicitly shaped entries with 2,000-character notes. Unknown rent/bedroom values can remain null. It does not auto-upload existing device data or send notifications. Before enabling sync, present the destination and obtain the user's chosen migration action; preserve unsynced local data on conflict or failure. The `compare` field is a stored selection flag only; cross-device comparison UI is not implemented.

#### Device-local comparison
The Saved tab includes **Compare saved apartments**. Select up to four, search saved addresses/units/cities/ZIPs, and scroll the comparison horizontally on small screens. Columns show recorded price and fee basis, bedrooms, reported features, check date, unknown values and conflicts. Selection is temporary and clearing it does not remove saved apartments. It makes no provider requests and does not upload notes or saved data. This is a comparison of saved observations, not live availability or guaranteed all-in lease costs; use the separate cost estimator with confirmed fees. Cross-device comparison remains disabled pending real individual authentication and private storage.

#### Commute context and safe comparison
When the existing configured TravelTime integration returns estimates, they now carry the actual destination coordinates/label, weekday-morning arrival period, provider and query timestamp. Details and saved comparison show that context; legacy raw durations without destination metadata remain unknown in those views. Different destinations are not comparable, and saved estimates are not live traffic guarantees. Missing/invalid origins have stale route fields cleared and never inherit another unit's route. Provider snapshot refreshes discard supplied route metadata so inventory cannot manufacture user-specific route estimates.

No routing account, paid plan or credentials were created and no provider requests were made while implementing this change. Route tests and the new Playwright case use explicitly synthetic fixtures. Automatic estimates still require the existing routing configuration; directions links remain available when disconnected.

Latest combined Node validation (commute-context batch): 200 passing tests; loaded-module coverage 95.95% lines, 90.36% branches, 92.90% functions. This is **not whole-app coverage**: unimported TSX UI and browser/native execution are outside this instrumentation. Forty-eight desktop/mobile Playwright cases are authored/discoverable, but execution in this workspace remains blocked before assertions by Chromium socket restrictions. Physical-device and cross-browser verification remain outstanding. Do not describe these figures as 90% integration/mobile/interaction scenario coverage.

#### Opt-in local observed-change check
Search now has a **Local price and discovery changes** panel. Pressing its check button explicitly creates or updates a device-local baseline for eligible observations on the current result page. It never refreshes providers, polls in the background, requests browser notifications, or sends email/push. The first check establishes a baseline; later checks show newer same-source price changes, changed fee bases, and units newly encountered by this device. Newly encountered does not mean newly listed or available; missing results are never labeled rented/delisted. Fee-basis changes are not called savings. Unknown, mismatched and older observations are excluded.

The baseline retains up to 2,000 source/unit identities and labels truncation; evicted units can later be newly encountered again. Failed reads/writes show an error rather than confirmed changes. This is a manual local comparison, not a reliable cross-tab/cross-device monitoring system or notification subscription; device storage can be cleared, and concurrent tabs can overwrite local baselines. Use one tab for a sequence of checks. The UI examines only the loaded result page, not all inventory.

The local-change panel batch supersedes the preceding test count: 207 Node tests pass; loaded-module coverage is 96.00% lines, 90.66% branches and 92.97% functions. Fifty desktop/mobile Playwright cases are discoverable but remain execution-blocked. The same whole-app/UI/native coverage limitations apply.

### Real PostgreSQL verification (disposable local instance)
Run `TEST_POSTGRES_URL='postgresql://test_runner@127.0.0.1:55432/postgres' bun run test:postgres` against a disposable local PostgreSQL instance. The harness refuses missing URLs, remote hosts, query overrides and fragments, creates a random test-owned schema, and removes only that schema. It never targets existing application tables. Do not supply production credentials or point this at a production database. This separate command is not silently skipped by the default Bun suite.

Verified locally on real PostgreSQL 18.6 using pinned `@embedded-postgres/linux-x64@18.6.0-beta.19` binaries obtained from npm in a disposable workspace (not added as a project dependency): all three integration tests passed, including independent connection pools, 20 competing conditional updates, conditional creation, concurrent quota enforcement and rollback. A separate process stop/start probe verified snapshot bytes, ETag and metadata survived PostgreSQL restart. Synthetic test schemas were removed and the disposable server stopped. This validates the adapter against a real PostgreSQL server, not hosted deployment configuration, backups, remote TLS or production migration. No hosted database was provisioned and no unrelated production data or credentials were used.

### Bun 1.4.4 runtime migration

Install official Bun 1.4.4; `.bun-version`, `packageManager`, and the server/test runtime checks pin that exact release. Use `bun install --frozen-lockfile`. `bun.lock` replaces the npm lockfile. All first-party build, serve, test and Playwright commands explicitly use Bun, including child HTTP servers; no Node executable is required by the verified web workflow. Compatibility imports such as `node:fs`, `node:crypto` and their types refer to APIs implemented by Bun, not a Node process. Auxiliary runner bundles use `Bun.build` with target `bun`; the hosted Worker and its integration fixture use target `browser`. Expo Metro remains responsible for React Native/web application bundles.

Verification on Bun 1.4.4: 212 unit/integration tests passed; typecheck, Expo web export and Worker bundle passed with a failing `node` executable trap (no invocation). Three additional tests passed against disposable real PostgreSQL 18.6. Playwright discovered 50 desktop/mobile-web cases via Bun; discovery is not execution and does not establish native iOS/Android coverage.

`bun run test:coverage` records Bun LCOV and checks at least 90% lines and functions **in loaded authored server/src/scripts modules**. This run measured 2,861/3,052 lines (93.74%) and 464/504 functions (92.06%). The report explicitly excludes the generated data-URL Worker fixture bundle and test preload, not authored modules. Unloaded React UI and entrypoints remain outside this scope. Bun does not emit a branch metric here; older Node branch percentages elsewhere in this document are historical, not evidence for this runtime. Full-app 90% coverage is not claimed.

Expo's upstream native project creation/prebuild still documents a Node requirement for template extraction. Those workflows are not part of this verified Bun-only web pipeline, and native builds/device tests have not been completed. Do not silently install or fall back to Node to run them. Existing hosted services remain unchanged: configure their future build as `bun install --frozen-lockfile && bun run build:web`, start as `bun server/main.ts`, and pin `BUN_VERSION=1.4.4` before a separately verified deployment. No deployment or production permissions were changed by this migration.

The default test preload blocks external HTTP fetch before transport and prevents redirect following. Provider tests use explicit synthetic transports; tests never authorize a live provider refresh. Test HTTP subprocesses preload the same guard.

PostgreSQL now uses Bun’s native `SQL` pool, not `pg`. A reserved connection keeps each explicit transaction, table lock, CAS check and quota check together; release is awaited even after rollback. Values remain bound parameters, including text-to-jsonb metadata conversion. Connection acquisition and server statements are bounded. URL TLS settings are honored, never overridden to disable verification; configure certificate-verified TLS for any hosted deployment. Real-server tests verify independent pools, immutable byte/metadata recovery, 20 competing conditional writers and quota rollback with this native driver.

Native Bun features used: `Bun.serve` for HTTP, `Bun.file` for static responses and coverage input, `Bun.Glob` and `Bun.write` for packaging, `Bun.build` for auxiliary runners/Worker and test fixture, `Bun.SQL` for PostgreSQL, `bun:test` and Bun coverage, and Bun package/lock management. The HTTP port retains per-route incremental byte caps, secure headers, origin checks and cookie authentication. Body reads keep a 30-second idle timeout; authorized API responses receive a bounded 180-second allowance for the existing 120-second source budget. Static GET/HEAD/traversal and method behavior are regression-tested.

No redundant Worker threads, Redis, SQLite mirror or extra response cache were added: there is no measured CPU bottleneck, cross-device SQLite would be the wrong storage model, and private responses intentionally remain no-store. `Bun.password` is not a substitute for constant-time bearer-secret comparison or signed session verification; the existing security primitives remain. Native iOS/Android platform toolchains and browser binaries are external requirements, not JavaScript runtime replacements. Native SQL also passed an actual PostgreSQL stop/start persistence probe, including bytes, ETag and metadata; the isolated schema was removed and server stopped.

### Building due diligence and explainable best fit

Apartment details include an official-record review panel with the building address, explicit unmatched/unknown status and links to NYC HPD Online, DOB building-history instructions (BIS plus DOB NOW), HPD violations and complaints/problem datasets, HPD bedbug annual-report guidance and NYC flood maps. Opening a listing’s Details automatically retrieves a bounded official building report through the app server; no lookup button is required. Before checking, or when matching fails, findings remain unknown. It never asserts a clean bill of health. Complaints are reports rather than issued violations, and complaint-problem rows are not distinct complaints. Non-NYC or unestablished jurisdiction gets no inferred NYC result. Sources were checked against official NYC pages on 2026-11-17; no paid service or provider contact is involved.

“Best fit: rent + commute” is an opt-in transparent ordering, not a safety or quality assessment. The More filters panel accepts a rent weight from 0 to 100; commute receives the remainder. The default is 60/40 and saved search presets retain the selection. With default weights it awards up to 60 points for rent savings relative to the maximum-rent filter (explicit $5,000 reference when unset) and 40 for a matching TravelTime weekday-morning commute estimate relative to the selected time limit (explicit 60-minute reference when unset). Transit is used unless only a driving limit is set. The estimate must have validated metadata and exactly match the selected destination coordinates; unknown/mismatched routes get no points. Straight-line distance is never substituted. Each component uses `weight × max(0, 1 − value/reference)`. Scores, formula and estimate check time appear on ranked cards. Estimates may be old and are not live traffic. Existing requirements remain hard filters. No route is requested just to rank, no fees/subscriptions are activated, and unknown data is not a favorable assumption. Asking/recorded rent is not all-in cost. Ties use rent then ID. No demographic, school, crime or building-safety variables affect ordering.

### Device-local tour planner
The Saved tab's **Plan apartment tours** creates personal tentative appointments for saved apartments, with a date, device-local time, 5–240-minute duration, notes and a viewing checklist. Up to 30 tours are saved on the current device. Loading failures do not overwrite existing plans; writes are serialized within one component. Use one tab: concurrent tabs can overwrite tour edits. Edit, remove, manually order stops or sort appointments chronologically. Overlap warnings check appointment durations only and do not include travel time. Changing route order does not change appointment times.

The explicit Google Maps walking-route link includes 2–5 stops, preserving their displayed order without optimization. It sends those addresses to Google only when opened; unsupported or overlong routes have no link. No routing API is called or paid for. Select the route day in device time; only that day’s stops enter the route. Day selection does not remove appointments or change calendar exports.

Web exports an RFC5545 `.ics` file containing tentative calendar events, addresses, notes and checklist. Import is manual; it does not book appointments, contact brokers, send invitations or modify any calendar. Native builds can share the calendar text; native file import is not implemented. Device timezone is displayed, stored times are absolute UTC and calendar exports retain those instants. Verify times when changing timezones. Plans are local only, not cross-device or server-synced; clearing browser/device storage removes them. Removing a saved apartment does not silently remove its planned tour.

Validation: focused unit tests and TypeScript check passed. Browser scenario is authored; browser/native execution remains unverified. No production deployment performed.

### Saved searches and whole-search checks
Search now offers named device-local presets (up to ten), Apply, Remove, and an explicitly initiated **Check all matches** action. Each preset has its own observation baseline. Saving picks validated filter fields only, not access tokens or results pagination. Presets/observations stay on the device; no background timer, browser notifications, push/email subscription or cross-device upload is installed. Removing a preset does not remove saved apartments or notes. Use one tab; local storage does not provide concurrent-tab compare-and-swap.

The `/api/search-check` read endpoint scans all matching cached inventory before pagination. It requires a configured bucket, never fetches feeds/geocodes/routes, rejects commute-time requirements and unresolved workplace addresses, rejects searches above 2,000 matches instead of saving a partial result, and rejects running/overlapping source refreshes by refresh-state ETag. Coordinates and built-in workplace presets work without network access. Only matching records with validated server-recorded price histories enter comparisons; the UI separately reports total matches and usable histories. Provider samples can be partial/stale, so this is **all matching cached records**, not complete market coverage. Absence never implies rented/delisted. First checks seed baselines; later checks distinguish price changes from fee-basis changes and newly encountered units. Up to 2,000 prior observations are retained per preset with explicit eviction warnings. Storage/read/request failures do not confirm changes or advance a baseline.

Verification for this addition: synthetic unit/API tests cover filters, no-network behavior, changes beyond the first 100, stable snapshot checks, corrupted reads, limits and isolated baselines. A desktop/mobile Playwright scenario is authored for saving, reloading, checking all 101 fixture records, applying and removing a preset; execution must be verified separately. No claim of reliable ongoing alerts is made.

### Combined November 17 feature validation

All three additions were integrated against main `bce9550`: 236 Bun tests, TypeScript, Expo web export and the hosted Worker bundle passed. Loaded authored-source coverage was 94.14% lines and 92.67% functions; this excludes unloaded UI and does not establish whole-app or branch coverage. Playwright discovers 54 desktop/mobile-web scenarios, but execution is blocked before assertions by the current Chromium socket/sandbox environment. No browser/native pass is claimed. This branch is not deployed. Render build/start migration, live provider access, hosted storage and individual cross-device authentication remain separate unfinished work.


### Automatic official building reports

The building panel calls `/api/building-report` automatically when listing Details opens. It sends the public listing's building address, city/county/state and ZIP to fixed NYC Open Data endpoints, without credentials or personal notes. An exact house number, street and ZIP must identify exactly one **active** entry in HPD's Buildings Subject to HPD Jurisdiction dataset, and borough evidence must be consistent. Case/whitespace are normalized; aliases, nearby addresses and street-suffix expansions are not guessed. Ambiguity, mismatched identity and unsupported jurisdiction produce no findings. HPD coverage is not universal, so an unmatched building does not imply no problems.

The matched HPD **building ID**, not BIN or BBL, joins open Housing Maintenance Code violations and unique complaint IDs in the Complaints and Problems dataset. Complaints are grouped by ID so several problem rows do not multiply a complaint. The window is 365 NYC calendar days including today, ending at the check time; both open and closed reports count. Above 1,000 distinct complaints, or if either source fails validation, that count is unknown, not zero. A partial report retains only successful counts. Each lookup has one 25-second abort deadline, a 256-KiB response cap per source and fixed hosts/queries; redirects are rejected. No retries, background refresh or paid provider is introduced.

The UI displays retrieval time, exact matched building identity, separate counts, unknown/error states and explicit limitations. Retrieval time is **not** the agency's update time; official datasets can lag current conditions. Counts are building-wide, not apartment-specific. Automatic supplemental DOB, bedbug and preliminary flood summaries are described below. Official links remain for fuller records and context. Neither zero counts nor an exact record match proves safety or habitability.

Source verification: [HPD Open Data](https://www.nyc.gov/site/hpd/about/open-data.page) links datasets `kj4p-ruqc` (buildings), `wvxf-dwi5` (violations) and `ygpa-z7cr` (complaints/problems). Their official `/api/views/{id}/columns.json` schemas were read on 2026-11-17. HPD documents filtering Violation Status to Open. A separate read-only live check selected one public active Brooklyn building and successfully matched its identity and retrieved both counts; this is a single-source-path check, not a market-wide or hosted-production validation. Automated tests use injected synthetic responses and never query real providers.

Follow-up validation: 244 Bun tests passed, TypeScript and full Expo/Worker builds passed. Loaded authored-source coverage is 94.28% lines and 92.67% functions; this is not full-app, branch or browser coverage. Thirteen focused ranking/record tests pass. The final date-bounded official-query path was rechecked successfully on the same one public building sample. Browser/native interaction execution and hosted deployment remain unverified.


### Automatic report lifecycle and supplemental sources

Opening Details starts the report without another button. A stable callback avoids refetching on unrelated renders; closing Details, changing building identity/county or changing connection credentials cancels the request and ignores stale completion. Cancellation propagates through the native server/API to official requests. Completed reports are held only in session memory for five minutes; partial/unknown reports for 30 seconds; maximum100 buildings. Cached results retain their original retrieval time. Aborted/invalid responses never populate the cache. There is no polling, notification subscription or background scheduled refresh. Reopening after expiry requests a new report.

Additional automatic sources, matched by official identifiers:
- HPD annual bedbug filings (`wz6d-d3jb`) use the matched HPD building ID. Select the latest period and newest filing, never sum corrections; tied latest dates, malformed counts or counts above reported dwelling units are unknown. These are owner-filed historical reports, not independent inspection/current infestation findings.
- DOB legacy BIS penalties (`3h2n-5cm9`), newer DOB NOW Safety (`855j-jady`) and ECB summonses (`6bgk-3dad`) use an exact seven-digit, borough-consistent BIN from the matched HPD building. Report source categories/statuses separately; never sum overlapping datasets or assume every record is active. Missing BIN, errors and invalid/duplicate groups stay unknown.
- The official NYC DOT Climate Resiliency layer7 (`https://a841-dotweb01.nyc.gov/arcgis/rest/services/Climate_Resiliency/Climate_Resiliency/MapServer/7`) provides a **2015 preliminary100-year floodplain/PFIRM** point screen. Coordinates come only from the exact matched HPD annual-report record, not listing/neighborhood coordinates. Missing valid official coordinates means unknown. `SFHA_TF=T` is required for a returned special-flood-hazard intersection; X/F zones are not treated as SFHA. Empty features mean no mapped intersection at that point, never no flood risk. The layer metadata must still identify the2015 PFIRM100-year edition before querying. Edition changes, service errors or truncated responses are unknown.

This flood screen is not effective FEMA insurance mapping, all coastal/stormwater/future scenarios, a survey or the entire building footprint. Bedbug geocodes are source-provided points without a property-survey accuracy guarantee. DOB summaries do not cover every inspection/permit, and zero records cannot certify safety. Every supplemental fetch shares the report's25-second deadline and256-KiB response limit; there are no unbounded downloads or paid APIs.

Live verification: official schemas and descriptions were read; a single public active Brooklyn building completed the exact-match HPD, bedbug, all three DOB datasets and preliminary flood-screen path successfully. A separate official flood query returned VE/T for a known test point, verifying positive-response shape. These limited read-only checks are not marketwide or hosted validation. Automated tests remain synthetic/offline.

Automatic-report validation: 252 Bun tests, typecheck and full Expo/Worker build passed; loaded authored-source coverage94.41% lines /92.92% functions. Fifteen focused report/cache tests cover cancellation, cache expiry/copy isolation, identity/partial failures, annual corrections, impossible counts, separate DOB groups and positive/negative/unknown flood responses. Playwright discovers56 desktop/mobile cases including automatic Details loading and cache reuse. Discovery is not execution; browser/native interaction remains unverified. Independent static review cleared this bounded batch for draft publication only.

### StreetEasy historical aggregate dashboard

The historical dashboard explorer loads automatically from the read-only `/api/dashboard` endpoint. In public app mode this endpoint exposes only the allowlisted historical aggregate series. Private app mode retains authentication. It is separate from available rental listings and FirstMover listing snapshots. The private repository stores the original official Master Report ZIP as base64 under `server/data`, not in the public Expo bundle. Downloaded 2026-11-17 from https://cdn-charts.streeteasy.com/Master%20Report.zip, SHA-256 `05d017d90302883339eca32fe920b6b170d85a3583d6f436bd78a720bc6adfdc`.

All 45 CSVs are retained: 29 sales and 16 rental files; 43 wide area files covering 182 areas from January 2010 through October 2026, plus sales index from January 2005 and rental index from January 2007. The indices cover Brooklyn, Manhattan, NYC and Queens, not every neighborhood. There are 1,582,852 value cells, including 337,240 blanks. Blanks remain unknown. Original negative days-on-market observations remain preserved and explicitly marked source anomalies, not plausible durations. Shares and sale-to-list ratios are stored as fractions and displayed as percentages; ratios may exceed 100%. Indices are dollar-level repeat-listing measures, not medians. Overlapping areas and All/subtype series must not be added together.

Attribution: StreetEasy Data Dashboard, https://streeteasy.com/blog/data-dashboard/. This is a frozen aggregate snapshot, not a live feed or automatic refresh subscription. No scheduled or on-demand request is made to StreetEasy by this feature. The owner explicitly requested public display of these publicly downloadable aggregates. This authorization is not a representation that a separate redistribution license has been established; applicable source terms remain a consideration. Only GET catalog/allowlisted series reads are public in PUBLIC_APP=true mode; personal notes, shortlists, credentials and other APIs gain no additional access. Other modes require a configured access token and a valid bearer or trusted already-authenticated private session. Responses are `no-store`; credentials stay on the app server. No database provisioning or charges are introduced.

The web/native React explorer provides metrics, subtype, area search and the entire monthly history with progressive rendering. Native runtime and browser interactions have not been executed in this environment. Server/parser tests validate all original files and private/public authorization, but are not a substitute for device QA.

#### Historical visual exploration

Every stored dashboard series now has a responsive line chart (one shared unit/scale), 1-year/3-year/full-history ranges, optional pinned-area comparison, and a keyboard/touch-selectable monthly table. The vertical scale is explicitly labeled and is not forced to zero. Lines break at unreported calendar months and negative/anomalous values; raw tables retain anomalies. No interpolation, zero-fill or invented observations. Long tables progressively reveal earlier months.

Selecting a month shows exact prior-calendar-month and same-month-prior-year changes. Shares/ratios use percentage-point changes; other metrics use relative percentages, undefined for zero baselines. Missing or anomalous inputs yield unavailable comparisons. Neighborhood context counts lower/equal values only among reporting areas of the same geography type and borough in that same month and segment. It is not a weighted market statistic, quality ranking, individual apartment valuation or affordability advice. Source snapshot dates and latest valid area observation remain visible. No geographic map is fabricated from area names; no additional provider request occurs.

### TypeScript 7.0.2 migration

The compiler is pinned to TypeScript **7.0.2** while the runtime and package manager remain **Bun 1.4.4**. Install with `bun install --frozen-lockfile`; run `bun run typecheck`, `bun run test`, and `bun run build`. TypeScript 7 uses its platform-specific native compiler, launched by the existing Bun command. Do not omit optional platform packages during installation.

Strict checking and side-effect-import checking are explicitly enabled. Shared listing, search, UI, storage and transport contracts replace implicit types; the existing test directory remains in the typecheck. No blanket type-check suppression, strictness disablement or test exclusion was added. Existing external JSON boundary validation remains in force; typed contracts are not a claim that every third-party response is trusted or fully schema-validated.

The local migration checks include frozen-lockfile installation, TypeScript 7 compilation, all 263 unit/integration tests, Expo web export and the Worker bundle. Playwright discovers 90 desktop/mobile/iPhone-portrait Chromium cases; discovery is not browser execution, Safari or physical-device validation. Typecheck and the full build also pass with a failing `node` executable trap, confirming no Node fallback in this workflow. The external sync verifier now rejects missing, invalid or stale confirmation timestamps, with an offline regression test. No production service, refresh, credential, database, paid infrastructure or deployment was changed by this compiler migration.

### Compact historical dashboard controls

The full 45-series catalog is grouped into Market → Metric → Bedrooms/Property type rather than 45 simultaneous buttons. Changing metrics keeps a compatible segment, falling back to an actually available file (indices have only All); failed data requests leave the selectors usable. No series or area history is removed. Offline FirstMover maintenance scripts now use Bun.file, Bun.write and Bun.gzipSync; generated outputs remain browser-compatible gzip/base64. StreetEasy ZIP parsing is unchanged and is not replaced with gzip.

### Empty-startup inventory recovery

The Bun server makes one bounded Openigloo-only check on startup if stored source status has no previously saved listings. It uses the existing validation, source freshness, cooldown and conditional-write path; it does not call StreetEasy, a paid routing service, or a refresh schedule. A shared 45-second deadline bounds network operations, not database status/read/write waits. Startup preserves existing inventory and its original observation times, including stale inventory; it never labels a historical snapshot active. Set `STARTUP_OPENIGLOO=false` to disable the startup attempt. Tests disable production startup networking and separately inject offline responses.

This recovers a limited Manhattan/Brooklyn one-/two-bedroom sample after an empty free-host restart when that provider is available. It is not durable storage, complete inventory, or a guarantee of matches; an outage leaves an explicit unavailable state. PostgreSQL remains the supported durable path when an authorized database is connected. Temporary storage and unavailable inventory are now labeled in Search, with a direct source-status link rather than suggesting that a different budget is necessarily the solution.

### Open-page inventory expiry

Live search responses include the earliest expiry of the source observations used for the result. This is derived from the original successful source check, not the time the page was loaded. An open page hides expired active results and their map with an explicit warning; returning to the foreground checks the deadline again. Saved apartments remain available as personal records. This local deadline check makes no provider, geocoder, or routing request and does not extend freshness. Use the search controls to read cached inventory again, or Sources & sync for an explicitly requested source refresh. Older servers without deadline metadata do not provide this open-page protection.

Selecting a listing website also limits which apartment origins are sent to TravelTime. Other websites are not routed behind that selection. Counts remain all-inventory counts when no commute limits apply; with commute limits, the notice explicitly identifies selected-website route coverage and excludes unknown routes rather than inventing qualification. All-websites searches retain all matching origins.

Search submission waits for a ready search-server connection. Submitting while configuration is loading, locked, or offline leaves the current results, destination, and draft intact and gives a recovery message, rather than replacing inventory with a local empty result. Offline Filters offers Retry connection; after reconnecting, apply the draft again. This does not initiate a provider refresh.
