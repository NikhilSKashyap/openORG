# openorg

openorg is a portable record protocol for turning work across an organization
into governed, traceable, training-ready data.

It is not a CRM, project manager, IDE, graph database, or model host. Those are
products and providers. openorg defines the shared facts they can exchange:

- a customer signal and its exact source
- a claim or constraint
- a decision, its alternatives, and its human approval
- a commitment or unit of work
- the artifact produced by that work
- independent verification evidence
- the measured outcome
- a correction that preserves both the rejected and preferred versions

Every record carries provenance, access policy, actor identity, timestamps, and
immutable version history. Typed lineage says how records relate. Agents may
propose causal links. Humans or explicitly configured policies confirm
interpretive claims. Services may confirm only observed mechanical facts such
as `derived_from`, `produces`, `verifies`, and `measures`.

## The reference products

The sibling apps prove that the protocol supports real work rather than another
observability dashboard:

| Product | Port | What it does                                                                                                                                         |
| ------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| openGTM | 4730 | Captures customer evidence, exact words, urgency, and desired outcomes.                                                                              |
| openPM  | 4720 | Turns signals into scoped decisions with alternatives and a human approval gate.                                                                     |
| openFDE | 4710 | Opens authorized customer missions, records delivery artifacts, runs a real test harness, and settles outcomes. SWE and MLE are additional stations. |
| openorg | 4700 | Stores the shared record, enforces the laws, traces journeys, and exports governed data views.                                                       |

The complete reference path is:

```text
source -> signal -> decision -> approval -> work -> artifact -> verification -> outcome
```

## Run it

Requirements: Node.js 22 or newer and pnpm 10.

```sh
pnpm install
cp .env.example .env
pnpm build
pnpm dev:all
```

Open:

- http://localhost:4730 for openGTM
- http://localhost:4720 for openPM
- http://localhost:4710 for openFDE
- http://localhost:4700 for the cross-role journey

To create a complete local example through each product's public HTTP API:

```sh
pnpm seed:golden
```

The script records a customer quote, an approved PM decision, FDE work,
delivery evidence, a real `pnpm test` receipt, and a measured outcome. It prints
the IDs and journey URL. It never invents a passing check.

## Data views

```sh
curl http://localhost:4700/api/export/rag
curl http://localhost:4700/api/export/sft
curl http://localhost:4700/api/export/preference
```

- RAG contains resolved record payloads and policy metadata.
- SFT contains completed task records only when a passing verification is
  linked. Incomplete or merely claimed work is excluded.
- Preference data comes only from explicit correction records that preserve the
  original and corrected versions.

These are local reference exports, not a claim that the current prototype is a
production training pipeline.

## Role-product API vocabulary

Role-product request bodies use one canonical vocabulary:

- `signalRefs`: signal record IDs that supplied customer or organizational context.
- `decisionRefs`: decision record IDs authorizing or constraining the work.
- `successMetrics`: an array of `{ name, target, value }` objects, where `target`
  is the intended result and `value` is the current measured result.

For the short v0.2 migration window, staged role middleware also accepts the
deprecated singular `decisionRef` and deprecated `metric`/`target` pair. The
middleware normalizes those aliases immediately; new clients must send only the
canonical fields. The verifier syncs `.arch/staging/openPM` and
`.arch/staging/openSWE` to their sibling role repositories.

## Packages

- `@openorg/protocol`: versioned Zod contracts and JSON Schemas
- `@openorg/sdk`: client and provider interfaces
- `@openorg/store-memory`: in-process reference store
- `@openorg/store-sqlite`: durable local reference store
- `@openorg/conformance`: adapter contract tests
- `@openorg/workbench-kit`: shared role-product shell
- `@openorg/manifest`: role and station manifests
- `@openorg/server`: API, policy enforcement, journeys, and exports

Storage remains pluggable. A backend counts as compatible only if it passes the
same conformance suite and preserves provenance, versions, gates, corrections,
and lineage.

## Verify it

```sh
pnpm schemas
pnpm test
pnpm build
pnpm lint
pnpm conformance
```

Generated JSON Schemas live in `packages/protocol/schemas`. The default local
database lives at `.openorg/records.db`; set `OPENORG_DB_PATH` to use another
path.

## Current boundary

This is a working local protocol and reference stack. It does not yet ship
enterprise identity, remote connector authentication, policy administration,
hosted collaboration, or model training. Provider health is reported only when
a real checker supplies evidence; otherwise the API says it is unavailable.

## License and contributions

The code is available under the [Apache License 2.0](LICENSE). Contributions
use the [Developer Certificate of Origin 1.1](DCO): sign each commit with
`git commit -s` to certify that you have the right to submit it under this
license. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

The license covers the code, not the project names or logos. See
[TRADEMARKS.md](TRADEMARKS.md) for the trademark policy.
