# Walkup

Formerly "Apartment Search"; the Worker, repository and app identifiers keep that name.

Search New York–area rentals from many listing sites in one place, and compare them by asking rent and weekday-morning commute to your workplace. One Expo app runs on the web, iPhone and Android; the web app and its API run on Cloudflare.

Areas: all of New York City (Manhattan, Brooklyn, Queens, the Bronx, Staten Island), New Jersey, Long Island, Westchester County, the wider Metro-North region (Westchester, Rockland, Putnam, Dutchess and Orange counties), Connecticut and eastern Pennsylvania. Boroughs and Westchester are matched by county, or by ZIP code when a source gives no county.

[docs/features.md](docs/features.md) describes each feature and its limits. [docs/nyc-rental-sources.md](docs/nyc-rental-sources.md) catalogs every NYC rental source considered and why each is or isn't connected.

## Architecture

```
browser or app ──▶ apartments.5thof6.com
              │  email-code sign-in session (cookie on the web, bearer token in the app)
              ▼
          apartment-search Worker, a Hono app (server/cloudflare.ts), checks the session (server/auth.ts)
              ├── web app files ── Workers Static Assets (web-build/)
              ├── /api/* ── server/api.ts (Hono routes, Valibot request checks)
              ├── D1 apartment-search-observations ── listings, price history and sign-in tables (server/storage/d1-bucket.ts)
              └── Workflow apartment-cityrealty-sync ── complete syncs: CityRealty → Openigloo → Zumper

your computer ── scripts/sync-streeteasy.ts ── uploads the StreetEasy inventory daily (workers.dev URL, app token)
```

- **One Worker, public, with accounts for what is yours.** `server/cloudflare.ts` serves the web app and the API at `apartments.5thof6.com` and its workers.dev URL. Anyone can search, read market data and use every tool without an account. Saving apartments, email alerts, a shared list, billing and listing your own apartment need an account; resyncing sources needs an admin. Each screen has its own address (`/` the home page, `/market`, `/search`, `/saved`, `/profile`, `/listing/ID`; `src/routes.ts`). Who you are comes from one of:
  - an **email-code sign-in** with Better Auth (`server/auth.ts`), for people, on the web and in the App Store app: type your email, get a six-digit code, type it in. Only `ACCESS_ALLOWED_EMAILS` get a code or an account; anyone else sees the same reply and gets nothing. Codes last 10 minutes with 3 tries; asking for codes is limited to 3 a minute. Sessions last 30 days, in a cookie on the web and in the device's secure storage in the native app, which sends it as a bearer token. Changes from the web app must come from its own pages (same `Origin`). Users, sessions, codes and rate limits are tables in D1. It needs the `BETTER_AUTH_SECRET` secret, and sends codes through the same email binding as alerts (see [Email alerts](#email-alerts)).
  - the **app access token** (`Authorization: Bearer <APP_ACCESS_TOKEN>`), for scripts such as the StreetEasy home sync.

  Every response carries `Strict-Transport-Security` (HTTPS only, for a year). `/health` returns `ok`.
- **Storage.** Listings are rows in D1: `listing_snapshots` holds each source's latest check (its counts and version), `listings` one row per listing with its region and rent indexed, and `price_history` one row per unit's observed prices (see `deploy/cloudflare/migrations/` and `server/storage/d1-bucket.ts`). A search asks D1 only for listings in its region and within its rent, then applies the remaining filters. A source's new check replaces its rows in one transaction, and only if no other check replaced them first, so a failed or overlapping refresh never leaves a mix. Smaller documents (refresh status, rent charts, Housing Connect, alerts, caches) are versioned rows in `apartment_objects`. Only current listings are kept, with no records of past listings. StreetEasy's market history since 2010 is in `market_areas`, `market_series` and `market_values` (1.2 million monthly figures), loaded from the dashboard archive ([docs/features.md](docs/features.md#market-history)).
- **Refreshes: nightly, every two hours in the day, and whenever an admin asks.** Opening the app reads saved inventory and fetches nothing. A Cron Trigger wakes the Worker every hour, and the hour in New York decides what runs (`server/nightly.ts`, so it follows daylight saving time): at 1 AM every source is resynced, then alerts are checked; every two hours from 8 AM to 10 PM the quick sources are checked, then alerts, so new apartments are reported within a couple of hours. An admin turns either on or off under **Profile → Admin**, which also shows the last runs. **Profile → Sources & sync** resyncs one source or all of them, for admins only. Sources that take longer than a request allows run in the Workflow, one durable step at a time: first the slow samples read a page at a time (Apartment Guide, Nest Seekers, Douglas Elliman, Corcoran, Bozzuto, AvalonBay, Greystar, Nooklyn, Bond New York, TriBro NYC; `BACKGROUND_SYNCS`), then the complete syncs (CityRealty, Openigloo, Zumper); the page polls their progress every 15 seconds. A source that failed with a retry time is skipped until that time passes.
- **StreetEasy** refuses requests from cloud hosts (HTTP 403), so a computer you own downloads it and uploads it to the Worker (see [Daily StreetEasy sync](#daily-streeteasy-sync-from-your-own-computer)).
- **Static data.** The web app's files are served with a Content Security Policy and other security headers (`server/web-headers.ts`); fingerprinted bundles are cached for a year, everything else is revalidated. The 2.4 MB StreetEasy dashboard archive is published with the static files (`public/data/`) rather than built into the Worker, read through the assets binding when a dashboard series is first opened, checked against its SHA-256, and never served directly.
- **Logs.** Unexpected failures and failed source checks are written as one JSON object per line (`server/log.ts`) to [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), with source maps so stack traces point at the TypeScript. Look for the `event` field: `request_failed`, `storage_read_failed`, `dashboard_read_failed`, `source_check_failed`, `complete_sync_failed`, `alert_check_failed`, `alert_email_failed` or `alert_push_failed`; `alerts_sent` and `web_vital` record alerts and real-user performance.
- **Roles.** The first address in `ACCESS_ALLOWED_EMAILS` is the admin, unless the `ADMIN_EMAILS` secret lists the admins (comma-separated). Everyone else is a member: they search, save listings and set their own alerts; only admins resync sources or change platform settings (`server/roles.ts`). The app's own token and a public app act as admin.
- **Price, warnings and buildings on every card** (`src/insights.ts`). Each rent is compared with the median of at least five similar listings (same neighborhood, or ZIP code, and bedroom count), e.g. "12% below similar". Warnings flag a rent 40% or more below that median, a listing with no street number, and the same unit listed at another rent. Building facts come from city and state records (`server/building-facts.ts`): a building is recorded when someone opens its NYC building records, and each nightly run checks about 200 more listed buildings (each rechecked after 90 days). Cards show "Rent-stabilized building" when the building registers rent-stabilized units with the state (DHCR), and a grade from A to D from open HPD violations, complaints in the last year, bedbug filings, the flood zone and, over two years, city rat inspections that found rats, marshal evictions (against the building's number of apartments, from the tax lot; counted from a copy of the city's two-year list that the nightly run reloads each week, because the city answers that question about one building slowly or not at all), Housing Court cases (a harassment case weighs most) and a lapsed HPD registration in a building of three or more apartments. Facts kept before these were read are checked again by the nightly runs. An order to vacate in force grades a building D outright. The building report also shows **the block**, measured from the tax lot: crimes reported to the NYPD this year within about 200 m (violent, property, other), parks and grocery stores within about 400 m (state food-store licenses of 4,000 sq ft or more, drugstores left out), and the building's average apartment size, estimated as the lot's residential floor area over its apartments. Filters: below similar apartments, rent-stabilized buildings, and hiding buildings graded C or D.
- **Costs.** Each listing's details show about what it costs each month all in (typical electricity and gas by size, internet and renter's insurance) and to move in, using the state's deposit and application-fee caps and the FARE Act for New York City broker fees (`src/move-in.ts`). Listings don't report fees, so there is no "no fee" filter; under the FARE Act, NYC renters don't pay a broker the landlord hired.
- **Shared list** (`server/households.ts`, `/api/household`). Up to four signed-in people share one list: invite by email, accept, add from saved apartments, vote yes or no and leave notes. Each person can set where they commute, and every shared apartment shows each person's distance and transit directions.
- **Application kit** (Profile → Application kit). A renter profile, the 40-times-the-rent income rule (80 times for a guarantor), a documents checklist and a ready-written inquiry for any saved apartment, kept on the device only.
- **Tour day.** The tour planner shows the walk between stops, warns when there isn't enough time to walk to the next tour, and suggests a shorter order.
- **Plain-English search** (`src/natural-search.ts`). In Filters, "Describe what you want" turns a sentence such as "2 bedroom in Park Slope under $4k with laundry" into filters (size, budget, area or neighborhood, pets, laundry, bathrooms, rent-stabilized, good buildings, deals) on the device, without an AI service, and searches.
- **Neighborhoods** (Profile → Neighborhoods; `server/neighborhoods.ts`, `/api/neighborhood`). For any NYC neighborhood: apartments listed, median rent by size, what's known about its buildings, and 311 complaints over the last year (noise, heat and hot water, rodents, building conditions) in its main ZIP code, from NYC Open Data, kept for a week. "Show apartments" searches that neighborhood.
- **Renewal check** (Profile → Renewal check; `src/renewal.ts`). Compares a current rent with the median of similar apartments listed in the neighborhood now, with advice; for rent-stabilized leases it shows the Rent Guidelines Board increases (3% for one year, 4.5% for two, for leases starting October 2025 to September 2026). Update `RGB_INCREASES` when the board votes each June.
- **Rent-stabilized registry and subway stations** (`server/open-data.ts`). The full run (nightly, or Resync all) loads, when a month old, New York State's list of about 57,000 buildings that registered rent-stabilized units in the last two years (DHCR's registered buildings layer) and the MTA's 475 subway stations with their daytime lines (data.ny.gov). Listings in a registered building are marked rent-stabilized; NYC listings show the stations within a 10-minute walk ("3 min to L"); filters keep listings near the subway or near chosen lines, and plain-English search understands "near the L" or "on the 4/5/6".
- **Payments** (`server/billing.ts`, `/api/billing`). Free members upgrade on their Profile with Stripe Checkout: $15 a month (a subscription) or $35 for three months (one payment). Stripe's signed webhook (`/api/billing/webhook`, the only API route reachable without signing in) records each payment with the date the account is paid until; renewals extend it, a cancelled subscription ends it, and subscribers manage billing in Stripe's portal. Card details never reach the app. Set up:
  1. In Stripe, create a product with two prices: $15 per month (recurring) and $35 (one time). Copy both price IDs.
  2. Add a webhook endpoint `https://apartments.5thof6.com/api/billing/webhook` for `checkout.session.completed`, `invoice.paid` and `customer.subscription.deleted`, and copy its signing secret. Turn on the customer portal in Stripe's billing settings.
  3. Set the Worker secrets (the checklist is in [TODO.md](TODO.md)): `wrangler secret put STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_PASS` (from `deploy/cloudflare`). Until all four are set, the upgrade buttons stay hidden and admins upgrade accounts by hand. The button labels ($15 a month, $35 for 3 months) are in `PLAN_LABELS`; keep them the same as the Stripe prices.
- **Freshness and value.** Cards show when a listing is new on Walkup ("New today") and its last price cut, from its recorded price history; older listings say how long they have been on Walkup, with a nudge to negotiate after three weeks. Filters keep listings new in the last 1, 3, 7 or 14 days; sorts include newest on Walkup and best value for the area. Results offer "Get email alerts for this search". Subway details mark fully accessible stations, with a filter for them.
- **Admin dashboard** (Profile → Dashboard; `server/admin.ts`, `/api/admin/stats`). Members, paid and free; subscriptions, passes and estimated monthly revenue; alerts and devices; failing sources and the last nightly and daytime runs; and the public data loaded.
- **Your data** (`server/account.ts`, `/api/account`). Anyone signed in can download everything kept for their account, or delete the account after typing DELETE: saved apartments, alerts, devices, shared-list membership, a manual paid mark and the sign-in with its sessions. A running subscription must be cancelled first.
- **Terms and privacy** (`src/screens/LegalPage.tsx`). Draft Terms of Service and Privacy Policy written from what the app does, linked from Profile; see TODO.md before charging customers.
- **Home page** (`src/screens/HomePage.tsx`), at `/` for everyone: three quick questions (where, how big, budget, when) that open the matching apartments and can offer alerts, then what Walkup does, an example listing with its badges, how it works, plans and questions. Visitors see **Log in** at the top; saving or alerts ask them to create a free account (`src/components/AccountPrompt.tsx`).
- **Rent prices** (the Market tab, `src/components/RentChart.tsx`). Pick a state (New York, New Jersey, Connecticut), borough or city, neighborhood or ZIP, and a size, once; the median and count, the chart, the ranked list of the areas within and every size follow it. The chart's time range goes from 6 months (FirstMover's monthly snapshot; Connecticut from Walkup's own listings) to 1, 3, 5 or 10 years or since 2010 (StreetEasy's history, `src/components/LongTrend.tsx`, New York City only). StreetEasy's inventory, price cuts and rankings are under "More market data". The page names its sources, and "Compare with your saved apartments" charts saved listings instead.
- **What can I afford?** (Profile, `src/affordability.ts`). Landlords' rule (income 40 times the rent, the same as rent at 30% of gross pay), Dave Ramsey's (rent at 25% of take-home pay, with take-home estimated from 2025 federal, payroll, state and New York City taxes for a single filer, or entered), and a guarantor's 80 times; each searches up to its budget.
- **Listing pages and map pins.** Each apartment has its own page (`#listing=ID`, `/api/listing`) with its details open and a share link; the map shows each listing's rent on its pin.
- **Public neighborhood pages** (`server/public-pages.ts`). `/rents` and `/rents/<borough>/<neighborhood>` show median rents by size, checked buildings and 311 complaints without signing in, for search engines; `/sitemap.xml` and `/robots.txt` list them. Neighborhoods with fewer than five listings get no page.
- **Room to negotiate, and a watch on saved apartments.** A listing's details say when it has been on the market three weeks or more and how often its rent was cut (`leverage` in `src/insights.ts`). Each alert run also compares every account's saved apartments with what is listed (`server/saved-watch.ts`): a rent drop is emailed once, measured from the rent it had, and an apartment missing three checks in a row is reported as no longer listed. These go out with the alerts and by the same plan rules.
- **More in the building report**: heat and hot water complaints by winter for the last three, 311 noise complaints within about 150 m over a year, and the other tax lots under the same owner name with each one's open violations.
- **Hiding apartments** (`src/hooks/use-hidden.ts`). The X on a card takes that apartment out of the person's own results, kept on their device; "Show hidden apartments" above the results brings them back. It is private: nothing is rated publicly and nobody else's results change.
- **Walkability** (`server/walkability.ts`). Each listing shows the EPA's National Walkability Index for the blocks around it, shown out of 100 as "Walkability 85/100" (the EPA scores it 1 to 20; Walkup multiplies by five), with its source and that conversion named in the details. The index is public and free. It is asked for by point, so the app keeps what it has learned by map cell (about a block) and the nightly run asks about up to 800 places it does not know yet (under the limit on outside requests one step may make).
- **Light and dark themes** (`src/theme.ts`). In the browser every interface color is a CSS variable named for its place in the palette; the dark theme gives each the level at the other end of the same hue, so the palette's contrast rules hold in both. The theme follows the device unless one is chosen under **Profile → Appearance**, which is kept on the device. Maps and their pictures keep their own colors. The phone app has the light theme only.
- **Home, About and Pricing** (`src/screens/HomePage.tsx`, `AboutPage.tsx`). The home page is the search, then the offer of email alerts (the paid feature) and three reasons to search here; `/about` says what Walkup does and answers common questions, and `/pricing` shows the plans and leads to email alerts, the paid feature. On the results, **Get alerts** is the one filled, colored button: beside the search on a wide screen, leading the row under it on a phone.
- **Market reports** (`server/articles.ts`). `/blog` lists three articles for each of the latest twelve months of StreetEasy's Data Dashboard figures: the city's rent report (by borough and by size), the fifteen most affordable neighborhoods, and where rents rose and fell most from a year earlier. Each is composed when read from the market history tables, so a new month's figures publish a new set without anyone writing them; every statement is a number from the data, with its source. Neighborhoods with fewer than 25 rentals listed are not ranked. The articles are in `/sitemap.xml` and allowed in `/robots.txt`.
- **First visit.** After signing in on a new device, three questions (where, how big, budget) and when you move, then the matches and an offer of email alerts.
- **Weekly digest, funnel and warnings** (`server/digest.ts`, `server/ops.ts`). Monday at 9 AM Eastern, paid accounts get one email with what is new for their alerts this week. Searches, saves, alerts, checkouts and payments are counted per day (totals only) for the dashboard's 30-day funnel. After each nightly run, admins are emailed about sources that were working and now fail.
- **Photos.** A listing can carry its landlord's own building photo from an allowed image host (`PHOTO_HOSTS` in `src/listings.ts`; today TF Cornerstone's); cards show it first, then Street View, then the map.
- **Walkup direct** (`server/direct-listings.ts`, Profile → List your apartment). Owners submit no-fee NYC listings; admins approve them on the same page; approved listings join every search for 60 days (renewable), marked "No fee · Owner", with "Email the owner" as their link.
- **Accessibility.** The browser tests run axe on the main screens and fail on serious problems.
- **Shared lists, and a link to one** (`server/households.ts`). Accounts invite each other by email and share apartments, votes and notes. A member can also turn on a link (`/s/<token>`): whoever has it reads the list and leaves notes under a name, with no account; they see members' names, never their addresses. Turning the link off stops it at once, and a list nobody is in any more closes its link.
- **Free and paid plans.** Everyone signed in can search and save listings (`server/plans.ts`). A free account keeps one email alert, sent three hours after a match is found and at most three a day (`server/alerts.ts` holds them in `alerts/held.json`); the paid plan sends every alert as soon as it is found, keeps up to ten and adds notifications on a phone. A free alert's email says what the paid plan changes, with a link to `/pricing`. Admins are always paid. An admin moves other accounts between Free and Paid under **Profile → Accounts and plans** (kept in storage), and the optional `PAID_EMAILS` secret can list more. A free account sees what the paid plan adds instead of the alert form; alerts of an account moved back to Free are paused until it is paid again. Paid accounts come from Stripe payments (below), an admin's switch, or `PAID_EMAILS`.
- **Profile and saved listings.** The Profile tab shows the account, its saved listings and email alerts, and, for admins, the nightly resync switch and Sources & sync. Saved listings are kept on the signed-in account (`server/saved.ts`, `/api/saved`, up to 300) as well as on the device, so they follow you between devices.
- **Alerts.** Each account sets its own alerts (`server/alerts.ts`): an area (all of NYC or a borough), optional neighborhoods, any set of bedroom counts, and a maximum rent, for example "West Village · 2 BR · under $5,000" or "Brooklyn · 1, 2, 3 BR · under $2,500". A listing without a neighborhood counts as in one when its ZIP code is. Alerts are checked after the nightly resync, each resync an admin starts, the sync Workflow and the StreetEasy upload. Each alert's matches are compared with its last check, and new apartments and price drops go out by email to that account's address only (Cloudflare Email Service) and as notifications (Web Push with VAPID keys, `server/web-push.ts`) to that account's devices.
- **Installable app.** The web app has a manifest, icons (`public/`) and a service worker (`web/`), so it can be added to the Home Screen; iPhone notifications need that. The service worker caches nothing, so the app always loads current code and listings.
- **Performance.** Screens load on first use: the map, rent charts, alerts, tours, comparison and sources. The web build also leaves out the offline snapshot, which only native builds and the Worker use. Real visits report Core Web Vitals to Workers Logs (`src/web-vitals-report.ts`, using Google's `web-vitals`), `bun run perf:lighthouse` runs a Lighthouse audit, and speed, size and request budgets run in CI so a slowdown cannot ship (`docs/performance.md`).

- **API.** The routes are a [Hono](https://hono.dev) app: `config`, `search`, `search-check`, `refresh`, `market`, `housing`, `history` (StreetEasy's market history since 2010, from D1; see [docs/features.md](docs/features.md#market-history)), `building-report`, `geocode`, `alerts` and `vitals`, all under `/api/`. `server/api.ts` mounts the route groups in `server/routes/` (sources, search, data, alerts, vitals), which are created from one typed factory (`server/routes/context.ts`) and leave the work to the domain modules (`server/search.ts`, `server/app-config.ts`, `server/alerts.ts`, `server/refresh.ts`). Each route checks its input once, with a [Valibot](https://valibot.dev) schema (`server/routes/inputs.ts`; search filters in `src/search.ts`, which the app uses too), and answers a mismatch with a 422 naming the first problem. Every POST must be JSON (`Content-Type: application/json`), which also stops cross-site form posts, and within its size limit (4 KB, or 2 MiB for an authenticated source import). Hono infers each reply's type from the routes, and `test/api-contract.ts` fails the type check if a reply stops matching what the app reads.

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
| Live check, 2026-11-23 | From GitHub's network, `scripts/check-sources.ts` read listings from Zillow, Trulia, AffordableHousing.com, HotPads, Apartment List, StuyTown, Glenwood, Brodsky, Housing Connect, HDC, Jersey City and Westchester. StreetEasy and Apartments.com (HTTP 403), Realtor.com (HTTP 429), Redfin (HTTP 405), and Compass and RentHop (bot challenges) refuse automated requests; the app reports them as blocked and does not try to get around it. Those sites are listed in `BLOCKED_SOURCES` (`server/sources/source-registry.ts`): a resync does not ask them, so every source it asks can answer, and they stay links under Rental platforms. The weekly check still reads them; take a site off that list once it answers. Checked by hand on 2026-11-24: Leasebreak (bot challenge) and ForRent.com (access denied) refuse them too. |
| Apartment List | Identified NYC units available now or within 60 days, from 60 pages of its NYC search. |
| Apartment Guide (Rent.) | 30 pages of its NYC search (about 1,500 buildings), one listing per building and bedroom count at the lowest available rent; rent.com shows the same buildings. The site limits how much it is read (a bot challenge after about 35 pages in a row), so pages go one at a time with a pause and the resync stops at the first challenge. It turns away clients without the usual `Mozilla/5.0 (compatible; …)` crawler form, so this source names the app that way (`CRAWLER_USER_AGENT`), never as a browser. |
| Redfin | Active, individually identified units from its public NYC search. |
| Trulia | The first two pages of one- and two-bedroom searches in the five boroughs and the same outer markets as Zumper. |
| AffordableHousing.com | Apartments available now from the first two pages in each borough, geocoded with the free U.S. Census batch geocoder. |
| Jersey City affordable housing | The city's [current affordable housing postings](https://www.jerseycitynj.gov/CityHall/HousingAndDevelopment/affordable_housing/recent_affordable_housing_postings): income-restricted buildings taking applications, with the apartments each describes by size, shown in the Affordable tab. Not market inventory; a failed or older check keeps the last good copy. |
| NYC Housing Connect | Advertised rental lotteries from [NYC Open Data](https://data.cityofnewyork.us/d/vy5i-a666), shown in the Affordable tab. |
| FirstMover Open Data | The monthly [FirstMover](https://www.firstmovernyc.com/open-data) snapshot behind the rent charts and dated listings. |
| StuyTown | Every available apartment in Stuyvesant Town and Peter Cooper Village (169 in November 2026), from the landlord's own listings feed that its search page reads. Saved only when the apartments read match the feed's own count. |
| Glenwood | Every available apartment in Glenwood's 26 Manhattan and Riverdale buildings (37 in November 2026), from its own search. Saved only when the all-apartments search equals its one- to four-bedroom searches combined. Cards name the building, not its address, so `server/sources/glenwood.ts` keeps each building's address, ZIP code and coordinates (from the U.S. Census geocoder); a listing in a building not in that table fails the check rather than being guessed. |
| Brodsky | Every apartment on The Brodsky Organization's own rentals page (38 in 19 Manhattan and Brooklyn buildings in November 2026), with each building's street address read from its page. The page lists all of them with no pages and gives no separate total, so the check is that every listing is complete and every address is read. Its `/api/`, which robots.txt disallows, is not used. |
| Brokerages | NYC rentals from the brokerages' own sites, added November 2026 (live counts then): SERHANT. (50) and Keller Williams NYC (47), from the GraphQL feed their Luxury Presence sites' rent pages read; Nooklyn (about 880), from the public search its rentals page calls; MNS (about 200), one page; REAL New York (about 180), Bond New York (about 280) and TriBro NYC (about 330 of its ~630 rentals: the rest hide the building number), from their RealtyMX search pages (TriBro's net effective rents are turned back into gross rents from the concession each card states); Nest Seekers (about 940; Brooklyn and Queens in full, then Manhattan newest first within 39 pages); Corcoran (the newest ~180, 30 pages of its NYC search) and Douglas Elliman (about 290, the first page of 35 borough and neighborhood searches, which lean expensive). Listings without a street address are left out (most Keller Williams ones, all of Living New York's). REAL New York, Bond New York, TriBro NYC and Nest Seekers give no ZIP codes, so one batch request to the U.S. Census geocoder supplies them, and a listing is kept only if it falls in its neighborhood's borough. Brown Harris Stevens answers every request with a Cloudflare bot challenge and stays a link. |
| Landlords | NYC buildings of AvalonBay (about 190 units), Bozzuto (about 60 floor plans, at their lowest price), Related (about 70; its robots.txt disallows `/search/`, and the reader uses `/search?…`, which that rule does not cover), Greystar (about 120), UDR (about 140), Rockrose (about 46 market-rate units; net-effective prices are kept as advertised), Two Trees (about 13, from the Nestio feed its own site reads) and Stonehenge NYC (about 50, every card on its apartments page, with ZIP codes from the Census geocoder; robots.txt disallows its query-string views, which are not used). Equity Residential (bot challenge), Durst (no apartments on durst.org), Rose Associates (apartments only on each building's own website) are not read. TF Cornerstone (about 125 apartments) is read from the data file its site loads, at each apartment's gross monthly rent. |
| Westchester HomeSeeker | Westchester County's official affordable rentals (10 in November 2026): lotteries, waitlists and first-come rentals with their application and lottery dates, shown in the Affordable tab. Open to the App Store app, like the other official sources. A changed or empty page fails the check rather than reporting none. |
| Checked and not read | CT Housing Search and New Jersey's Housing Resource Center (both run on MyHousingSearch, whose robots.txt disallows its search and unit pages and whose terms allow copying only for personal use), Related (terms require written approval), AvalonBay/Vivmark (terms behind a bot check), Equity, RentCafe, Leasebreak, Point2Homes, ForRent, Rent.com and Rentals.com (refuse or rate-limit automated requests), Rockrose, TF Cornerstone and Listings Project (terms forbid automated access), NYBits (robots.txt disallows its listings), PadMapper (Zumper's listings, already read), Durst (only commercial space), Rose Associates (no rentals), Veris and Ironstate (unit availability is on RentCafe), LeFrak, Fetner and Extell (terms forbid automated access; Extell's units are mostly condos for sale), Tritec (refuses automated requests), Kushner, RXR and Silverstein (their sites list buildings, whose units are on leasing platforms such as RentCafe that block automated access), Moinian and Gotham (listings come from a third-party script that was not traced). Not yet checked: Milstein (milfordmgmt.com), Jeffrey Management and Building and Land Technology (the guessed domains were parked). |
| Rent.com, Apartment Guide, Craigslist, Facebook Marketplace, Linecity, Settled.nyc | Browse links only; not counted as listing feeds. |
| Authorized partner feeds | Optional, see [Partner feeds](#partner-feeds). |

The App Store app (any native build) searches only official feeds and open data: Housing Connect, NYC HDC, Jersey City, FirstMover and authorized partner feeds. Sources read from websites' own pages (Openigloo, the direct rental sources and the landlords' listings) stay in the private web app; the native app links to those sites instead.

A sample source replaces only the listings it confirmed; earlier units stay as cached with their original check dates until a complete check replaces them. Failed sources are reported, never filled in.

## Develop

Requires [Bun](https://bun.sh) at the version in `.bun-version` (1.4.5) for the app, tests and scripts, and Node.js 22.12 or later for Wrangler, Cloudflare's command-line tool, which runs on Node.

**Languages and runtimes.** Every source file is TypeScript, checked in strict mode, with no `any` and no comments that switch the checker off. JSON from the network, storage or a request is `unknown` until the code checks it (`types/strict-json.d.ts`). Every Monday `.github/workflows/sources.yml` runs each source's reader against the live sites (`bun scripts/check-sources.ts`); a reader that no longer recognizes its site fails the run, and GitHub emails you. Sites that refuse automated requests are listed as blocked without failing it.

Code is formatted with Biome (`bun run format`; CI runs `bun run format:check`). `test/typed-codebase.test.ts` fails if a JavaScript or shell file, an `any` or a suppression comes back. Bun runs everything outside production: the tests (`bun test`), the service worker build (`Bun.build`), the scripts (Bun Shell, `Bun.file`, `Bun.spawn`) and the browser tests' web server (`Bun.serve`). In production the Worker runs on Cloudflare's own runtime, workerd, not on Bun, and the two differ in places (workerd refuses `fetch` with `redirect: 'error'`, for example). `bun run test:workerd` runs the built Worker in workerd and calls its main routes, and the test setup refuses what workerd refuses. Wrangler, Cloudflare's tool for local development, builds and deploys, runs on Node.js, its supported runtime; Node is only a tool here. The code itself uses Hono, web-standard and Bun APIs, never `node:` modules, and the Worker runs without Node.js compatibility. Where Hono has a built-in for something (security headers, body size limits, 405 replies, constant-time comparison, the browser tests' static server), the code uses it.

```sh
bun install --frozen-lockfile
bun run db:local     # once: create the D1 tables in the local database
bun run dev          # build the web app and serve it at http://localhost:8787
```

`bun run dev` runs the real Worker locally with Wrangler, a local D1 database and a local Workflow, and sets `PUBLIC_APP=true` so the browser needs no token. Local data stays in `deploy/cloudflare/.wrangler/`. Put optional local credentials in `deploy/cloudflare/.dev.vars` (copy `.dev.vars.example`; Git ignores it). Rebuild after changing the app with `bun run build:web`; Wrangler reloads server changes itself.

`bun run start`, `bun run ios` and `bun run android` open the app in Expo. The native app talks to `https://apartments.5thof6.com` unless `EXPO_PUBLIC_API_URL` names another server (such as `http://localhost:8787`), and signs in with an email code like the web app; it keeps its session in the device's secure storage. **More → Sign out** ends the session.

**App Store builds** use [EAS Build](https://docs.expo.dev/build/introduction/) with the profiles in `eas.json` (`development` for the iOS simulator, `preview` for testers, `production` for the stores; each points at the production server). The App Store build shows only official sources (`SEARCH_DEFAULTS.officialOnly`). The first time, from your own computer:

```sh
bunx eas-cli login
bunx eas-cli init                                  # links the app to your Expo account (adds its project ID to app.json)
bunx eas-cli build --platform ios --profile production
bunx eas-cli submit --platform ios                 # uploads the build to App Store Connect
```

EAS keeps the build number and asks for your Apple Developer account the first time. `assets/icon.png` is the 1024×1024 store icon. App Store Connect also needs screenshots, a privacy policy URL and the privacy answers (the app collects the email you sign in with).

| Variable | Where | Purpose |
| --- | --- | --- |
| `ACCESS_ALLOWED_EMAILS` | Worker secret | Required for sign-in: comma-separated emails that may sign in with an email code. Kept out of the repository. |
| `OPEN_SIGNUPS` | Worker secret or variable | Optional: `true` lets anyone create an account with their email (it starts on the free plan). Without it, only `ACCESS_ALLOWED_EMAILS` can sign in. |
| `PAID_EMAILS` | Worker secret | Optional: comma-separated emails on the paid plan, besides those an admin marks paid on the Profile page. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_PASS` | Worker secrets | Optional: Stripe payments for the paid plan; see Payments above. |
| `ADMIN_EMAILS` | Worker secret | Optional: comma-separated admin emails. Without it, the first address in `ACCESS_ALLOWED_EMAILS` is the admin. |
| `BETTER_AUTH_SECRET` | Worker secret | Turns on email-code sign-in and signs its sessions. Make one with `openssl rand -base64 32`. |
| `APP_ACCESS_TOKEN` | Worker secret | The token scripts send, such as the StreetEasy home sync. |
| `GOOGLE_MAPS_API_KEY` | Worker secret | Street View images on listing cards ([below](#street-view-images-free)). Without it, cards show a map. |
| `STREET_VIEW_MONTHLY_LIMIT` | Worker variable | The most Street View images to request in a calendar month; 9,000 when unset. |
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
bun run lint             # async and bundling rules: no floating promises, no await in loops outside the sync
bun run perf             # speed budgets: the server's main paths against 20,000 seeded listings (docs/performance.md)
bun run perf:bundle      # size budgets for the first download and the Worker (bun run build:web first)
bun run perf:update      # record new budgets after a deliberate change; commit perf/budgets.json
bun run perf:live        # time the live site as a first-time phone visitor
bun run perf:lighthouse  # Lighthouse audit of the running app (bun run dev first); fails below its budgets
```

Tests use `bun:test` (`expect`) throughout. The test preloads (`bunfig.toml`) block external requests (`test/fixtures/offline-network.ts`), so provider tests use synthetic responses and never refresh a real source; keep the expected failure logs out of the report (`test/fixtures/quiet-logs.ts`); and give every test the same stand-in for `cloudflare:workers` (`test/fixtures/cloudflare-workers.ts`). D1 is tested against SQLite with the production schema (`test/fixtures/fake-d1.ts`), and the API is called directly through `test/fixtures/api.ts`.

Coverage measures the application modules: every `.ts` file in `server/` and the non-UI files in `src/`. `test/module-coverage.test.ts` loads them all, so an untested module counts against the total. React UI modules are covered by the Playwright suite instead, which runs the exported web app with mocked API responses on desktop, Android-size and iPhone-size Chromium layouts. Its server sends the production security headers, and `e2e/fixtures.ts` fails any test whose page breaks the Content Security Policy. `scripts/coverage-scope.ts` holds the rules. Bun does not report branch coverage.

GitHub Actions (`.github/workflows/ci.yml`) runs the typecheck, unit tests with coverage, the build and the browser tests on every pull request and every push to main. It uses no secrets and deploys nothing.

## Deploy

Every push to `main` deploys once CI passes (`.github/workflows/deploy.yml`); **Actions → Deploy → Run workflow** deploys by hand. The deploy runs the typecheck and unit tests again, then builds and deploys. It needs the repository secret `CLOUDFLARE_API_TOKEN`, an API token made from Cloudflare's "Edit Cloudflare Workers" template.

To deploy from your own computer instead:

```sh
node ./node_modules/wrangler/bin/wrangler.js login     # or set CLOUDFLARE_API_TOKEN
bun run deploy                                          # build the web app and deploy the Worker
```

`deploy/cloudflare/wrangler.jsonc` defines the Worker, its static assets, the D1 binding, the Workflow (limited to one run at a time), a 30-second CPU limit, and rate limits on the costly routes: 120 searches and 20 address or building lookups a minute per signed-in person (per visitor address when the app is public). A request over the limit gets HTTP 429 and is asked to wait a minute. Before the first deploy from this file, compare it with the live Worker's settings (routes, workers.dev) so the deploy changes only code. Set secrets with `wrangler secret put NAME -c deploy/cloudflare/wrangler.jsonc`. Schema changes are numbered migrations in `deploy/cloudflare/migrations/`; the deploy applies new ones before deploying the code (`wrangler d1 migrations apply --remote`).

To turn on email-code sign-in: set up email (see [Email alerts](#email-alerts)), then `openssl rand -base64 32 | node ./node_modules/wrangler/bin/wrangler.js secret put BETTER_AUTH_SECRET -c deploy/cloudflare/wrangler.jsonc` and deploy. After a change to `server/auth.ts`, `scripts/auth-schema.ts` prints the sign-in tables for a new migration, and a test checks the migrations create them.

Before the first deploy from this file, set the `ACCESS_ALLOWED_EMAILS` secret, or nobody can sign in. The app used Cloudflare Access for sign-in until 2026-11-23; the email-code sign-in replaced it.

`apartments.5thof6.com` used to be served by a separate gate Worker, `apartment-search-access`, which checked a Cloudflare Access sign-in and forwarded requests with the app token. This Worker checks sign-in itself, and the gate Worker was deleted on 2026-11-23.

## Alerts when something breaks

Three things watch the app; two need a minute in the Cloudflare dashboard, because alert recipients are account settings rather than code.

- **Sources (already on).** Every Monday, `.github/workflows/sources.yml` reads each source live. If a reader stops recognizing its site, the run fails and GitHub emails you (GitHub → your avatar → Settings → Notifications → Actions: keep "Only notify for failed workflows" on).
- **Worker failures: Issues (on, in `wrangler.jsonc`).** Cloudflare groups uncaught errors, 5xx replies and logged errors on **Workers & Pages → apartment-search → Issues**. Issues sends automations to webhooks, chat, coding agents or incident tools, not email.
- **An email when errors appear: a Monitor (set up once, by hand).**
  1. In the Cloudflare dashboard, go to **Observability → Alerts → Monitors → Create a Monitor**.
  2. Choose **Threshold**.
  3. Query: dataset **Workers Logs** (Workers Observability), metric **COUNT**, filters **service = apartment-search** and **level = error**.
  4. Evaluation window **15m**, comparison **greater than 0**.
  5. Name it "Walkup errors", add your email as the destination, and set the repeat interval to **24h** so one bad night sends one email.
  6. Select **Create**. Use **Preview** first to check the query matches the Worker's logs.
- **Billing (optional).** **Billing → Spend limits** emails you at 80% and 100% of a monthly amount you choose for Workers.

## Email alerts

Notifications work as soon as the Worker is deployed. Email needs two settings in Cloudflare first, because Email Service only sends from a domain with Email Routing, and free sends go to verified addresses:

1. Email → Email Routing → enable it for `5thof6.com`. The domain has no mail records today, so nothing else changes.
2. Email Routing → Destination addresses → add the address you sign in with, then open the verification email Cloudflare sends.
3. In `deploy/cloudflare/wrangler.jsonc`, add `"send_email": [{ "name": "ALERT_EMAIL" }]` and the variable `"ALERT_EMAIL_FROM": "alerts@5thof6.com"`, then deploy.

Alerts → **Send a test alert** checks both channels. The same email setup sends sign-in codes.

## Daily StreetEasy sync from your own computer

Cloud hosts, including the Worker, get HTTP 403 from StreetEasy, so the sync runs on a computer you own and uploads the result. It downloads the complete partitioned inventory with ordinary requests, requires the count to reconcile with StreetEasy's reported total, uploads it through the authenticated `/api/refresh` import, and then confirms the saved count.

One-time setup on a Mac or Linux computer that is usually on (Bun at the version in `.bun-version` required):

```sh
git clone https://github.com/TannerAWilliams/apartment-search.git && cd apartment-search
bun scripts/install-streeteasy-schedule.ts --origin=https://apartment-search.<subdomain>.workers.dev
```

Use the Worker's own workers.dev URL. The installer asks for the Worker's `APP_ACCESS_TOKEN` and stores it in the macOS Keychain (or `~/.config/apartment-search/token`, mode 600, on Linux). It runs daily at 6:17 local time (`SYNC_HOUR` and `SYNC_MINUTE` change this); on a Mac, a run missed while asleep happens at wake. Logs go to `~/Library/Logs/apartment-search-streeteasy.log` or `~/.config/apartment-search/streeteasy.log`. Run it now with `bun scripts/streeteasy-daily.ts` (add `--manual` to fetch even when saved data is under a day old), and remove it with `bun scripts/install-streeteasy-schedule.ts --uninstall`. If you installed the daily sync before it moved from shell scripts to TypeScript, run the installer again once; it replaces the old job.

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
| `App.tsx`, `index.ts`, `src/` | The Expo app: `screens/` (one per tab), `components/`, `hooks/` (the server connection and saved listings). The non-UI modules directly in `src/` (search, regions, listings, market data) are shared with the server. |
| `server/` | The Worker: `cloudflare.ts` entry (sign-in, rate limits, static files), `api.ts` and `routes/` for the API, `search.ts`, `app-config.ts` and `alerts.ts` behind it, `refresh.ts` runs a refresh and `refresh/` holds its parts (each source's declaration and checks, the saved status, listing snapshots and FirstMover market data), `sync-workflow.ts` runs the complete syncs. |
| `server/sources/` | One reader per listing source, plus `source-registry.ts` (which sources sync their whole inventory) and `public-rentals.ts` (shared page fetching). |
| `server/storage/` | The D1 store (`d1-bucket.ts`), how listings are indexed and their price history recorded, and the schemas saved documents are checked against. |
| `public/` | Files copied into the web build unchanged: `index.html` template, manifest, icons (`scripts/make-icons.ts`) and the StreetEasy dashboard archive, which only the Worker reads. |
| `web/` | The notification service worker in TypeScript, checked against the browser's service worker types and built to `sw.js` by `scripts/build-service-worker.ts`. |
| `types/` | `strict-json.d.ts`: JSON reads return `unknown` in every project. |
| `deploy/cloudflare/` | `wrangler.jsonc`, the D1 `migrations/` and `.dev.vars.example`. |
| `scripts/` | The StreetEasy home sync and its installer, offline data rebuilds, the workerd smoke test, the Lighthouse audit and the coverage report. All run with Bun. |
| `test/`, `e2e/` | Bun unit and integration tests, and the Playwright suite ([e2e/README.md](e2e/README.md)). |
| `docs/`, `investigations/` | Feature and source references, and dated research notes. |
| `TODO.md` | Setup still to do, such as turning on Stripe payments. |

## Street View images (free)

Listing cards can show a Google Street View photo of the building. It is set up to cost nothing (`server/street-view.ts`):

- Google's metadata check, which is free, runs first, so an image is requested only where Street View has one.
- The Worker counts every image in D1 (`street_view_usage`) and stops at 9,000 a month (`STREET_VIEW_MONTHLY_LIMIT`), below Google's free monthly allowance; past it, cards show their map.
- Images go straight to the browser, which keeps each one for a day; the Worker stores nothing, as Google's terms require, and the key never reaches the page.

To turn it on:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project. Google asks for a billing account even for free use; the limits below keep the bill at $0.
2. Under **APIs & Services → Library**, enable **Street View Static API**.
3. Under **APIs & Services → Credentials**, create an API key. Edit it: under **API restrictions**, allow only Street View Static API.
4. Under **APIs & Services → Street View Static API → Quotas**, set **Requests per day** to 300. This is Google's own hard stop, so even a bug in the app cannot go past the free allowance.
5. Save the key as a Worker secret: `node ./node_modules/wrangler/bin/wrangler.js secret put GOOGLE_MAPS_API_KEY -c deploy/cloudflare/wrangler.jsonc`, or in the Cloudflare dashboard under **Workers & Pages → apartment-search → Settings → Variables and Secrets** (type **Secret**).

