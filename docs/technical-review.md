# Engineering review notes — ActionLedger v0.1

## Tested functionality

Node 22.16, built-in SQLite. Eight passing domain tests covering:
1. idempotent replay under equal request ID/body;
2. conflict on key reuse with changed body;
3. independent approval of high-risk actions;
4. terminal rejection;
5. retry backoff through dead-letter outcome;
6. HMAC receipt tampering detection;
7. state-transition conflict prevention;
8. invalid action policy inputs.

A manual local HTTP smoke test also verified:
- POST create -> HTTP 201, pending_approval;
- POST duplicate -> HTTP 200, replay;
- POST changed content using same key -> HTTP 409;
- same-person reviewer rejected -> HTTP 403;
- another reviewer approval -> HTTP 200;
- worker simulation -> succeeded;
- receipts endpoint -> valid signatures.

Back-end source was typechecked locally with TypeScript 5.8.3 and Node typings made available in the test environment. The project declares a modern TypeScript version for external installation; CI/install with registry dependencies is not yet verified.

## Deliberately not claimed

- No actual AI model invocation, external tool use, payments or email delivery.
- No authenticated production RBAC: demo request headers are impersonable.
- No production-suitable concurrency across multiple worker processes or crash recovery for running items.
- No operational OpenTelemetry deployment, Postgres or Redis integration yet.
- HMAC proves signatures only to holders of the symmetric secret; it is not a publicly verifiable Ed25519 receipt system, append-only log or chained proof of sequence completeness.
- No browser QA of the React UI due unavailable npm dependencies in current environment.

## Next tests before portfolio publication

- npm install and production build for UI and API;
- add API integration tests run in CI;
- simulate process crash while action is `running`, design re-claim with lease expiry;
- evaluate browser errors and accessibility at desktop and mobile widths;
- add true authenticated review authority and tenant scoping;
- add secure provider sandbox with forced timeouts and replay reconciliation.
