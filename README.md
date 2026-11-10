# Apartment Search

Compare rentals by asking rent and weekday-morning transit or driving time to your workplace. The same Expo app runs on mobile web, iPhone, and Android. The built-in search, listing links, and rent chart require no paid API or API key.

## Listings and platforms

| Source | What the app imports |
| --- | --- |
| StreetEasy | The [FirstMover Open Data](https://www.firstmovernyc.com/open-data) monthly snapshot supplies initial asking rents and original listing URLs. Direct live updates require an authorized feed. |
| Openigloo | A bounded live sample from its published NYC search interface. The query uses the app’s $5,000 default budget and returns up to ten results. |
| Zillow, Compass, RentHop, and Realtor.com | Last saved samples and browse links. Automatic updates require an authorized feed. |
| Trulia | Apartments at or below $5,000 with exact unit prices in Hicksville, Stamford, White Plains, and Jersey City. |
| Zumper | Individual apartments with exact prices from public searches in NYC, Jersey City, White Plains, and Stamford. |
| AffordableHousing.com | Apartments marked available now in Brooklyn, Newark, and Stamford. The importer uses the free U.S. Census batch geocoder when coordinates are available by exact address. |
| Apartments.com, Redfin, HotPads, Apartment List, Rent.com, Apartment Guide, Craigslist, and Facebook Marketplace | Browse links. Add a listing manually or import a CSV of collected listings to Saved. |
| NYC Housing Connect | [NYC Open Data](https://data.cityofnewyork.us/d/vy5i-a666) advertised rental lotteries. The Affordable tab shows application dates, building addresses, and bedroom counts. |
| Authorized no-cost partner feed | Optional. Configure a feed only when you have permission to use and display it at no API cost. The bundled public sources require no feed credentials. |

**Listing websites** shows direct source and saved links for a unit, followed by separate address searches. An address search can surface multiple units in a building. Matching known units uses the normalized street, ZIP, state, and unit number. A shared building address alone does not merge apartments. **Live only** narrows results to recently checked inventory. The **Listing company** filter and company coverage cards use the advertiser field from the dated snapshot, including Compass, SERHANT., Corcoran, Douglas Elliman, Brown Harris Stevens, and other NYC brokerages and managers. Company-site links are separate from the original ad URL supplied by each source. Save or add rentals across all supported regions, including Long Island, Metro-North communities, southwest Connecticut, and eastern Pennsylvania. The saved list stays on the current device.

Snapshot prices are from when the rentals first appeared in the month. Check the original website for current availability or price. Use the Platforms tab to browse current inventory in all supported regions. Transit and driving directions open in Google Maps. The geographic selectors are browse areas. Edit the workplace to use a different preset, coordinates, or a full street address. The default workplace is Rockefeller Center.

Results default to **Recently checked**, with recently checked listings first, ordered by asking rent. **Lowest rent**, **Fastest transit**, and **Fastest drive** sort all matching rentals before limiting the displayed list. Use **Import CSV** to add up to 500 collected listings per file to this device’s Saved list. The header is `url,address,unit,city,state,zip,bedrooms,rent` with optional `county,neighborhood,latitude,longitude` columns. Use studio = 0, five-digit ZIPs, and plain numeric rents. Coordinates are optional and support map placement when provided.

## Commute estimates

Open **Commute**, choose your workplace, and optionally enter maximum transit and driving minutes. When both limits are set, a rental must meet both. Searches calculate typical weekday-morning trips from geocoded rentals to work using the [TravelTime matrix](https://docs.traveltime.com/api/reference/time-filter-fast), with no live-traffic guarantee. Estimates over three hours and routes the provider cannot find appear as unavailable.

Set `TRAVELTIME_APP_ID` and `TRAVELTIME_API_KEY` on the server to enable automatic estimates when the app opens or runs a search. The app only sends coordinates to the routing provider. When routing is disconnected, the app keeps ordinary rent and map search available and hides the commute limits.

## Refresh sources

The private hosted app checks FirstMover’s published monthly exports, the city’s Housing Connect export, and the active rental sources above. The FirstMover check uses the publisher’s release links and conditional requests for the CSV. Housing Connect listings reflect the city’s published export and application dates. The Affordable tab also links to official Mitchell-Lama and Section 8 resources. Settled.nyc feed access is unverified.

Open or reload the hosted web app to check sources. **Platforms → Refresh listings now** runs the same check. Overlapping reloads share one check. Sources that rate-limit the app wait until their retry time. The browser can retry failed public exports when the source permits another check. The app labels previous results with their last successful check and keeps them in **All results**. **Live only** shows successfully checked inventory from the last two hours. Openigloo uses the free U.S. Census batch geocoder for its public addresses.

The private app also serves a manual Node.js refresh runner at `/_refresh-runner.mjs`. Download it through owner-only service access and pass the service credential on stdin. Keep the credential out of files, command arguments, and logs.

## Rent chart

Compare six months of median initial asking rents for studios through four bedrooms. Choose a neighborhood, borough or city, or ZIP, and pin up to two areas to compare with your selection. Choose **By bedroom** for the latest snapshot’s size breakdown. Each value includes its listing count, and months with missing observations appear as gaps. The chart uses all included rentals for the selected area, independent of the search budget and commute filters.

The market chart uses the dated public snapshot so a small live sample cannot skew area medians. It excludes entire houses, townhouses, and commercial or land records where the source identifies them. Duplicate source links and confirmed units are consolidated. The source coverage is NYC and parts of North Jersey. Switch to **Saved listings** to chart rentals you collected in other areas. That chart summarizes the saved list, whose prices can come from different dates.

### Rebuild the offline snapshot

Download a monthly CSV from [FirstMover Open Data](https://www.firstmovernyc.com/open-data). Use Python 3 to regenerate the compressed offline dataset, then rebuild the app.

```sh
python3 scripts/update-market.py /path/to/2026-10.csv 2026-10
npm test
npm run build
```

The data comes from the [FirstMover Open Data Project](https://github.com/benfwalla/firstmover-open-data-project). Its license is included at `src/data/FIRSTMOVER-LICENSE.txt`. The bundled data contains addresses, unit identifiers, asking rents, neighborhoods, coordinates, posting dates, and source URLs. Photos and listing descriptions are excluded.

Run `node scripts/update-rent-history.mjs /path/to/months/20*.csv` with dated FirstMover CSVs to rebuild the offline trend data. Hosted refreshes retain the previous month’s medians when a new monthly release arrives.

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

Set `FREE_PARTNER_FEEDS_JSON` in the server environment to an array of approved no-cost HTTPS endpoints. Each item needs a unique `id`, a `name` for a custom source, a `url`, and an optional bearer `token`. Use IDs from `src/marketplaces.mjs` for a platform badge. The endpoint returns a JSON array or an object with `listings`.

Each row supplies an ID, `status: "Active"`, `addressLine1`, a unit if known, `city`, `state`, `county`, `zipCode`, `bedrooms` (studio = 0), and monthly `price`. Include numeric `latitude` and `longitude`, `neighborhood`, `updatedAt`, and an HTTPS `listingUrl` for the original listing. Only source URLs supplied by the feed are presented as direct links. The server reports unavailable or capped feeds separately.

## Verify

```sh
npm test
npm run build:web
npx expo export --platform ios --platform android
```

`npm run build` also packages the web bundle and server into the private hosted Worker.
