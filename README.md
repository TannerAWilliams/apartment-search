# Apartment Search

Compare apartments from lowest asking rent up and filter by the trip to work. The same Expo app runs on iPhone, Android, and mobile web.

- Studio and one through four bedrooms, monthly rent, and exact ZIP filters.
- NYC's five boroughs, northern and central New Jersey, Nassau and Suffolk, the New York Metro-North corridor, and southwest Connecticut.
- Rockefeller Center by default, with other Manhattan hubs and a custom workplace. The distance filter measures straight-line miles. With Google Routes connected, the transit filter uses a selected weekday arrival time and includes walking and transfers as estimated by the routing provider.
- A rental-platform tab with 14 searches or links. Beds, ZIP, and rent are passed where supported. The live list merges confirmed duplicate units across enabled feeds and retains their sources.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run build:web
npm run dev
```

Open http://127.0.0.1:3000. The server starts in preview mode until a live listing feed is configured. Sample rents and locations are labeled in the app. The rental platform links go to their current search pages.

Run `npm start` to open the app in a compatible Expo Go build, or use `npm run ios` and `npm run android` for a simulator or emulator. Native installations use sample results and marketplace links by default. To use a live backend, set `EXPO_PUBLIC_API_URL` to its origin before starting Expo or creating the native build. For a test on your own Wi-Fi, set `HOST=0.0.0.0` and point the phone at the computer's LAN IP and port. Use a random `APP_ACCESS_TOKEN` of at least 24 characters when a live backend is exposed outside loopback, and enter it on the app's filter panel. Use HTTPS for a remote backend. An App Store or Play Store release needs the owner's signing and store setup.

## Enable live searches

Copy `.env.example` to `.env` for local use. For a private hosted deployment, set the same server-only variables in the host's runtime secret settings.

| Setting | What it enables |
| --- | --- |
| `RENTCAST_API_KEY` | Active long-term rental listings from [RentCast](https://developers.rentcast.io/reference/rental-listings-long-term), for apartments, condos, and multifamily units. |
| `PARTNER_FEEDS_JSON` | Authorized listing feeds from MLSs, brokers, or marketplaces that grant you read and display rights. |
| `GOOGLE_ROUTES_API_KEY` | Scheduled public transit duration and route distance via the [Google Routes API](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix). Requires a live listing feed. |

StreetEasy, Zillow, Apartments.com, Realtor.com, Redfin, Trulia, HotPads, Zumper, Apartment List, Rent., Apartment Guide, RentHop, Craigslist, and Facebook Marketplace are browse links unless a licensed feed is configured. For example, Zillow and Apartments.com document feed programs for publishing to their networks. RentCast is an independent feed and its coverage is separate from these sites.

RentCast returns its newest observations first. The server requests one page of up to 500 listings by default, narrows by beds and rent upstream, and then sorts the matching inventory by price. `RENTCAST_MAX_PAGES` allows up to three pages per search. Each page counts as a request. Identical inventory searches share a 15-minute in-process cache. The app marks capped results and feed outages. Transit filtering checks up to 30 of the cheapest candidates with coordinates, because Google bills per route element. Review provider quotas and [RentCast overage pricing](https://developers.rentcast.io/reference/billing-and-pricing) before enabling live searches. Distances and rent are scoped to the returned inventory and selected filters.

### Connect an approved partner feed

Set `PARTNER_FEEDS_JSON` to a JSON array. Each item has a unique `id`, a `name` for a custom provider, an HTTPS `url`, and an optional bearer `token`. For marketplace badges, use the keys defined in `src/marketplaces.mjs`. Each endpoint is a JSON array or an object containing `listings`. Use a small adapter for feeds with a different schema.

```json
[
  {
    "id": "approved-broker",
    "name": "Approved Broker",
    "url": "https://broker.example.com/authorized-rentals",
    "token": "<server-side credential>"
  }
]
```

Each row supplies `id`, `status` (`Active`), `addressLine1`, `addressLine2` or `unit`, `city`, `state`, `county`, `zipCode`, `bedrooms` (studio = 0), and monthly `price`. Include numeric `latitude` and `longitude` to enable workplace filters, `updatedAt` for cross-source freshness, and `listingUrl` for the original listing. Keep the feed to current long-term apartments in the covered market. The adapter reads up to 5,000 rows and labels a capped feed. Separate apartments in the same building remain separate unless the unit is confirmed to match.

## Workplace data

A custom address is sent to the [U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) only when the user submits a search with it. Custom coordinates can be entered directly. Transit mode sends origin and workplace coordinates plus the requested arrival time to Google. The app does not persist work addresses or transit responses. Before enabling Google Routes in a hosted production app, provide publicly accessible terms and a privacy policy referencing [Google's terms](https://policies.google.com/terms) and [privacy policy](https://policies.google.com/privacy) as required by the [Routes API policies](https://developers.google.com/maps/documentation/routes/policies).

## Verify

```sh
npm test
npm run build:web
npx expo export --platform ios --platform android
```

`npm run build` additionally packages the web bundle and API into a Worker for the private hosted version. The `server/` modules run in both the Worker and the local Node server.
