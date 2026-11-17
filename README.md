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
| Zillow, Compass, RentHop, and Realtor.com | Last saved samples and browse links. Updates require an authorized feed. |
| Trulia | The first two pages of each Manhattan and Brooklyn one- and two-bedroom search, without a rent cap. |
| Zumper | Individual apartments with exact prices from the first two public search pages and the first low-price sort page in each borough. |
| AffordableHousing.com | Apartments marked available now from the first two pages in Manhattan and Brooklyn. The importer uses the free U.S. Census batch geocoder when coordinates are available by exact address. |
| Redfin, HotPads, Apartment List, Rent.com, Apartment Guide, Craigslist, and Facebook Marketplace | Browse links. Add a listing manually or import a CSV of collected listings to Saved. |
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

Opening the app reads saved inventory without starting a source refresh. **More → Sources & sync** holds manual per-source and all-source resync controls, import, freshness and coverage details. Sources that rate-limit the app wait until their retry time. The browser can retry failed public exports when the source permits another check. The **Available rentals** view shows only active inventory from successful checks in the last two hours. Dated snapshots are used for rent charts. If a check fails or expires, its older inventory is excluded from the search and map. Openigloo uses the free U.S. Census batch geocoder for its public addresses.

The private app also serves a manual Node.js refresh runner at `/_refresh-runner.mjs`. Download it through owner-only service access and pass the service credential on stdin. Keep the credential out of files, command arguments, and logs.

## Rent chart

Compare six months of median initial asking rents for studios through four bedrooms. Choose a neighborhood, borough or city, or ZIP, and pin up to two areas to compare with your selection. Choose **By bedroom** for the latest snapshot’s size breakdown. Each value includes its listing count, and months with missing observations appear as gaps. The chart uses all included rentals for the selected area, independent of the search budget and commute filters.

The market chart uses the dated public snapshot so a small live sample cannot skew area medians. It excludes entire houses, townhouses, and commercial or land records where the source identifies them. Duplicate source links and confirmed units are consolidated. The source coverage is NYC and parts of North Jersey. Switch to **Saved listings** to chart rentals you collected in other areas. That chart summarizes the saved list, whose prices can come from different dates.

### Rebuild the offline snapshot

Download a monthly CSV from [FirstMover Open Data](https://www.firstmovernyc.com/open-data). Use Python 3 to regenerate the compressed offline dataset, then rebuild the app.

```sh
node --experimental-strip-types scripts/update-market.ts /path/to/2026-10.csv 2026-10
npm test
npm run build
```

The data comes from the [FirstMover Open Data Project](https://github.com/benfwalla/firstmover-open-data-project). Its license is included at `src/data/FIRSTMOVER-LICENSE.txt`. The bundled data contains addresses, unit identifiers, asking rents, neighborhoods, coordinates, posting dates, and source URLs. Photos and listing descriptions are excluded.

Run `node --experimental-strip-types scripts/update-rent-history.ts /path/to/months/20*.csv` with dated FirstMover CSVs to rebuild the offline trend data. Hosted refreshes retain the previous month’s medians when a new monthly release arrives.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run build:web
npm run dev
```

Open http://127.0.0.1:3000. Run `npm start` to open the app in a compatible Expo Go build. Use `npm run ios` or `npm run android` for a simulator or emulator. The public snapshot, chart, and saved list work offline. A signed App Store or Play Store build uses the owner's store and signing setup.

A custom address is sent to the [free U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) when submitted to the server. Addresses are not persisted by the server. Native builds can use a preset or coordinates offline. To connect a native build to your own geocoding server or authorized free feeds, set `EXPO_PUBLIC_API_URL` to your server origin. For a LAN test set `HOST=0.0.0.0`, use the computer's LAN IP and port, and configure a random `APP_ACCESS_TOKEN` of at least 24 characters if serving free partner feeds. Enter that token in the app when prompted. Use HTTPS on a remote server.

### Optional free partner feed

Set `FREE_PARTNER_FEEDS_JSON` in the server environment to an array of approved no-cost HTTPS endpoints. Each item needs a unique `id`, a `name` for a custom source, a `url`, and an optional bearer `token`. Use IDs from `src/marketplaces.ts` for a platform badge. The endpoint returns a JSON array or an object with `listings`. A paginated feed returns `{ listings, next, total }` where `next` is an HTTPS URL on the same origin (absolute or relative), or null on the last page. Optional `total` counts all source rows, including those excluded by normalization. A reported partial feed, invalid page chain, count mismatch, or refresh over 40 pages or 25,000 rows fails without replacing the last saved snapshot.

Each row supplies an ID, `status: "Active"`, `addressLine1`, a unit if known, `city`, `state`, `county`, `zipCode`, `bedrooms` (studio = 0), and monthly `price`. Include numeric `latitude` and `longitude`, `neighborhood`, `updatedAt`, and an HTTPS `listingUrl` for the original listing. Only source URLs supplied by the feed are presented as direct links. Page counts describe the supplied feed, whose coverage may be smaller than the source website's inventory.

## Verify

```sh
npm test
npm run typecheck
npm run build:web
npx expo export --platform ios --platform android
```

`npm run build` also packages the web bundle and server into the private hosted Worker.


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


### External StreetEasy recovery runner

The owner-only Site serves `/_streeteasy-sync.mjs`. On an authorized Node.js
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

`server/relay-service.ts` runs on a Render Free web service using only Node built-ins:
`node --experimental-strip-types server/relay-service.ts` (Node 24). It keeps no data.
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

The Node entrypoint can serve the complete web UI and API with a temporary,
single-process listing cache. Build with `npm ci && npm run build:web`, then run
`node --experimental-strip-types server/node.ts` with `HOST=0.0.0.0` and a random
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
refreshing providers; source refreshes start only from More → Sources & sync.
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

Search opens saved inventory in a list, with compact cards and optional Map view. Filters open in a dismissible sheet; Search, Saved, and More stay reachable at the bottom. More → Sources & sync contains explicit resync controls and CSV/manual import. Opening the application does not start a provider refresh. Sources retains detailed last-attempt, last-success, partial-coverage and error information. Card Details expands directions and provenance; missing or conflicting data is not guessed.

### Durable PostgreSQL inventory (optional)

Set `DATABASE_URL` in the Node service's secret environment to use an existing
PostgreSQL database instead of the temporary memory bucket. The app creates the
`apartment_objects` table if needed. Source payloads, metadata and conditional-write
ETags survive Node restarts; competing writers serialize quota checks and publish
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
make stale listings fresh, or change manual-only refresh behavior.

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
