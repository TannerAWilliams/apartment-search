# Cross-device sync readiness: November 17, 2026

## What is available, and what is not

The integrated branch contains an unmounted private-shortlist handler with verified-identity isolation and revision conflicts, not an enabled end-user sync feature. The deployed application uses public mode or a shared app password/session; neither supplies individual user identity. Reusing that password as a global personal-notes identity would not be safe multi-user isolation.

Read-only resource checks found no Render PostgreSQL resource in the confirmed workspace. Neon access returned 401; unrelated Railway production databases were not reused. The connected Cloudflare account has no Worker scripts and R2 listing returns 403 asking that R2 first be enabled. The old Sites-managed R2 project marker in this repository is not evidence of an existing usable private bucket in the connected Cloudflare account. No billing, permissions, credentials or resources were changed.

Real PostgreSQL adapter tests now pass on a disposable local PostgreSQL 18.6 instance. That instance was stopped after verification; it is not a production sync service.

## Feasible design without a new identity-provider account

A **self-hosted single-owner passkey/WebAuthn** flow is viable at the existing HTTPS application origin; a managed OIDC account is optional, not mandatory. Use a reviewed implementation such as [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server), fixed expected origin/RP ID, short-lived single-use challenges, required user verification, stored credential public keys/counters and a stable owner ID. Bootstrap must be explicitly owner-authorized, never “the first anonymous registrant becomes owner.” Add second-device enrollment/recovery, session revocation, rate limits and conflict reconciliation. The shared application password is not a substitute for those guarantees.

[WebAuthn](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) requires a secure browser context and real authenticator interaction. The owner must confirm passkey creation on their device; simulated test credentials cannot establish the owner's production identity. Native Expo integration needs separate platform verification; web-browser support is not proof of native support.

## Cost and activation blockers

Passkey authentication need not add an authentication-service subscription. Durable storage is still necessary before enrollment: losing the credential records would lock the owner out or tempt unsafe re-bootstrap. [Render's free web-service filesystem is ephemeral, and its free PostgreSQL expires after 30 days](https://render.com/docs/free), so neither supplies indefinite free persistence as currently configured. [R2 has a free allowance but also billable overage](https://developers.cloudflare.com/r2/pricing/); existing entitlement, private binding and safe usage/billing limits must be verified before promising zero ongoing cost.

Next action: identify/authorize an enduring private store within the owner's cost constraints, then implement and test passkey registration/login, browser/device enrollment and migration preview against that actual target. The owner will need to approve/enroll the first production passkey and choose a recovery method. No new dormant auth adapter or unsafe global notes endpoint was added simply to label sync complete.
