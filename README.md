# Apartment Search

Compare rentals by asking rent and straight-line distance to your workplace. The same Expo app runs on mobile web, iPhone, and Android. The built-in search, listing links, and rent chart require no paid API or API key.

## Listings and platforms

| Source | What the app imports |
| --- | --- |
| StreetEasy | The October 2026 [FirstMover Open Data](https://www.firstmovernyc.com/open-data) snapshot includes original StreetEasy listing URLs and initial asking rents across NYC and parts of North Jersey. |
| Zillow, Apartments.com, Realtor.com, Redfin, Trulia, HotPads, Zumper, Apartment List, Rent.com, Apartment Guide, RentHop, Craigslist, and Facebook Marketplace | Search links. The app can retain direct links you save for the same unit. |
| Authorized no-cost partner feed | Optional. Configure a feed only when you have permission to use and display it at no API cost. There are no live feeds configured in the default build. |

**Listing websites** shows direct source and saved links for a unit, followed by separate address searches. An address search can surface multiple units in a building. Matching known units uses the normalized street, ZIP, state, and unit number. A shared building address alone does not merge apartments. Save or add rentals across all supported regions, including Long Island, Metro-North communities, and southwest Connecticut. The saved list stays on the current device.

Snapshot prices are from when the rentals first appeared in the month. Check the original website for current availability or price. Use the Platforms tab to browse current inventory in all supported regions. Transit directions open through a Google Maps link. The app measures straight-line miles to Rockefeller Center by default. Edit the workplace to use a different preset, coordinates, or a full street address.

## Rent chart

Compare the median initial monthly asking rent for studios and one through four bedrooms. Choose an area by neighborhood, borough or city, or ZIP, and select a row to visualize its sizes. Each value includes the number of observations. The chart uses all included rentals for the selected area, independent of the search budget and distance filters. A blank cell means no observations for that size.

The market chart uses the dated public snapshot. It excludes entire houses, townhouses, and commercial or land records where the source identifies them. Duplicate source links and confirmed units are consolidated. The source coverage is NYC and parts of North Jersey. Switch to **Saved listings** to chart rentals you collected in other areas. That chart summarizes the saved list, whose prices can come from different dates.

### Refresh the public snapshot

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
