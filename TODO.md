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
