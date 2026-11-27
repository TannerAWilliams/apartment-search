# To do

## Stripe payments

The code is deployed (`server/billing.ts`); payments stay off, and the upgrade buttons hidden, until these are done.

- [ ] Create a Stripe account (or use an existing one) and finish its business details so it can take live payments.
- [ ] Create a product, for example "Walkup Paid", with two prices:
  - [ ] $15 per month, recurring
  - [ ] $35, one time (the three-month pass)
- [ ] Copy both price IDs (`price_…`).
- [ ] Add a webhook endpoint at `https://apartments.5thof6.com/api/billing/webhook` for these events:
  - [ ] `checkout.session.completed`
  - [ ] `invoice.paid`
  - [ ] `customer.subscription.deleted`
- [ ] Copy the webhook's signing secret (`whsec_…`).
- [ ] Turn on the customer portal (Stripe → Settings → Billing → Customer portal) so subscribers can change their card or cancel.
- [ ] Set the four Worker secrets, from `deploy/cloudflare`:
  - [ ] `wrangler secret put STRIPE_SECRET_KEY`
  - [ ] `wrangler secret put STRIPE_WEBHOOK_SECRET`
  - [ ] `wrangler secret put STRIPE_PRICE_MONTHLY`
  - [ ] `wrangler secret put STRIPE_PRICE_PASS`
- [ ] Test end to end with Stripe's test keys first: sign in as a free account, upgrade from Profile with card `4242 4242 4242 4242`, and check that Profile shows the paid date and that alerts can be set. Then switch to the live keys.
- [ ] If the prices change, update `PLAN_LABELS` in `server/billing.ts` so the buttons match.

## Now that the site is public (do these first, in order)

- [ ] Check that sign-in codes reach any address: in a private browser window, open the site, tap **Log in**, and request a code for an email that is not yours (a friend's). Confirm it arrives. If it does not, Cloudflare is only sending to verified addresses; set up Cloudflare Email Service sending for `5thof6.com` (Email → Email Sending) first.
- [ ] Open sign-ups: `wrangler secret put OPEN_SIGNUPS` with the value `true` (from `deploy/cloudflare`). Until this is set, visitors can search but only `ACCESS_ALLOWED_EMAILS` can create an account to save apartments or get alerts; anyone else asking for a code gets none.
- [ ] Try the site as a visitor, in a private window: the home page opens at `/`, the three questions show apartments, Search and Rent prices work, and tapping a heart asks you to create an account.
- [ ] Decide whether StreetEasy's market history (the inventory, price-cut, ranking and best-month cards on Rent prices) stays public or goes back to signed-in members only. It is public now, credited to StreetEasy; ask Claude to switch it if you prefer members only.
- [ ] Have a lawyer check StreetEasy's Data Dashboard terms for showing its figures on a public site (add it to the source review below).
- [ ] Tell search engines about the public site: add `apartments.5thof6.com` to Google Search Console and submit `https://apartments.5thof6.com/sitemap.xml`.

## Before anyone can become a customer (check these first)

The site has one account (yours) and no outside traffic yet. Three settings decide whether a visitor can sign up and pay at all; Claude cannot see or set them.

- [ ] Sign-ups: confirm `OPEN_SIGNUPS` is set to `true` (see "Now that the site is public" below). Without it, a visitor who asks for a sign-in code gets nothing.
- [ ] Sign-in emails: confirm a code reaches an address that is not yours (same section). If it does not, set up Cloudflare Email Sending for the domain.
- [ ] Payments: finish the Stripe steps at the top of this file. Until then the paid plan cannot be bought.
- [ ] Set `CONTACT_EMAIL` in `src/screens/LegalPage.tsx`, so customers have somewhere to write.

## Being found (search engines and AI assistants)

Done in code: the home page, About and Pricing are readable without running the app (headline, live counts, link preview, structured data); `/llms.txt` describes the site for AI assistants; unknown addresses answer "not found"; two free tools are public pages (`/check-building`, `/rent-check`); every neighborhood page opens with a dated answer ("the median asking rent in Astoria is…") and compares it with the borough; every graded building has its own page (`/building/…`) in the sitemap; public pages answer in a fraction of a second from a summary kept beside the inventory.

- [ ] Google Search Console: add the site at [search.google.com/search-console](https://search.google.com/search-console), verify it (the DNS record method works through Cloudflare), and submit `https://apartments.5thof6.com/sitemap.xml`. Only you can do this; it needs your Google login. Do it again for the .nyc address after the move.
- [ ] Bing Webmaster Tools: the same at [bing.com/webmasters](https://www.bing.com/webmasters) (it can import from Search Console). ChatGPT's search draws on Bing's index.
- [ ] A week after submitting, check Search Console's Pages report: the neighborhood pages, building pages, `/check-building` and `/rent-check` should be listed as indexed. Tell Claude which are not.
- [ ] Each month, ask ChatGPT, Claude and Perplexity "what is the average rent in Astoria?" and "is 100 West 86th Street a good building?" and note whether Walkup is cited. That is the only real measure of AI visibility.
- [ ] Decide whether AI training crawlers (GPTBot, ClaudeBot and the others in `DATA_COLLECTORS`, `server/public-pages.ts`) may read the public pages. They are shut out now; assistants answering a live question are allowed.
- [ ] Post where renters already ask: answer questions on r/NYCapartments and r/AskNYC with a link to a building's page or a neighborhood's rents, saying it is your site.
- [ ] Two weeks after the deploy of November 27, check Profile → Dashboard: most listed New York City buildings should have a grade (about 600 are checked each night; roughly two in three addresses match the city's records).
- [ ] Ask Claude to: keep a building's page after its last apartment is rented (it answers "not found" until one is listed again).
- [ ] Ask Claude to: speed up the search page on slow phones (Lighthouse 61; the home page is 86 and public pages 94+).

## Before charging customers

- [ ] Have a lawyer review the Terms of Service and Privacy Policy drafts (`src/screens/LegalPage.tsx`, shown from Profile).
- [ ] Set `CONTACT_EMAIL` in `src/screens/LegalPage.tsx` to the address customers should write to.
- [ ] Have a lawyer review each listing source's terms for commercial use (see `docs/nyc-rental-sources.md`).

## Right after the latest deploy

- [ ] Load the rent-stabilized buildings and subway stations now instead of waiting for the 1 AM run: Profile → Sources & sync → Resync all. Then check Profile → Dashboard → Public data shows about 60,000 buildings and 475 stations.
- [ ] Send yourself a test alert: Profile → Email alerts → Send a test alert. If no email arrives, see the email item above.
- [ ] Choose the admins: `wrangler secret put ADMIN_EMAILS` (comma-separated). Without it, the first address in `ACCESS_ALLOWED_EMAILS` is the only admin.

## Your own domain

- [ ] Buy a .nyc domain, ideally `walkup.nyc` (the registrant needs a street address in the five boroughs; registrars are listed at ownit.nyc). If the registrar is not Cloudflare, point the domain's nameservers to Cloudflare.
- [ ] Ask Claude to move the app to it: the Worker's custom domain, `APP_ORIGIN`, the sender address for codes and alerts, and a redirect from `apartments.5thof6.com`.
- [ ] Move the Stripe webhook to the new domain once it is live.

## App Store

- [ ] Join the Apple Developer Program ($99 a year) and create the app in App Store Connect.
- [ ] From the repo: `bunx eas build --platform ios` (uses `eas.json`), then `bunx eas submit --platform ios`.
- [ ] Fill in the App Store listing: screenshots, description, the privacy policy link (the Privacy Policy page) and the privacy questionnaire (email address and usage data, not used for tracking). Account deletion is in Profile → Your data, as Apple requires.

## Walkup direct

- [ ] Review submitted owner listings: Profile → List your apartment shows admins what is waiting; approve or reject each.

## Optional

- [ ] Exact transit and driving times (optional; estimated transit times are already free and on every listing): TravelTime gives door-to-door times from real timetables. Sign up at traveltime.com, then `wrangler secret put TRAVELTIME_APP_ID` and `wrangler secret put TRAVELTIME_API_KEY` from `deploy/cloudflare`. Its free tier is a trial, so this costs money after that.
- [ ] Load the subway stations, rent-stabilized buildings and the map's transit stops now instead of at tonight's 1 AM run: Profile → Sources & sync → Resync all.

- [ ] Street View photos on cards: add a Google Maps API key as the `GOOGLE_MAPS_API_KEY` Worker secret (free up to about 9,000 images a month; the app stops at that cap).
- [ ] StreetEasy listings: install the daily sync on your own computer (README → Daily StreetEasy sync from your own computer). StreetEasy blocks cloud servers, so it cannot run in the Worker.

## Every year

- [ ] Each January, update the tax brackets in `src/affordability.ts` (federal, New York, New York City, New Jersey, Connecticut) for the new tax year.
- [ ] Each June, after the Rent Guidelines Board votes, update `RGB_INCREASES` in `src/renewal.ts` (the renewal check's one- and two-year increases).
