# openPM

openPM is the product-decision workbench built on the OpenOrg record protocol.
It reads customer signals from openGTM, then records the problem, rationale,
alternatives, scope, non-goals, and success metric as a proposed decision.

A decision does not become approved because an agent says so. The approval
button appends a human-authored decision version and a verification record.
That approved decision can authorize work in openSWE.

## Run

From the openORG repository root:

```sh
pnpm install
pnpm dev:all
```

Open http://localhost:4720. To run this workbench by itself after starting the
openORG server, use `pnpm --filter @openorg/open-pm dev`.

```sh
pnpm --filter @openorg/open-pm test
pnpm --filter @openorg/open-pm build
pnpm --filter @openorg/open-pm lint
```

This is a local reference product, not a replacement for an existing issue
tracker. Issue trackers can become providers for the same decision contract.
