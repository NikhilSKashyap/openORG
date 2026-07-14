# openGTM

openGTM is the customer-evidence workbench built on the OpenOrg record
protocol. It preserves the source, exact customer words, desired outcome,
urgency, severity, account, and access classification instead of reducing a
conversation to a generic activity event.

Captured evidence becomes a typed `signal` that openPM can use as the basis for
a product decision. The source-to-signal link is mechanically attested and
content-addressed.

## Run

From the openORG repository root:

```sh
pnpm install
pnpm dev:all
```

Open http://localhost:4730. To run this workbench by itself after starting the
openORG server, use `pnpm --filter @openorg/open-gtm dev`.

```sh
pnpm --filter @openorg/open-gtm test
pnpm --filter @openorg/open-gtm build
pnpm --filter @openorg/open-gtm lint
```

This is a local reference product. Salesforce, Zoom, email, and other named
sources are provenance labels until a real authenticated connector is added.
