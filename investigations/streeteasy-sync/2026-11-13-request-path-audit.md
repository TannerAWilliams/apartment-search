# Request-path audit: November 13, 2026

- Started: 11:10 p.m. EST. Offline checks completed: 11:14:34 p.m. EST.
- Inspected main: `aef99a050799fc1ed33d1d57f84b36dfe6674526`.
- Hypothesis: the deployed relay might construct a different listing query or turn an internal error into an apparent provider 403.

## Results

Inspected `server/sources/streeteasy.ts`, `relay-client.ts`, `relay-policy.ts`, and `relay-service.ts`. An offline Node 24.22.1 experiment injected a fake fetch into the actual loader and compared its request with the relay reconstruction:

- Same upstream endpoint and POST method.
- Same GraphQL query after removing whitespace, including fields and search filters.
- Headers are not identical: direct fetch includes a fixed browser User-Agent; relay intentionally omits it. This is **not evidence that the header explains the block** and is not a recommendation to impersonate a browser.
- An injected 403 remains a 403 through the relay client/loader; the loader made exactly one attempted fetch before failing.
- Relay service source inspection distinguishes internal authentication (401), route (404), input validation (422), and rate/concurrency (429) failures from the forwarded upstream status.

The experiment used an empty synthetic listing response and a synthetic failure. It made **zero real upstream requests** and cannot establish live access, inventory completeness, or persistence. No production deployment or configuration changed.

## Outcome and next prerequisite

No request-construction defect was demonstrated that would resolve StreetEasy's upstream denial. The historical workspace result does not provide an application-callable endpoint or credentials that can be deployed to Render. Repeating the same denied request or changing headers without evidence is not a fix.

Cloudflare Browser Run remains a separate unverified option, not a successful result: account-specific plan and remaining free allowance must be verified before any execution under the no-spending requirement. No browser usage was started. A supported, permitted production acquisition route is still missing. Live resync remains unresolved; cached data and access settings were left unchanged.
