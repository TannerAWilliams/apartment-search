# Official data-product review: November 13, 2026

Started 11:21:04 p.m. EST. Reviewed official documentation rather than retrying denied infrastructure.

## Question

Is there a documented free integration or export that supplies the complete currently active StreetEasy rental inventory without a new provider agreement, outreach, or access-control circumvention?

## Findings

| Product | Verified purpose | Why it does not fulfill this resync |
| --- | --- | --- |
| [StreetEasy XML feed](https://streeteasy.com/home/feed_format) | Brokers host their own exclusive listings for StreetEasy to ingest. | Direction is into StreetEasy, not an export of StreetEasy inventory. |
| [Zillow Rentals Feed Integrations](https://www.zillowgroup.com/developers/api/rentals/rentals-feed-integrations/) | Free inbound syndication of a management company's listings after approval. | Not read access to the aggregate rental inventory. Requires integration approval. |
| [Zillow MLS Listings / Bridge](https://www.zillowgroup.com/developers/api/mls-broker-data/mls-listings/) | RESO-normalized MLS output, invite-only and subject to each MLS's permission. | No existing access verified and no demonstrated complete StreetEasy coverage. No request was submitted. |
| [StreetEasy Hotsheets](https://support.streeteasy.com/hc/en-us/articles/204553355-What-are-Hotsheets-and-how-do-I-sign-up) | Free agent emails covering newly activated listings since the prior update, plus separate sales/open-house products. | New-listing events do not establish current active inventory. The documentation does not supply the required full baseline plus removal/status-change stream. No signup was attempted. |

The [official listing-ingestion explanation](https://streeteasy.com/blog/how-a-listing-makes-its-way-to-streeteasy/) confirms direct entry and brokerage feeds as inputs. Combining unrelated brokerage subsets cannot honestly be labeled complete StreetEasy coverage.

## Outcome

No documented zero-cost, immediately available full-inventory read route was verified in these official products. This is a bounded search result, not a claim that no authorized route could ever exist. Third-party advertisements claiming a StreetEasy API are not proof of permission, completeness, current availability, or a no-charge entitlement.

No feature was shipped for these products: doing so would substitute an incomplete/different feed for the requested result. No source crawler retry, subscription, outreach, account creation, permission change, or charge occurred. Reading documentation is not live-sync verification.

The live blocker remains acquisition from a supported available route. A useful next attempt requires a new factual prerequisite, such as an already-authorized current full export or verified no-cost supported browser service access; it cannot be supplied by re-labeling an inbound feed or incremental email as all active listings.
