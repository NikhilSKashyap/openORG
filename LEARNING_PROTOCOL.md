# Organizational Learning Protocol (OLP)

**Status:** Draft 0.1

**Namespace:** `olp.*`
**Canonical contract version:** `0.1.0`

ORP records what happened. OLP governs what the organization is allowed to
learn from it.

That distinction is the protocol boundary. A correction, failed verification,
customer outcome, or successful piece of work is evidence in ORP. It does not
become memory, an evaluation, a policy, or training data merely because it was
recorded. OLP requires an explicit proposal, an eligibility decision, a
version-bound artifact, measured evaluation, and a human-owned promotion gate.

## 1. Purpose

OLP gives an organization a portable learning loop that can survive changes in
models, agent frameworks, stores, trainers, and clouds. It defines the records
needed to answer five questions:

1. What source evidence is being proposed for reuse?
2. Is that exact evidence permitted and suitable for this learning purpose?
3. What artifact was produced from it?
4. What measured evidence supports using that artifact?
5. Who approved, rejected, retired, or rolled it back?

OLP does not define a hosted model service, vector database, orchestration
framework, or trainer. Those are replaceable providers. OLP defines the
receipts they must preserve.

## 2. Relationship to ORP

ORP is the system of record for organizational work: sources, signals, claims,
decisions, work, artifacts, verification, outcomes, corrections, and causal
lineage.

OLP is the system of record for governed reuse of that work: proposals,
eligibility, datasets, evaluations, routing decisions, reusable policies,
training jobs, model artifacts, and promotion decisions.

The protocols form a closed loop:

```text
ORP evidence
  -> OLP learning proposal
  -> OLP eligibility receipt
  -> OLP artifact or dataset
  -> OLP evaluation receipt
  -> OLP promotion receipt
  -> ORP measured outcome
  -> future OLP proposal
```

OLP may reference ORP records by immutable `id@version` and digest. OLP never
rewrites ORP history. A measured result of deploying an OLP artifact returns to
ORP as an outcome record, so later learning can distinguish an artifact that
passed an offline eval from one that improved work in reality.

## 3. Constitutional inheritance

OLP extends the canonical laws in `CONSTITUTION.md`; it does not create a
second constitution. In particular:

- source precedes summary;
- observation and inference remain distinct;
- versions are immutable;
- agents may propose causal lineage but may not confirm it;
- verification identity and evidence survive;
- self-verification is not independent evidence;
- corrections preserve both rejected and preferred versions;
- unknown quality, cost, or provenance remains unknown;
- external egress requires explicit policy and consent.

OLP adds one lifecycle rule: **recorded does not mean eligible, and eligible
does not mean promoted.** Each transition requires its own receipt.

## 4. Core records

### 4.1 `olp.learning-proposal`

A request to reuse exact organizational evidence for one purpose: `rag`,
`evaluation`, `preference`, `policy`, or `training`.

The proposal binds every source to an immutable ORP record version and content
digest. It states the purpose, rationale, applicable policy and consent
references, requesting identity, and workspace. A proposal may be withdrawn;
it cannot be silently repurposed.

### 4.2 `olp.eligibility-receipt`

The decision on whether the proposal may proceed. It records explicit checks
for provenance, access, consent, verification, and measured outcome. Every
check is `passed`, `failed`, or `not_applicable`, with evidence and reasons.

An `eligible` receipt must bind the same source versions and digests as its
proposal. It may not omit a required check for the stated purpose. A blocked
receipt is still valuable evidence: it says why learning did not occur.

### 4.3 Learning artifacts

OLP artifacts include:

- `olp.learning-artifact` for governed RAG memory, preference sets, policy
  candidates, and other provider-neutral artifacts;
- `olp.dataset-manifest` for exact exported datasets;
- `olp.evaluation-suite` and `olp.model-evaluation` for private evals;
- `olp.routing-policy` and `olp.routing-decision` for measured model choice;
- `olp.reusable-policy` for a proposed or human-approved operating rule;
- `olp.training-job` and `olp.model-artifact` for customer-bound training.

Every artifact refers back to its proposal or exact source records. Provider
storage may differ, but the references, digests, and decisions must round-trip.

### 4.4 `olp.evaluation-receipt`

A provider-neutral judgment over an artifact. It names the artifact, evaluator,
evaluation records, metrics, evidence, and verdict. A passed verdict without
evidence is invalid. Independent evaluation is derived from identities; it is
not a label the caller may simply assert.

### 4.5 `olp.promotion-receipt`

The human-owned decision to approve, reject, retire, or roll back an artifact
for a named target such as memory, routing, policy, or a deployed model.

Approval requires passed, independent evaluation evidence over the exact
artifact version. Rollback names the prior promotion it reverses. Retirement
and rollback do not delete history. They append a new decision so the
organization retains the preference pair and the reason.

## 5. Eligibility by purpose

All purposes require provenance, access, and consent evaluation. A check may be
`not_applicable` only when its reason is explicit and mechanically defensible,
for example an in-boundary operation for which no egress consent is required.

Additional requirements:

| Purpose    | Additional required evidence                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------ |
| RAG        | source content is resolvable and permitted for retrieval                                         |
| Evaluation | expected behavior comes from a human correction or independent verification                      |
| Preference | rejected and preferred versions are both preserved                                               |
| Policy     | verified evidence and a measured outcome support generalization                                  |
| Training   | verified evidence, measured outcome, governed dataset digest, and an approved execution boundary |

The protocol rejects an eligible receipt if a required check failed, is
missing, or references a different source version or digest.

## 6. Lifecycle and state transitions

```text
proposed -> eligible -> produced -> evaluated -> promoted
     |          |           |            |          |
 withdrawn    blocked     revoked      failed     retired
                                                   |
                                               rolled_back
```

Transitions are append-only. They never mutate a prior receipt. A later
proposal may supersede an earlier proposal, but it receives a new version and
re-runs eligibility against the then-current policies and consent.

Promotion is not automatic. An agent or service may generate a proposal,
eligibility evidence, artifact, and evaluation. A human identity owns the
promotion decision. An organization may encode policy-assisted approvals later,
but OLP 0.1 deliberately keeps promotion human-owned.

## 7. Consent, revocation, and egress

Consent is evaluated for the declared purpose and destination, not treated as
a timeless blanket. Revoked or expired consent blocks new eligibility. A
previously produced artifact whose legal or policy basis is revoked must receive
a revocation or retirement record before further use.

Nothing crosses the organization boundary merely because it is eligible for
learning. Export and external training remain separate egress actions governed
by OpenOrg access policies, consent grants, and egress receipts. OLP references
those receipts; it does not bypass them.

## 8. Threat model

OLP 0.1 is designed to resist:

- **source substitution:** swapping a different record version after approval;
- **digest drift:** training on bytes that do not match the dataset manifest;
- **self-grading:** an actor calling its own judgment independent;
- **consent laundering:** reusing consent for a different purpose or destination;
- **silent promotion:** activating memory, policy, routes, or weights without a gate;
- **history erasure:** deleting a failed policy, rejected output, or rollback;
- **provider lock-in:** losing provenance or decisions when changing stores or models;
- **unknown-as-zero:** treating absent quality, cost, or evidence as favorable.

Cryptographic signing, key management, hardware attestation, and confidential
compute are provider capabilities above the protocol. OLP preserves the fields
and receipts needed to verify them when present; it does not claim to provide
them by itself.

## 9. Worked example

An agent routes a pricing request to support.

1. ORP records the work and an independent failed verification.
2. A human correction preserves `support` as rejected and `sales` as preferred.
3. A service emits an `olp.learning-proposal` for `evaluation`, binding the
   correction and verification by version and digest.
4. An `olp.eligibility-receipt` confirms provenance, access, purpose-specific
   consent, and independent verification.
5. The correction becomes a case in an `olp.evaluation-suite`.
6. Candidate models produce `olp.model-evaluation` records. Unknown cost stays
   unknown; it is not treated as free.
7. A human approves a measured routing policy through an
   `olp.promotion-receipt`.
8. Production routing outcomes return to ORP. If the policy performs worse, a
   rollback receipt preserves both the failed policy and the corrective choice.

The organization now owns a portable chain from mistake to correction to eval
to policy to measured outcome. Changing model or storage providers does not
erase why the system learned.

## 10. Namespaces, versions, and migration

New OLP records use `olp.*` and contract version `0.1.0`.

The pre-OLP prototypes used these OpenOrg names:

```text
openorg.dataset-manifest
openorg.evaluation-suite
openorg.model-evaluation
openorg.routing-policy
openorg.routing-decision
openorg.model-artifact
openorg.training-job
openorg.reusable-policy
```

OpenOrg runtimes must accept those records as legacy aliases and normalize them
to their canonical `olp.*@0.1.0` form at the boundary. Existing stored records
remain readable. New writes must emit only canonical OLP contracts. Migration
must not change IDs, record versions, source references, or content digests.

## 11. Conformance

An OLP implementation is conformant only if its adapter tests prove:

1. canonical records round-trip without loss;
2. legacy aliases normalize to canonical OLP records;
3. source `id@version` and digest bindings survive storage and export;
4. an eligibility receipt cannot pass with missing or failed required checks;
5. an evaluation cannot claim evidence it does not carry;
6. promotion requires an authenticated human and passed independent evaluation
   of the exact artifact version;
7. revocation, retirement, and rollback append history rather than deleting it;
8. unknown quality or cost cannot win a routing decision;
9. external egress remains separately authorized and receipted;
10. the golden loop can be replayed from ORP evidence through OLP promotion and
    back to an ORP measured outcome.

Passing JSON Schema validation alone is not conformance. The lifecycle laws and
adversarial cases are part of the protocol.

## 12. Current boundary

OLP 0.1 specifies the records and laws for private evals, governed datasets,
measured routing, local or VPC-bound training adapters, policy candidates, and
human promotion. The reference runtime is intentionally small.

The reference runtime currently closes the full proposal-to-promotion loop for
evaluation suites and reusable policy candidates. RAG/SFT export and trainer
endpoints bind exact records, dataset digests, execution boundaries, jobs, and
model artifacts, but they do not yet originate and promote a purpose-specific
OLP artifact before use. A completed export or training job is therefore a
receipt, not proof that memory or a model was approved for deployment.

It does not yet claim production key management, distributed policy
administration, confidential-compute attestation, fleet scheduling, or a
general-purpose trainer. Those capabilities may plug in later without changing
who owns the learning record: the organization.
