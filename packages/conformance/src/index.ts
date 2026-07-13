import {
  checkEvaluationIndependence,
  checkLearningEligibility,
  checkLearningPromotion,
  checkPromotionEvaluations,
  normalizeOlpRecord,
  type AccessPolicyManifest,
  type ConsentGrant,
  type EligibilityReceipt,
  type EvaluationReceipt,
  type EvaluationSuite,
  type LearningArtifact,
  type LearningProposal,
  type LineageAssertion,
  type OrgRecord,
  type PromotionReceipt,
  type VerificationReceipt,
  type WorkRecord
} from "@openorg/protocol";
import type { StoreProvider } from "@openorg/sdk";

export type ConformanceResult = { checks: string[] };
const equal = (
  actual: unknown,
  expected: unknown,
  name: string,
  checks: string[]
) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`conformance failed: ${name}`);
  checks.push(name);
};
export async function runConformance(
  provider: StoreProvider
): Promise<ConformanceResult> {
  const checks: string[] = [];
  const timestamp = "2026-07-12T10:00:00Z";
  const ref = { algorithm: "sha256" as const, digest: "evidence" };
  const work: WorkRecord = {
    contract: "openorg.work-record",
    contractVersion: "1.0.0",
    id: "work",
    version: "1",
    workspace: "runtime",
    recordedAt: timestamp,
    actor: { kind: "agent", id: "agent", version: "1" },
    action: "act",
    decisionRef: { id: "decision", version: "1" },
    components: [],
    contextRef: { id: "context", version: "1" },
    changes: [],
    artifacts: [ref],
    provenance: { source: "runtime", capturedAt: timestamp }
  };
  await provider.store.append(work);
  equal(
    await provider.store.get(work.id),
    work,
    "stable identity, timestamps, actor, provenance",
    checks
  );
  const signal: OrgRecord = {
    contract: "openorg.org-record",
    contractVersion: "0.2.0",
    id: "signal-seeded",
    version: "1",
    organizationId: "conformance-org",
    workspaceId: "gtm",
    recordType: "signal",
    occurredAt: timestamp,
    recordedAt: timestamp,
    actor: { kind: "human", id: "gtm-user" },
    subjectRefs: [{ type: "account", id: "account-1" }],
    source: {
      system: "crm",
      externalId: "interaction-1",
      capturedAt: timestamp
    },
    access: {
      classification: "confidential",
      policyIds: ["customer-data"],
      permissions: ["account:read"]
    },
    payload: {
      title: "Customer needs explainable automation",
      summary: "Operators need cited reasons before accepting automated work.",
      exactQuote: "Show me why the system did that.",
      severity: "high",
      status: "captured",
      desiredOutcome: "Every automated action has a cited reason.",
      sourceRefs: []
    }
  };
  await provider.store.append(signal);
  equal(
    await provider.store.query({ workspace: "gtm", kind: "signal" }),
    [signal],
    "canonical role records support workspace and kind queries",
    checks
  );
  equal(
    await provider.store.query({ organizationId: "conformance-org" }),
    [signal],
    "organization routing and semantic payload survive round trip",
    checks
  );
  const context = {
    contract: "openorg.context-envelope",
    contractVersion: "1.0.0",
    id: "context",
    createdAt: timestamp,
    sources: [
      {
        id: "source",
        type: "document",
        contentRef: ref,
        observedAt: timestamp,
        freshness: "fresh",
        permissions: ["read"],
        citations: [ref],
        redactions: [
          { path: "$.secret", withheldType: "secret", reason: "policy" }
        ]
      }
    ]
  } as const;
  await provider.store.append(context);
  equal(
    await provider.store.get(context.id),
    context,
    "source provenance, permissions, redactions",
    checks
  );
  const proposed: LineageAssertion = {
    contract: "openorg.lineage-assertion",
    contractVersion: "1.0.0",
    id: "edge",
    from: { id: "context", version: "1" },
    to: { id: "work", version: "1" },
    relationship: "derived_from",
    basis: "observed",
    state: "proposed",
    evidenceRefs: [],
    assertedAt: timestamp
  };
  await provider.store.appendLineage(proposed);
  equal(
    (await provider.store.trace("work")).incoming[0],
    proposed,
    "proposed lineage",
    checks
  );
  const confirmed: LineageAssertion = {
    ...proposed,
    state: "confirmed",
    authority: { kind: "human", id: "reviewer" },
    evidenceRefs: [ref]
  };
  await provider.store.updateLineage(confirmed);
  equal(
    (await provider.store.trace("work")).incoming[0],
    confirmed,
    "confirmed lineage authority and evidence",
    checks
  );
  const receipt: VerificationReceipt = {
    contract: "openorg.verification-receipt",
    contractVersion: "1.0.0",
    id: "receipt",
    workspace: "runtime",
    subject: { id: "work", version: "1" },
    actor: { kind: "agent", id: "agent" },
    policyRef: "policy",
    requiredCheckIds: ["test"],
    verdicts: [
      {
        checkId: "test",
        status: "passed",
        verifier: { kind: "service", id: "ci" },
        evidenceRefs: [ref],
        selfVerification: false
      }
    ],
    humanApprovals: [
      {
        gateId: "release",
        approver: { kind: "human", id: "reviewer" },
        approvedAt: timestamp
      }
    ],
    rejectedAlternatives: [],
    measuredOutcomes: [
      { metric: "latency", value: 1, unit: "ms", measuredAt: timestamp }
    ],
    recordedAt: timestamp
  };
  await provider.store.append(receipt);
  const storedReceipt = (await provider.store.get(
    receipt.id
  )) as VerificationReceipt;
  equal(
    storedReceipt.humanApprovals,
    receipt.humanApprovals,
    "human approvals",
    checks
  );
  equal(
    storedReceipt.verdicts,
    receipt.verdicts,
    "verification receipts",
    checks
  );
  equal(
    storedReceipt.measuredOutcomes,
    receipt.measuredOutcomes,
    "outcome settlement",
    checks
  );
  const corrected: WorkRecord = { ...work, version: "2", action: "corrected" };
  await provider.store.append(corrected);
  equal(
    await provider.store.get(work.id),
    corrected,
    "latest superseding version",
    checks
  );
  const history = (await provider.store.query({ history: "all" })).filter(
    (x) => x.id === work.id
  );
  equal(history.length, 2, "append-only history", checks);
  equal(
    history.map((x) => (x as WorkRecord).version),
    ["1", "2"],
    "corrections preserve preference pair versions",
    checks
  );
  const accessPolicy: AccessPolicyManifest = {
    contract: "openorg.access-policy",
    contractVersion: "1.0.0",
    id: "access-policy",
    version: "1",
    organizationId: "conformance-org",
    defaultEffect: "deny",
    createdAt: timestamp,
    rules: [
      {
        id: "read-policy",
        effect: "allow",
        actions: ["record.read"],
        principalIds: ["reviewer"],
        requiredPermissions: [],
        recordTypes: [],
        classifications: [],
        purposes: [],
        destinationKinds: [],
        requireConsent: false
      }
    ]
  };
  const consent: ConsentGrant = {
    contract: "openorg.consent-grant",
    contractVersion: "1.0.0",
    id: "consent",
    version: "1",
    organizationId: "conformance-org",
    grantedBy: { kind: "human", id: "reviewer" },
    granteeIds: ["reviewer"],
    actions: ["export.evaluation"],
    purposes: ["model-improvement"],
    destinationIds: ["customer-vpc"],
    recordTypes: [],
    recordRefs: [{ id: signal.id, version: signal.version }],
    evidenceRefs: [ref],
    grantedAt: timestamp
  };
  const suite: EvaluationSuite = {
    contract: "olp.evaluation-suite",
    contractVersion: "0.1.0",
    id: "evaluation-suite",
    version: "1",
    organizationId: "conformance-org",
    workspaceId: "runtime",
    title: "Corrections promoted to evals",
    createdAt: timestamp,
    createdBy: { kind: "human", id: "reviewer" },
    cases: [
      {
        id: "case",
        kind: "model_output",
        input: "original",
        expectedOutput: "corrected",
        sourceRefs: [{ id: "work", version: "2" }],
        permissions: []
      }
    ]
  };
  for (const value of [accessPolicy, consent, suite])
    await provider.store.append(value);
  equal(
    await provider.store.get(accessPolicy.id),
    accessPolicy,
    "access policy survives backend round trip",
    checks
  );
  equal(
    await provider.store.get(consent.id),
    consent,
    "consent and egress scope survive backend round trip",
    checks
  );
  equal(
    await provider.store.get(suite.id),
    suite,
    "evaluation evidence survives backend round trip",
    checks
  );
  const normalizedLegacySuite = normalizeOlpRecord({
    ...suite,
    contract: "openorg.evaluation-suite",
    contractVersion: "1.0.0",
    id: "legacy-evaluation-suite",
    version: "7"
  }) as EvaluationSuite;
  await provider.store.append(normalizedLegacySuite);
  equal(
    await provider.store.get(normalizedLegacySuite.id),
    normalizedLegacySuite,
    "legacy learning identity normalizes before backend storage",
    checks
  );
  const sourceBinding = {
    recordRef: { id: signal.id, version: signal.version },
    contentRef: ref,
    permissions: signal.access.permissions
  };
  const proposal: LearningProposal = {
    contract: "olp.learning-proposal",
    contractVersion: "0.1.0",
    id: "learning-proposal",
    version: "1",
    organizationId: signal.organizationId,
    workspaceId: signal.workspaceId,
    purpose: "evaluation",
    status: "proposed",
    sourceBindings: [sourceBinding],
    policyRefs: [{ id: accessPolicy.id, version: accessPolicy.version }],
    consentRefs: [{ id: consent.id, version: consent.version }],
    rationale: "Preserve a verified customer correction as a private eval",
    requestedBy: { kind: "service", id: "learning-loop" },
    proposedAt: timestamp
  };
  const eligibility: EligibilityReceipt = {
    contract: "olp.eligibility-receipt",
    contractVersion: "0.1.0",
    id: "eligibility-receipt",
    version: "1",
    organizationId: signal.organizationId,
    proposalRef: { id: proposal.id, version: proposal.version },
    sourceBindings: proposal.sourceBindings,
    decision: "eligible",
    checks: [
      {
        check: "provenance",
        status: "passed",
        evidenceRefs: [sourceBinding.recordRef],
        reasons: []
      },
      {
        check: "access",
        status: "passed",
        evidenceRefs: [{ id: accessPolicy.id, version: accessPolicy.version }],
        reasons: []
      },
      {
        check: "consent",
        status: "passed",
        evidenceRefs: [{ id: consent.id, version: consent.version }],
        reasons: []
      },
      {
        check: "verification",
        status: "passed",
        evidenceRefs: [{ id: receipt.id, version: "1" }],
        reasons: []
      }
    ],
    evaluatedBy: { kind: "service", id: "policy-engine" },
    evaluatedAt: timestamp
  };
  const artifact: LearningArtifact = {
    contract: "olp.learning-artifact",
    contractVersion: "0.1.0",
    id: "learning-artifact",
    version: "1",
    organizationId: signal.organizationId,
    artifactType: "evaluation_suite",
    status: "active",
    proposalRef: eligibility.proposalRef,
    eligibilityRef: { id: eligibility.id, version: eligibility.version },
    sourceBindings: eligibility.sourceBindings,
    contentRef: ref,
    createdBy: { kind: "service", id: "artifact-builder" },
    createdAt: timestamp
  };
  const evaluation: EvaluationReceipt = {
    contract: "olp.evaluation-receipt",
    contractVersion: "0.1.0",
    id: "evaluation-receipt",
    version: "1",
    organizationId: signal.organizationId,
    artifactRef: { id: artifact.id, version: artifact.version },
    evaluationRefs: [{ id: suite.id, version: suite.version }],
    verdict: "passed",
    metrics: { passRate: 1 },
    evidenceRefs: [ref],
    evaluatedBy: { kind: "service", id: "independent-evaluator" },
    independent: true,
    evaluatedAt: timestamp
  };
  const promotion: PromotionReceipt = {
    contract: "olp.promotion-receipt",
    contractVersion: "0.1.0",
    id: "promotion-receipt",
    version: "1",
    organizationId: signal.organizationId,
    proposalRef: artifact.proposalRef,
    eligibilityRef: artifact.eligibilityRef,
    artifactRef: { id: artifact.id, version: artifact.version },
    evaluationRefs: [{ id: evaluation.id, version: evaluation.version }],
    decision: "approved",
    target: { kind: "memory", id: "private-eval-memory" },
    reasons: ["Independent private evaluation passed"],
    decidedBy: { kind: "human", id: "reviewer" },
    decidedAt: timestamp
  };
  for (const value of [proposal, eligibility, artifact, evaluation, promotion])
    await provider.store.append(value);
  equal(
    await provider.store.get(proposal.id),
    proposal,
    "OLP proposal preserves exact source version and digest",
    checks
  );
  equal(
    await provider.store.get(eligibility.id),
    eligibility,
    "OLP eligibility receipt survives backend round trip",
    checks
  );
  equal(
    await provider.store.get(artifact.id),
    artifact,
    "OLP artifact preserves proposal and eligibility bindings",
    checks
  );
  equal(
    await provider.store.get(evaluation.id),
    evaluation,
    "OLP independent evaluation evidence survives round trip",
    checks
  );
  equal(
    await provider.store.get(promotion.id),
    promotion,
    "OLP human promotion decision survives round trip",
    checks
  );
  if (!checkLearningEligibility(proposal, eligibility).valid)
    throw new Error("conformance failed: OLP eligibility law");
  if (!checkEvaluationIndependence(artifact, evaluation).valid)
    throw new Error("conformance failed: OLP evaluation independence law");
  if (!checkLearningPromotion(promotion, eligibility, artifact).valid)
    throw new Error("conformance failed: OLP promotion law");
  if (!checkPromotionEvaluations(promotion, [evaluation]).valid)
    throw new Error("conformance failed: OLP promotion evaluation law");
  checks.push("OLP promotion requires passed independent evaluation evidence");
  checks.push("OLP lifecycle laws reject ungoverned learning transitions");
  return { checks };
}
