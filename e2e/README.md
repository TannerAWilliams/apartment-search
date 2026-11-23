# Browser regression tests

These tests operate the real exported React Native Web UI with synthetic API responses. They are not proof that providers, the deployed Worker, or all application features work.

## Run

Use the Bun version in `.bun-version` and a browser-capable machine:

```
bun install --frozen-lockfile
bun ./node_modules/playwright/cli.js install chromium
bun run test:e2e
```

`bun run test:e2e:list` lists cases without launching a browser. Optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium` selects an installed Chromium. Chromium sandbox stays enabled; do not disable it to work around a constrained runner. No hosted paid testing service is used.

The suite builds the actual Expo web bundle, serves it on loopback with the production security headers (any Content Security Policy violation fails the test, see `fixtures.ts`), blocks external browser requests and mocks every supported `/api` route before navigation. It cannot target production via a baseURL environment override. Unexpected API endpoints get an explicit test failure response. Refresh buttons exercise mocked request handling, not real StreetEasy traffic. Each test has an isolated browser context; saved-listing reload checks only synthetic local storage. Portrait screenshots and failure traces/screenshots are local under ignored output directories.

## Coverage map

Desktop and mobile Chromium each exercise:

- Homepage all-region saved-inventory search with no automatic provider refresh.
- StreetEasy HTTP 403 status, failed resync and retained cached listing.
- Resync-all payload and disabled browse-only resync controls.
- Search/Saved/More navigation and browser back restoration.
- Applied-filter, expanded-list and scroll restoration through navigation.
- Portrait first-card visibility, list-first map state, filter cancellation/reset and horizontal overflow checks.
- Empty add-listing validation and cancellation.
- Search failure alerts rather than misleading empty success.
- Save, reload persistence and remove.
- Rent filtering and empty results.
- CSV import entry/cancellation.
- Keyboard navigation to Sources.

Still needed: complete successful manual listing/import workflows, deduplication UI, pagination/sort matrix, cooldown races/recovery, rent-chart/affordable feeds, map interactions, accessibility audit, Firefox/WebKit, and independently qualified real provider/deployed-app checks. The existing unit/server tests remain necessary. Do not interpret a green mocked UI suite as complete source coverage or a production resync success.

## Running in a container as root

Chromium's sandbox cannot start as root. In a disposable container, use a local Playwright config that extends `playwright.config.ts` with `launchOptions: { chromiumSandbox: false }` and, if needed, `executablePath`. Keep the sandbox on everywhere else.
