# StreetEasy Cloudflare container test

A one-off check of whether StreetEasy serves its inventory to a Cloudflare container.
It is a separate Worker (`streeteasy-container-test`); deploying it does not change the
live `apartment-search` Workers or D1. It uploads nothing to the app.

Requires the Workers Paid plan (Containers are not available on Workers Free).

```sh
bun cloudflare/streeteasy-container-test/build.ts
cd cloudflare/streeteasy-container-test
openssl rand -hex 32 | tee test-token.txt | npx wrangler@4 secret put TEST_TOKEN   # after the first deploy
npx wrangler@4 deploy
curl -X POST -H "Authorization: Bearer $(cat test-token.txt)" https://streeteasy-container-test.<subdomain>.workers.dev/run
curl -H "Authorization: Bearer $(cat test-token.txt)" https://streeteasy-container-test.<subdomain>.workers.dev/status
```

`/run` starts the container once; later calls return the recorded result instead of
running again. The container runs the same loader as the home sync. The first refused
request stops it, with no retries. `status.result.httpStatus` is `403` when StreetEasy
refuses; `ok: true` with `total` and `listings` means it served the full inventory.

Remove it afterwards with `npx wrangler@4 delete` from this folder.
