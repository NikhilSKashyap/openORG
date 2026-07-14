# openSWE

openSWE is the delivery workbench built on the OpenOrg record protocol. It
opens on the FDE station because FDE work connects customer context, product
direction, technical delivery, verification, and outcomes. SWE and MLE are
selectable stations using the same contract.

Work can begin only from an approved openPM decision. The work record preserves
its intent, constraints, tools, models, skills, harnesses, and source context.
The current reference harness runs only the allowlisted `pnpm test` command.
Its real exit code and output digest become a verification record. Passing
verification settles the work as completed; failure marks it blocked. Recording
an outcome advances the immutable work history to the outcome stage.

## Run

From the openORG repository root:

```sh
pnpm install
pnpm dev:all
```

Open http://localhost:4710. To run this workbench by itself after starting the
openORG server, use `pnpm --filter @openorg/open-swe dev`.

```sh
pnpm --filter @openorg/open-swe test
pnpm --filter @openorg/open-swe build
pnpm --filter @openorg/open-swe lint
```

This is a local reference workbench. It does not yet execute arbitrary councils,
remote harnesses, or customer infrastructure.
