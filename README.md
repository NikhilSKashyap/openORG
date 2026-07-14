# openorg

OpenOrg is the reference control plane for the Organizational Record Protocol
(ORP) and the draft Organizational Learning Protocol (OLP) 0.1. ORP turns work
across an organization into governed, traceable records. OLP governs when those
verified records may become memory, evaluations, preferences, policy, or
training material.

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

## Document map

Each document has one job:

| Document                                                         | Canonical role                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`CONSTITUTION.md`](./CONSTITUTION.md)                           | The canonical enforced laws. No other document defines a competing law list.                   |
| [`RECORD_PROTOCOL.md`](./RECORD_PROTOCOL.md)                     | The normative ORP envelope, record types, and lineage semantics.                               |
| [`LEARNING_PROTOCOL.md`](./LEARNING_PROTOCOL.md)                 | The normative OLP lifecycle: proposal, eligibility, artifact, evaluation, and human promotion. |
| [`PRIVATE_LEARNING_BOUNDARY.md`](./PRIVATE_LEARNING_BOUNDARY.md) | Current enforcement, threat model, learning runtime, and honest production boundary.           |
| `README.md`                                                      | What exists now, how to run it, and how to verify it.                                          |

## The reference products

The workspace apps prove that the protocol supports real work rather than
another observability dashboard. They ship in this repository so the complete
path runs from one clone:

| Product | Port | What it does                                                                                                                                       |
| ------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| openGTM | 4730 | Captures customer evidence, exact words, urgency, and desired outcomes.                                                                            |
| openPM  | 4720 | Turns signals into scoped decisions with alternatives and a human approval gate.                                                                   |
| openSWE | 4710 | Opens authorized engineering missions, records delivery artifacts, runs a real test harness, and settles outcomes. FDE, SWE, and MLE are stations. |
| openorg | 4700 | Stores the shared record, enforces the laws, traces journeys, and exports governed data views.                                                     |

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

`dev:all` starts the control plane and all three role workbenches. To run only
the protocol and control plane, use `pnpm dev`.

Open:

- http://localhost:4730 for openGTM
- http://localhost:4720 for openPM
- http://localhost:4710 for openSWE
- http://localhost:4700 for the cross-role journey

To create a complete local example through each product's public HTTP API:

```sh
pnpm seed:golden
```

The script records a customer quote, an approved PM decision, FDE work,
delivery evidence, a real `pnpm test` receipt, and a measured outcome. It prints
the IDs and journey URL. It never invents a passing check.

## The private learning boundary

openorg now implements five parts of an enterprise-owned learning loop:

- **Control:** bearer identity, organization-scoped access policy, explicit
  consent, governed exports, dataset manifests, and external egress receipts.
- **Capability:** private evaluation suites, a real in-process logistic
  regression trainer, and a typed adapter for customer-operated VPC trainers.
- **Choice:** replaceable model providers run the same private eval suite.
- **Cost:** routing uses measured quality, latency, and reported cost. Missing
  cost remains unknown and cannot win a lowest-cost route.
- **Compound:** failed independent checks become eval cases; explicit human
  corrections become preference cases and proposed reusable policy. Learning
  remains proposed until exact source versions pass purpose-specific
  eligibility, a governed artifact receives passed independent evaluation,
  and an authenticated human records promotion.

See [PRIVATE_LEARNING_BOUNDARY.md](./PRIVATE_LEARNING_BOUNDARY.md) for the API,
threat model, and honest production boundary.

## Governed data views

```sh
curl http://localhost:4700/api/export/rag
curl http://localhost:4700/api/export/sft
curl http://localhost:4700/api/export/preference
curl http://localhost:4700/api/export/evaluation
```

- RAG contains resolved record payloads and policy metadata.
- SFT contains completed task records only when confirmed lineage links an
  independent passing verification. Incomplete, self-verified, or merely
  claimed work is excluded.
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

For the short v0.2 migration window, role middleware also accepts the deprecated
singular `decisionRef` and deprecated `metric`/`target` pair. The middleware
normalizes those aliases immediately; new clients must send only the canonical
fields.

## Packages

- `@openorg/protocol`: versioned Zod contracts and JSON Schemas
- `@openorg/sdk`: client and provider interfaces
- `@openorg/learning`: real private evals, measured routing, local training,
  and human-gated learning promotion
- `@openorg/store-memory`: in-process reference store
- `@openorg/store-sqlite`: durable local reference store
- `@openorg/conformance`: adapter contract tests
- `@openorg/workbench-kit`: shared role-product shell
- `@openorg/manifest`: role and station manifests
- `@openorg/server`: API, policy enforcement, journeys, and exports

Storage remains pluggable. A backend counts as compatible only if it passes the
same conformance suite and preserves provenance, versions, gates, corrections,
and lineage.

Existing `openorg.*` learning records remain readable during the OLP 0.1
migration. New writes are canonical `olp.*` records. Identity and version are
preserved when a legacy record is normalized.

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

This is a working protocol and reference stack, not a production identity or
training platform. Enforced mode currently uses API keys and static policy
configuration; production SSO/IAM, secret rotation, policy administration,
distributed training queues, and vendor-specific tuning adapters remain the
customer deployment layer. The included local trainer really fits a model, and
the VPC adapter accepts results only when organization, dataset digest,
execution boundary, adapter, and model references agree. Provider health is
reported only when a real checker supplies evidence. Evaluation suites and
reusable policy candidates traverse the full OLP proposal, eligibility,
evaluation, and human-promotion loop. RAG/SFT exports and training jobs do not
yet traverse that entire promotion loop, so their completion is not deployment
approval.

## License and contributions

The code is available under the [Apache License 2.0](LICENSE). Contributions
use the [Developer Certificate of Origin 1.1](DCO): sign each commit with
`git commit -s` to certify that you have the right to submit it under this
license. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

The license covers the code, not the project names or logos. See
[TRADEMARKS.md](TRADEMARKS.md) for the trademark policy.
