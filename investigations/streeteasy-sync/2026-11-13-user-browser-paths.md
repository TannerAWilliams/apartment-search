# User-browser acquisition review: November 13, 2026

Started 11:16:54 p.m. EST; source review and offline checks completed 11:18:31 p.m. EST. Inspected main `f3ad5993fa37c6d4c9d2fcf2c91521b905117a25`. This is an architecture investigation, **not a working StreetEasy sync**.

## What the app already supports

- `App.tsx` sends `{check: 'now', source: 'streeteasy-live'}` for single-source resync. It does not try to upload a StreetEasy browser export automatically.
- `src/pull-sources.ts` browser recovery readers cover FirstMover and Housing Connect, not live StreetEasy.
- The server's authenticated import path can consume current StreetEasy results. `refreshDirectRentals` validates v6-daily raw count equals reported total, total within 20,000, normalized count no greater than total, and check age no more than ten minutes.
- Public anonymous requests may initiate a fetch but may not upload inventory. The Node entrypoint returns403 for imports. Changing that would allow untrusted callers to poison or replace listing data, so it was not changed.
- Offline assertions against main's `isPublicRefresh` passed: ordinary StreetEasy resync is allowed; an import payload is denied both alone and appended to a valid resync. This distinguishes an app import403 from the separately observed upstream403; it does not establish which response a future user sees.
- The UI CSV feature stores at most500 listings as Saved on the device. It is not an all-inventory feed or an acceptable replacement for the requested resync.

## Browser routes assessed

| Route | Concrete limitation |
| --- | --- |
| Open a StreetEasy tab or iframe from the app | Loading a page does not grant the app permission to read another origin's DOM, cookies, or storage. `postMessage` requires a cooperating sender on the source page. |
| Browser fetch with `no-cors` | Response is opaque; JavaScript cannot read the listing body. This does not repair server403. |
| User-invoked browser extension | Can read normally accessible DOM with user-granted page permission. No cookies need to leave the browser. But visible pages are only partial evidence, not proof of complete active inventory. Requires installed extension and approved permissions, absent from this deployment. |
| iPhone Safari extension | Requires an iOS app extension, packaging and distribution/setup, and site permissions. It cannot be delivered merely by changing the hosted page. No install or distribution charges were authorized/incurred. |
| Copy current listing-only export into authenticated importer | Existing ingestion architecture can use it after validation, but a current complete permitted export has not been obtained. This is not a new source or a one-click solution. |
| Forward browser cookies/session tokens to Render | Not selected. This exposes authentication secrets, and a session's existence does not demonstrate permission or reliable complete acquisition. |

## Safe design if a genuine permitted browser acquisition path becomes available

Keep collection on the user's device and only send validated listing fields, never cookies, browser storage, authentication headers, or challenge tokens. Require an explicit user action, source identity and capture time, unique raw IDs, coverage partitions and independently checked totals. Preview the count and reject partial/inconsistent captures. Use an authenticated ingestion boundary; do not enable arbitrary public imports. Persist only after full validation and keep existing cache on any failure. Stop on provider denial/challenge rather than disguising requests or repeatedly retrying.

This is a design prerequisite, not implemented collection. An extension that only copies visible cards would fail the user's full-inventory acceptance requirement and was deliberately not shipped as a fix.

## Evidence and outcome

Primary references:
- [MDN same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [WHATWG Fetch: opaque responses](https://fetch.spec.whatwg.org/)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Apple Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Apple extension permissions](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions)

No production/source requests, CAPTCHA attempts, provider contact, installations, permission changes, or charges. No claim of current coverage. There is still no demonstrated permitted production acquisition route under the current constraints; browser embedding alone cannot supply one. The next useful experiment needs evidence of a genuinely available route, not another deployment of an already-denied request.
