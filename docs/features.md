# Feature reference

How each part of the app behaves, including its limits. The [README](../README.md) covers setup, sources and deployment.

## Search and results

- The homepage shows saved active inventory from every connected source across all regions, with no bedroom or rent cap. Results default to **Lowest rent**; **Fastest transit** and **Fastest drive** sort all matches before the list is limited.
- **Available rentals** and the map show only apartments reported active by a recently checked source. Listings carry their original check dates and are labelled as last saved results when a refresh fails or expires. Dated historical export rows are excluded.
- Each search response carries the earliest expiry of the observations it used. An open page hides expired results and their map with a warning, and checks again when it returns to the foreground. This makes no network request and never extends freshness.
- A search waits for the server connection. Submitting while configuration is loading or offline keeps the current results and draft and shows a recovery message.
- **Listing company** filters and coverage cards use the advertiser field from the dated snapshot (Compass, SERHANT., Corcoran, Douglas Elliman, Brown Harris Stevens and other NYC brokerages and managers).
- **Listing websites** shows a unit's direct and saved links, then separate address searches. Units match on normalized street, ZIP, state and unit number; a shared building address alone never merges apartments.

### Discovery facts

Feeds can supply `bathrooms` (half steps up to 20), `squareFeet` (up to 100,000), `petsAllowed` (boolean) and `laundry` (`in_unit`, `in_building` or `none`). Missing or invalid values stay unknown, never false or zero, and nothing is inferred from descriptions or photos. Filters can require minimum bathrooms or area, allowed pets or a laundry category; units with an unknown required fact are excluded. When independent sources disagree, the fact becomes unknown and a conflict notice appears.

### Best fit: rent + commute

An opt-in, transparent ordering. The rent weight runs from 0 to 100 (default 60) and commute gets the remainder. Each part scores `weight × max(0, 1 − value/reference)`: rent against the maximum-rent filter (or $5,000), and the TravelTime estimate against the selected time limit (or 60 minutes), using transit unless only a driving limit is set. A route must match the selected destination exactly; unknown routes get no points and straight-line distance is never substituted. Ties go to lower rent, then ID. No demographic, school, crime or safety variables are used.

## Commute estimates

With `TRAVELTIME_APP_ID` and `TRAVELTIME_API_KEY` set, searches calculate typical weekday-morning transit and driving times from geocoded rentals to the workplace using the [TravelTime matrix](https://docs.traveltime.com/api/reference/time-filter-fast). Only coordinates are sent. Routed times are reused per workplace for 7 days, and each estimate shows its destination, arrival period and when it was routed. Estimates over three hours, or routes the provider cannot find, show as unavailable. Selecting a listing website limits which origins are routed. Without credentials, rent and map search still work and the commute limits are hidden.

A custom workplace address is geocoded with the free [U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) and not stored. The default workplace is Rockefeller Center.

## Saved apartments (this device only)

Saved apartments, notes, comparisons, tours and saved searches live in the browser or device storage. They are not synced between devices, and clearing site data removes them.

- **Notes and viewing status** are kept when an apartment is removed and reappear if it is saved again. A failed read never overwrites notes.
- **Import CSV** adds up to 500 listings per file. Header: `url,address,unit,city,state,zip,bedrooms,rent`, with optional `county,neighborhood,latitude,longitude`. Use studio = 0, five-digit ZIPs and plain numeric rents.
- **Compare saved apartments**: up to four side by side, with price and fee basis, bedrooms, reported features, check date and conflicts. It makes no network requests.
- **Plan apartment tours**: up to 30 tentative appointments (5–240 minutes) with notes and a checklist. Overlap warnings use durations only. A Google Maps walking-route link covers 2–5 stops in the displayed order. Web exports an RFC 5545 `.ics` file; nothing is booked or sent. Use one tab at a time, because concurrent tabs can overwrite edits.
- **Saved searches**: up to ten named presets. **Check all matches** calls `/api/search-check`, which scans all matching saved inventory without fetching providers, geocoding or routing. It refuses commute-time requirements, searches above 2,000 matches and checks during a refresh. The first check sets a baseline; later checks separate price changes, fee-basis changes and newly seen units. Absence never means rented.
- **Local price and discovery changes** keeps a manual device-local baseline of up to 2,000 units for the current result page.

## Observed price history

Successful refreshes record each listing's price observations in the same stored snapshot as its inventory, so a failed refresh replaces neither. History keeps the 24 most recent price changes per unit and 20,000 units per source, and labels truncation. Only listings in the latest complete sync keep their history; a unit missing from a complete sync loses it. Missing units are never marked rented. Snapshots are written with etag compare-and-swap, so an overlapping refresh cannot overwrite the winner, and older observation times are rejected.

## Building reports (NYC)

Opening a listing's Details fetches an official building report through the API, with one 25-second deadline, a 256 KiB cap per source, fixed hosts and no redirects. Reports are cached in memory for five minutes (30 seconds when partial), for up to 100 buildings, and cancelled when Details closes.

- **Identity**: the exact house number, street and ZIP must match exactly one active building in HPD's jurisdiction dataset (`kj4p-ruqc`), with a consistent borough. Nothing is guessed; an unmatched building means unknown, not clean.
- **HPD**: open violations (`wvxf-dwi5`) and unique complaints (`ygpa-z7cr`) over the last 365 days by HPD building ID. More than 1,000 complaints, or a failed source, is unknown, not zero.
- **Bedbug filings** (`wz6d-d3jb`): the latest owner-filed annual report, never summed across corrections.
- **DOB**: BIS penalties (`3h2n-5cm9`), DOB NOW Safety (`855j-jady`), ECB summonses (`6bgk-3dad`), complaints and permit issuances by exact BIN, each reported separately.
- **Tax lot**: 311 requests over 365 days, PLUTO's listed owner and edition, and the NYS HCR rent-stabilization registration by BBL, with links to deeds and the HCR rent-history request.
- **Flood screen**: the NYC DOT 2015 preliminary 100-year floodplain (PFIRM) layer at the HPD record's coordinates. It is not FEMA insurance mapping, and no intersection never means no flood risk.

Counts are building-wide and can lag the agencies' own records. Neither zero counts nor an exact match proves safety or habitability.

## Rent charts

Six months of median initial asking rents for studios through four bedrooms, by neighborhood, borough, city or ZIP, with up to two pinned comparison areas and a **By bedroom** view. Values show their listing counts; missing months are gaps. The chart uses the dated FirstMover snapshot (NYC and parts of North Jersey), excludes houses, townhouses and commercial records, and consolidates duplicates. **Saved listings** charts the saved list instead.

## Historical dashboard

`/api/dashboard` serves the StreetEasy Data Dashboard Master Report (downloaded 2026-11-17, SHA-256 `05d017d90302883339eca32fe920b6b170d85a3583d6f436bd78a720bc6adfdc`), stored under `server/data` rather than in the web bundle. It has 45 CSVs: 29 sales and 16 rental files covering 182 areas from January 2010 to October 2026, plus sales and rental indices. Blanks stay unknown, negative days-on-market values are flagged as source anomalies, and overlapping areas must not be added together. The explorer groups series as Market → Metric → Bedrooms or Property type, with 1-year, 3-year and full ranges, pinned comparisons and a selectable monthly table. It is a frozen snapshot and makes no requests to StreetEasy. Attribution: [StreetEasy Data Dashboard](https://streeteasy.com/blog/data-dashboard/).

## Affordable housing

The Affordable tab lists [NYC Housing Connect](https://data.cityofnewyork.us/d/vy5i-a666) lotteries with application dates, addresses and bedroom counts, HDC re-rentals, and links to Mitchell-Lama and Section 8 resources. Search results link to an open lottery in the same building.

## Layout

Screens are designed mobile-first for an iPhone 17 in portrait (about 402 CSS pixels wide) and stay usable on desktop. Primary actions stay in the viewport with no horizontal page scroll; Search, Saved and More stay reachable at the bottom, and filters open in a dismissible sheet. The Playwright suite runs desktop, Android-size and iPhone-size Chromium layouts, which is emulation, not Safari or device testing.
