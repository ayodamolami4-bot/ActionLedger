# Browser-verification scope

This change adds Chromium smoke tests for ActionLedger's **local simulated tool adapters**, not for actual emails, refunds, or LLM actions.

The standalone browser test creates a refund request, obtains independent reviewer approval, invokes the simulated worker, validates displayed signed receipt verification, and confirms a duplicate idempotency key does not create an extra action.

The React browser test creates a second high-risk request through Vite's proxied API, approves it as a separate demo actor, runs the worker, and checks the displayed terminal state and verified receipts.

A passing check proves only these browser paths work on the CI environment. Screenshots from those runs are fictional test data and must be labeled as such. The server's demo role headers are **not authentication**; never expose the demo API publicly.

## Run locally

Requires Node.js 22.13+, npm access, and installed Chromium.

```sh
npm install
npm install --prefix web
npx playwright install chromium
npm run test:browser
```

Playwright starts the API on port 4400 and Vite on port 5173. Stop other servers on those ports first. On CI, the workflow installs the browser plus system dependencies and uploads screenshots and traces as artifacts.

This verification does not establish production security, real payment-provider semantics, background crash recovery, or cross-browser support.
