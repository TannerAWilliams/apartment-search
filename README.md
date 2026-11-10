# Apartment Search

Compare rentals by asking rent and straight-line distance to your workplace. The same Expo app runs on mobile web, iPhone, and Android. The built-in search, listing links, and rent chart require no paid API or API key.

## Listings and platforms

| Source | What the app imports |
| --- | --- |
| StreetEasy | The latest [FirstMover Open Data](https://www.firstmovernyc.com/open-data) monthly snapshot includes original StreetEasy listing URLs and initial asking rents across NYC and parts of North Jersey. |
| Openigloo | A bounded live sample from its published NYC search interface. The hourly query uses the app’s $2,800 default budget and returns up to ten results. |
| Zillow, Apartments.com, Realtor.com, Redfin, Trulia, HotPads, Zumper, Apartment List, Rent.com, Apartment Guide, RentHop, Craigslist, Facebook Marketplace, and AffordableHousing.com | Search links. The app can retain direct links you save for the same unit. |
| NYC Housing Connect | [NYC Open Data](https://data.cityofnewyork.us/d/vy5i-a666) advertised rental lotteries. The Affordable tab shows application dates, building addresses, and bedroom counts. |
| Authorized no-cost partner feed | Optional. Configure a feed only when you have permission to use and display it at no API cost. The bundled public sources require no feed credentials. |

**Listing websites** shows direct source and saved links for a unit, followed by separate address searches. An address search can surface multiple units in a building. Matching known units uses the normalized street, ZIP, state, and unit number. A shared building address alone does not merge apartments. **Live only** narrows results to recently checked inventory. The **Listing company** filter and company coverage cards use the advertiser field from the dated snapshot, including Compass, SERHANT., Corcoran, Douglas Elliman, Brown Harris Stevens, and other NYC brokerages and managers. Company-site links are separate from the original ad URL supplied by each source. Save or add rentals across all supported regions, including Long Island, Metro-North communities, southwest Connecticut, and eastern Pennsylvania. The saved list stays on the current device.

Snapshot prices are from when the rentals first appeared in the month. Check the original website for current availability or price. Use the Platforms tab to browse current inventory in all supported regions. Transit and driving directions open in Google Maps. The geographic selectors are browse areas. Check driving time for each address in Maps. The app measures straight-line miles to Rockefeller Center by default. Edit the workplace to use a different preset, coordinates, or a full street address.

## Refresh sources

The private hosted app refreshes the FirstMover release catalog, the city’s Housing Connect export, and the limited Openigloo live search. FirstMover publishes monthly. A catalog revision triggers a new CSV download. Housing Connect listings reflect the city’s published export and application dates. The Affordable tab also links to official Mitchell-Lama and Section 8 resources. AffordableHousing.com provides browse and address links. Settled.nyc feed access is unverified.

Use **Platforms → Check public exports now** to check FirstMover and Housing Connect on demand. The hourly job also pulls Openigloo and uses the free U.S. Census batch geocoder for the public addresses. The app stores the last successful data and reports each source’s latest check. A concurrent or repeated check in the same hour reuses the recorded result. The private app serves its refresh runner at `/_refresh-runner.mjs`. The scheduled job downloads it through the owner-only service access, runs it with Node.js, and supplies the service credential on stdin. The runner fetches the public data in the job environment and submits the compressed result to `POST /api/refresh`. It verifies the persisted status with `GET /api/config`. Keep the credential out of files, command arguments, and logs. Routine data refreshes use hosted storage and require no deployment.

## Rent chart

Compare the median initial monthly asking rent for studios and one through four bedrooms. Choose an area by neighborhood, borough or city, or ZIP, and select a row to visualize its sizes. Each value includes the number of observations. The chart uses all included rentals for the selected area, independent of the search budget and distance filters. A blank cell means no observations for that size.

The market chart uses the dated public snapshot so a small live sample cannot skew area medians. It excludes entire houses, townhouses, and commercial or land records where the source identifies them. Duplicate source links and confirmed units are consolidated. The source coverage is NYC and parts of North Jersey. Switch to **Saved listings** to chart rentals you collected in other areas. That chart summarizes the saved list, whose prices can come from different dates.

### Rebuild the offline snapshot

Download a monthly CSV from [FirstMover Open Data](https://www.firstmovernyc.com/open-data). Use Python 3 to regenerate the compressed offline dataset, then rebuild the app.

```sh
python3 scripts/update-market.py /path/to/2026-10.csv 2026-10
npm test
npm run build
```

The data comes from the [FirstMover Open Data Project](https://github.com/benfwalla/firstmover-open-data-project). Its license is included at `src/data/FIRSTMOVER-LICENSE.txt`. The bundled data contains addresses, unit identifiers, asking rents, neighborhoods, coordinates, posting dates, and source URLs. Photos and listing descriptions are excluded.

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
