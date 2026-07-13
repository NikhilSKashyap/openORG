# openorg Record Protocol 0.2

The protocol separates a portable envelope from role-specific meaning. A GTM
signal, PM decision, and FDE implementation are not generic work records. They
share identity, provenance, access, and integrity fields while keeping typed
payloads that preserve what happened.

## Common Envelope

Every organizational record contains:

- `contract`, `contractVersion`, `id`, and `version`
- `organizationId` and `workspaceId`
- `recordType`
- `occurredAt` and `recordedAt`
- `actor`
- `subjectRefs`
- `source`
- `access`, including classification, policy IDs, and permissions
- typed `payload`
- optional `supersedes` and `correctionOf`

Raw source material may remain in the originating system. In that case the
record stores a governed URI, content hash, source identifier, and the access
policy required to retrieve it.

## Semantic Record Types

| Type           | Meaning                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| `entity`       | Customer, account, product, initiative, mission, repository, service, or release. |
| `source`       | Email, call, transcript, ticket, document, commit, metric, or query.              |
| `signal`       | Pain, request, objection, incident, market change, or behavioral observation.     |
| `claim`        | A human assertion or model interpretation derived from signals.                   |
| `constraint`   | Security, cost, compliance, timeline, data, or architecture limitation.           |
| `decision`     | Direction chosen from alternatives, with rationale and owner.                     |
| `commitment`   | Promise, owner, due date, and recipient.                                          |
| `work`         | Plan, task, human action, agent run, or tool invocation.                          |
| `artifact`     | Design, code, PR, model, document, configuration, or release.                     |
| `verification` | Checks, evidence, verdicts, human approvals, and customer acceptance.             |
| `outcome`      | Measured technical, customer, product, or commercial result.                      |
| `correction`   | Override, rejected recommendation, changed decision, or preferred result.         |

## Runtime Contracts

- `CapabilityManifest` describes a provider and the operations it can perform.
- `ContextEnvelope` records exactly what governed context was supplied to a
  human or agent.
- `LineageAssertion` connects records without depending on a graph backend.
- `DatasetManifest` describes a reproducible RAG, evaluation, preference, or
  training export.

Lineage relationships are typed (`motivates`, `authorizes`, `constrains`,
`implements`, `produces`, `verifies`, `measures`, `corrects`, and others).
Agents may propose relationships but may not confirm them. Humans may confirm
interpretive claims. Services may confirm only observed mechanical facts.

## Storage Layers

1. Original systems remain the source of truth for raw content.
2. A chosen append-oriented record backend stores portable envelopes.
3. Search, vector, graph, memory, and tracing indexes are replaceable derived
   views.
4. openGTM, openPM, and openFDE render and create role-specific records.
5. Dataset exports are policy-filtered snapshots, never the primary store.

## Minimum Cross-Role Proof

A compliant implementation must preserve enough content and lineage to answer,
with citations:

> Which customer signals motivated this product decision, what did FDE build,
> who verified it, and did the customer outcome improve?

An implementation that can only display record identifiers, hashes, or generic
actions does not satisfy the protocol's semantic usefulness requirement.
