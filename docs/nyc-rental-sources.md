# NYC-area rental sources

Step 1 of the plan: every source → fetch → store in D1 → UI searches D1.

The *In app* column records what code exists in `server/` today. *Inventory* is only
filled in where it has been measured; everything else gets measured in step 2.
Many portals share one feed, so unique apartments are far fewer than the sum of counts.

Status of the D1 database `apartment-search-observations` on 2026-11-20: one StreetEasy
snapshot from 2026-11-18 02:46 UTC with 15,635 listings (80 pages, `v6-daily`). No other
source is stored in D1 yet.

## 1. Major listing portals (most of the inventory)

| Source | Owner / shared feed | In app | Inventory | Data access |
| --- | --- | --- | --- | --- |
| StreetEasy | Zillow Group | Full partitioned sync (`server/streeteasy.ts`) | 15,635 saved (Nov 18) | Site search API. Hosted (Worker/Render) requests get HTTP 403; the full fetch has only worked from a non-hosted network. No public export. |
| Zillow Rentals | Zillow Group | Sample adapter | — | Site search API; no public read API. |
| Trulia | Zillow Group (same feed as Zillow) | Sample adapter | — | Mostly duplicates Zillow. |
| HotPads | Zillow Group (same feed as Zillow) | Sample adapter | — | Mostly duplicates Zillow. |
| Apartments.com | CoStar | Sample adapter | — | Site search; bot protection. |
| ApartmentFinder, ForRent.com, Homes.com | CoStar (shared with Apartments.com) | No | — | Mostly duplicates Apartments.com. |
| Realtor.com | Move / News Corp | Sample adapter | — | Site search API. |
| Redfin Rentals | Redfin / Rent. | Sample adapter | — | Shares inventory with Rent.com. |
| Rent.com, ApartmentGuide.com | Rent. (Redfin) | Browse links only | — | Shares inventory with Redfin. |
| Zumper | Zumper | Sample adapter | — | Site search API. |
| PadMapper | Zumper (same feed) | No | — | Duplicates Zumper. |
| RentHop | RentHop | Sample adapter | — | NYC-heavy; site search. |
| Apartment List | Apartment List | Sample adapter | — | Mostly managed buildings. |
| Compass | Compass | Sample adapter | — | Brokerage portal with many NYC rentals. |
| Craigslist (newyork.craigslist.org/apa) | Craigslist | Browse link only | — | No API; terms prohibit automated collection. |
| Facebook Marketplace | Meta | Browse link only | — | No API; login required. |

## 2. Broker networks and MLSs (the source behind most broker listings)

| Source | In app | Data access |
| --- | --- | --- |
| REBNY RLS (Residential Listing Service) | No | NYC brokers' shared listing service. IDX/VOW access requires a REBNY member brokerage. Closest thing to a complete broker feed. |
| OneKey MLS (Bronx, Queens, Brooklyn, Long Island, Westchester) | No | IDX feed requires a participating broker. |
| NJMLS, Hudson County MLS, Garden State MLS (NJ side) | No | Broker-only IDX feeds. |
| Brokerage sites: Corcoran, Douglas Elliman, Brown Harris Stevens, SERHANT., Bond New York, Nest Seekers, Coldwell Banker Warburg, Keller Williams NYC, Nooklyn | Advertiser names come from the FirstMover snapshot | Each site's own search; their listings mostly also appear on StreetEasy. |

## 3. Landlords, property managers and their leasing platforms

Thousands of landlords list directly. Realistic coverage comes through the leasing
platforms they share rather than one adapter per landlord.

| Source | In app | Data access |
| --- | --- | --- |
| RentCafe (Yardi) | No | Public building pages for many large NYC owners. |
| AppFolio listing pages | No | Many small and mid-size managers use public AppFolio listing pages. |
| Entrata, RealPage, Zillow-hosted building sites | No | Per-building sites. |
| Large owners, for example Beam Living (Stuyvesant Town), Related Rentals, Glenwood, Equity Residential, AvalonBay, Rose Associates, TF Cornerstone, Stonehenge, Brodsky, Gotham, LeFrak, Rockrose, Two Trees, Douglaston, Silverstein, Durst | Brodsky only (`brodsky`) | Each owner's availability page. Usually also on the portals above. |

## 4. NYC-specific, no-fee, sublet and furnished

| Source | In app | Notes |
| --- | --- | --- |
| Openigloo | Sample adapter | Reviews and no-fee listings. |
| FirstMover Open Data | Monthly snapshot (`server/firstmover.ts`) | Published open data; dated, not live. |
| Linecity, Settled.nyc | Browse links only | Data access unverified. |
| Leasebreak | No | Lease takeovers and sublets. |
| Listings Project | No | Weekly email list. |
| June Homes, Blueground, Outpost Club | No | Furnished and flexible-lease operators. |
| SpareRoom, Roomies, Furnished Finder | No | Rooms and furnished stays; optional category. |

## 5. Affordable and government

| Source | In app | Data access |
| --- | --- | --- |
| NYC Housing Connect | Yes (NYC Open Data `vy5i-a666`) | Free open data; lotteries, not individual units. |
| NYC HDC re-rentals | Yes (`server/hdc-rerentals.ts`) | Public JSON API. |
| AffordableHousing.com | Sample adapter | Site search. |
| HPD Mitchell-Lama, NYCHA | Links only | Waitlists, not listings. |

## What this means for step 2 (fetching)

- **No major portal offers a free read API for its full inventory.** The current
  adapters use each site's own search endpoints. Hosted requests are frequently
  refused (StreetEasy returns 403 to Workers), and most portals' terms prohibit
  automated collection.
- **Measured paths that work:** StreetEasy full sync run from a non-hosted network and
  uploaded to the app; Housing Connect and HDC open data from anywhere.
- **Deduplication matters:** Zillow, Trulia and HotPads share one feed; the CoStar sites
  share one; Rent.com, ApartmentGuide and Redfin share one; Zumper and PadMapper share one;
  most broker listings also appear on StreetEasy.
- **Proposed order:** StreetEasy (largest NYC inventory, already working) →
  Zillow group → Apartments.com group → RentHop → Zumper → Realtor.com → Redfin group →
  the rest. Each source counts as done only when its saved count reconciles with the
  count the source reports.

## Steps 3 and 4 (storage and search)

D1 stores each source's current inventory as one versioned snapshot (`apartment_objects`,
split into `apartment_object_parts`), and the Worker searches the saved snapshots in memory,
caching each by its etag. Searches took 60–97 ms in November 2026. A normalized `listings`
table (one indexed row per apartment per source) is the next step only if inventory grows
past what a snapshot search handles quickly.
