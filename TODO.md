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

- [ ] Transit and driving times on every listing: sign up at TravelTime (traveltime.com, a free developer plan to start) and set the two Worker secrets from `deploy/cloudflare`: `wrangler secret put TRAVELTIME_APP_ID` and `wrangler secret put TRAVELTIME_API_KEY`. Each search then shows a weekday-morning transit time on every card for the destination chosen, saved for a week so repeat searches cost nothing.
- [ ] Load the subway stations, rent-stabilized buildings and the map's transit stops now instead of at tonight's 1 AM run: Profile → Sources & sync → Resync all.

- [ ] Street View photos on cards: add a Google Maps API key as the `GOOGLE_MAPS_API_KEY` Worker secret (free up to about 9,000 images a month; the app stops at that cap).
- [ ] StreetEasy listings: install the daily sync on your own computer (README → Daily StreetEasy sync from your own computer). StreetEasy blocks cloud servers, so it cannot run in the Worker.

## Every year

- [ ] Each January, update the tax brackets in `src/affordability.ts` (federal, New York, New York City, New Jersey, Connecticut) for the new tax year.
- [ ] Each June, after the Rent Guidelines Board votes, update `RGB_INCREASES` in `src/renewal.ts` (the renewal check's one- and two-year increases).
