# Private learning boundary

<!--
Document role: current runtime enforcement, threat model, reference learning
capabilities, and the honest boundary between implemented and production-ready.
-->

openorg lets an organization use replaceable models while retaining the
learning produced by its own work: traces, corrections, evals, decisions,
verification, outcomes, and training artifacts.

It is a protocol and control plane. It is not a hosted model, generic agent
studio, or claim that API keys equal enterprise IAM.

## What is enforced

| Requirement | Runtime behavior                                                                                                                                                                    | Durable evidence                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Control     | Enforced mode authenticates every API request, applies deny-first organization policy, preserves source permissions, and requires scoped consent for external egress.               | Access policy, consent grant, dataset manifest, egress receipt                                        |
| Capability  | The reference trainer fits a real logistic regression model. Customer trainers plug in behind an adapter and must report organization-VPC execution.                                | Dataset digest, training job, metrics, model artifact digest                                          |
| Choice      | Any registered model provider can run the same private evaluation suite.                                                                                                            | Per-case outputs, errors, latency, cost coverage, model and provider IDs                              |
| Cost        | Routing applies measured quality floors and optional latency/cost ceilings before choosing an objective.                                                                            | Routing policy, source evaluation refs, selected or blocked decision with reasons                     |
| Compound    | Failed independent checks become eval cases. Human corrections become preference cases and proposed policy. Exact evidence is checked for its declared learning purpose before use. | OLP proposal, eligibility receipt, governed artifact, independent evaluation, human promotion receipt |

## Governed export transaction

In enforced mode, exports use `POST /api/export/:shape` with:

```json
{
  "purpose": "model-improvement",
  "destination": {
    "kind": "organization_vpc",
    "id": "customer-training-cluster"
  }
}
```

For an `external` destination, the request must also carry a valid
`consentRef`. The consent must cover the authenticated principal, export
action, purpose, destination, organization, expiry, revocation state, and every
exact record ID/version included in the export. A destination-wide grant cannot
silently authorize newly added records.

Every successful export writes a `DatasetManifest`. External exports also
write an `EgressReceipt`. The response exposes both IDs in headers. The content
hash in those records is computed from the exact NDJSON body returned.

## Evaluation, routing, and training

- `POST /api/learning/evaluate` runs persisted eval cases against actual
  registered model providers. A provider that reports the wrong model ID is an
  error. Missing cost is recorded as missing.
- `POST /api/learning/route` chooses only among measured candidates satisfying
  the policy's quality, latency, and cost constraints.
- `POST /api/learning/train/local-logistic` fits a real local model, but only
  when the submitted examples hash to the referenced dataset manifest.
- `POST /api/learning/train-adapter/:id` accepts a customer trainer receipt
  only when its organization, dataset digest, adapter ID, VPC boundary, model
  reference, and artifact all agree.
- `POST /api/learning/promote` creates evals and proposed policy from failures
  and corrections, plus their proposals, eligibility receipts, and governed
  artifacts. It never approves policy.
- `POST /api/learning/evaluate` also records a provider-neutral OLP evaluation
  receipt. A passed verdict requires evidence; independence is derived from
  actor identity.
- `POST /api/learning/promotions` records an authenticated human decision for
  a governed artifact. Approval requires passed independent evaluation of that
  exact artifact version.
- `POST /api/learning/policies/:id/approve` is the policy-specific convenience
  gate. It requires those evaluation receipt IDs, records the OLP promotion
  receipt, and then appends the approved policy version.

The evaluation and reusable-policy path now closes the OLP lifecycle. The
export and trainer endpoints do not yet create a training-purpose proposal,
eligibility receipt, governed model candidate, and human deployment promotion.
Their dataset, job, and artifact receipts are real, but completion must not be
interpreted as deployment approval.

The normative lifecycle and migration rules live in
[`LEARNING_PROTOCOL.md`](./LEARNING_PROTOCOL.md).

## Enforced mode

The reference server reads:

- `OPENORG_SECURITY_MODE=enforced`
- `OPENORG_ACCESS_POLICY_JSON=<AccessPolicyManifest>`
- `OPENORG_API_KEYS_JSON=<token/principal array>`

Production deployments should replace API-key loading with enterprise IAM and
secret management while preserving the same `AuthenticatedPrincipal` and
policy semantics.

## What remains deployment-specific

- SSO, SCIM, KMS-backed key rotation, and policy administration UI
- remote connector OAuth and customer secret management
- a durable distributed evaluation/training scheduler
- concrete tuning adapters for each chosen model platform
- privacy-preserving or confidential-compute trainers where required
- retention execution and deletion attestations

Those are providers and deployment controls. They must not weaken the portable
records, consent checks, dataset binding, or human approval laws.
