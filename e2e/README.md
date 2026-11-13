# Browser regression tests

These tests operate the real exported React Native Web UI with synthetic API responses. They are not proof that providers, Render deployment, CAPTCHA handling, or all application features work.

## Run

Use Node 22.13+ and a browser-capable machine:

```
npm ci
npx playwright install chromium
npm run test:e2e
```

`npm run test:e2e:list` lists cases without launching a browser. Optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium` selects an installed Chromium. Chromium sandbox stays enabled; do not disable it to work around a constrained runner. No hosted paid testing service is used.

The suite builds the actual Expo web bundle, serves it on loopback, blocks external browser requests and mocks every supported `/api` route before navigation. It cannot target production via a baseURL environment override. Unexpected API endpoints get an explicit test failure response. Refresh buttons exercise mocked request handling, not real StreetEasy traffic. Each test has an isolated browser context; saved-listing reload checks only synthetic local storage. Failure traces/screenshots are local under ignored output directories.

## Coverage map

Desktop and mobile Chromium each exercise:

- Homepage all-region search and once-per-session initial refresh.
- StreetEasy HTTP 403 status, failed resync and retained cached listing.
- Resync-all payload and disabled browse-only resync controls.
- Tab clicks and browser back restoration.
- Empty add-listing validation and cancellation.
- Search failure alerts rather than misleading empty success.
- Save, reload persistence and remove.
- Rent filtering and empty results.
- CSV import entry/cancellation.
- Keyboard navigation to Sources.

Still needed: complete successful manual listing/import workflows, deduplication UI, pagination/sort matrix, cooldown races/recovery, rent-chart/affordable feeds, map interactions, accessibility audit, Firefox/WebKit, and independently qualified real provider/deployed-app checks. The existing unit/server tests remain necessary. Do not interpret a green mocked UI suite as complete source coverage or a production resync success.

## Initial verification

2026-11-13: test discovery succeeds. Existing application unit suite: 100 passed; application TypeScript check passed. Browser execution in the authoring environment could not start: installed Chromium aborted before navigation with `socket() failed: Operation not permitted`. Thus these browser assertions have not yet been executed successfully; keep this change draft until run on a suitable machine. Missing bundled browser was separately diagnosed; using installed Chromium confirmed the environment restriction.
