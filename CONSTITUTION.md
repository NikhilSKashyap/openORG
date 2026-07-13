# openorg Constitution

<!--
Document role: the single canonical list of enforced protocol laws.
Each law must map to contracts, runtime enforcement, or conformance evidence.
-->

openorg is the portable record and trust protocol shared by openGTM, openPM,
openSWE, and compatible enterprise tools. It preserves how source signals
become decisions, work, evidence, and measured outcomes without owning the
organization's storage, models, editors, or business systems.

## Laws

1. **Source before summary.** Every derived record links to the source material
   or governed source reference that supports it.
2. **Observation and inference remain distinct.** Human assertions, model
   inferences, deterministic observations, and policy confirmations are never
   collapsed into one truth state.
3. **Activity is not outcome.** A completed task, shipped artifact, passed test,
   and customer result are separate records.
4. **Verification requires evidence.** A verdict identifies its verifier,
   policy, checks, and evidence. Confidence alone cannot verify work.
5. **Authority is explicit.** Every approval and causal confirmation records
   who or what was authorized to make it.
6. **Corrections append.** Corrections and superseding decisions preserve the
   original record and become preference evidence.
7. **Access follows the source.** Derived indexes and context delivery cannot
   expand the permissions of source material.
8. **Raw data is minimized.** Sensitive content stays in its source system or
   governed object store when a permissioned reference is sufficient.
9. **Training is intentional.** Dataset exports record purpose, policy,
   inclusion criteria, exclusions, schema versions, and reproducible hashes.
10. **Portability is mandatory.** Stores, graphs, memory systems, agents, and
    interfaces are providers. An organization can replace them without losing
    protocol semantics.
11. **Provider health is proven.** A provider cannot report healthy without a
    real capability check and evidence from that check.
12. **Human judgment survives automation.** Overrides, rejected alternatives,
    approvals, and reasons are first-class records.
13. **Identity precedes access.** In enforced mode every API action is bound to
    an authenticated principal, organization, permissions, purpose, and
    destination. Deny rules take precedence.
14. **Egress is a transaction.** External exports require explicit human
    consent scoped to every exported record version and leave a dataset
    manifest plus an immutable egress receipt.
15. **Evaluation defines choice.** Models are interchangeable only after they
    run the same private evaluation suite. Unknown quality, latency, or cost is
    never rewritten as zero or assumed acceptable.
16. **Training is bound to evidence.** A training job names its governed
    dataset and proves the exact input digest, execution boundary, adapter, and
    resulting artifact.
17. **Learning proposals do not self-promote.** Failures may become evaluation
    cases and corrections may become policy proposals. OLP requires exact
    eligibility, passed independent evaluation, and an authenticated human
    promotion before governed learning becomes active.

## Verification Integrity

Verification policy is configurable. Verification integrity is not. Different
roles may require different checks, but no policy may silently promote missing
or failed evidence to a verified state. Self-verification is allowed only when
declared, and it remains distinguishable from independent verification.

## Causal Integrity

Lineage assertions declare their basis (`observed`, `asserted`, or `inferred`),
state (`proposed`, `confirmed`, `rejected`, or `superseded`), authority, and
evidence. Deterministic relationships may be confirmed by policy. Semantic or
high-risk causal claims require an authorized human confirmation.
