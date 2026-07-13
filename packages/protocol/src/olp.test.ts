import { describe, expect, it } from "vitest";
import {
  EligibilityReceiptSchema,
  EvaluationReceiptSchema,
  LearningArtifactSchema,
  LearningProposalSchema,
  PromotionReceiptSchema,
  checkEvaluationIndependence,
  checkLearningEligibility,
  checkLearningPromotion,
  checkPromotionEvaluations,
  matchesOlpContract,
  normalizeOlpRecord,
  type EligibilityReceipt,
  type EvaluationReceipt,
  type LearningArtifact,
  type LearningProposal,
  type PromotionReceipt
} from "./index.js";

const timestamp = "2026-07-12T10:00:00Z";
const sourceBinding = {
  recordRef: { id: "correction-1", version: "2" },
  contentRef: { algorithm: "sha256" as const, digest: "source-digest" },
  permissions: ["learning:read"]
};
const proposal: LearningProposal = LearningProposalSchema.parse({
  contract: "olp.learning-proposal",
  contractVersion: "0.1.0",
  id: "proposal-1",
  version: "1",
  organizationId: "acme",
  workspaceId: "swe",
  purpose: "evaluation",
  status: "proposed",
  sourceBindings: [sourceBinding],
  policyRefs: [{ id: "policy-1", version: "1" }],
  consentRefs: [],
  rationale: "Turn an explicit correction into a private regression eval",
  requestedBy: { kind: "service", id: "learning-loop" },
  proposedAt: timestamp
});
const checks: EligibilityReceipt["checks"] = [
  {
    check: "provenance",
    status: "passed",
    evidenceRefs: [sourceBinding.recordRef],
    reasons: []
  },
  {
    check: "access",
    status: "passed",
    evidenceRefs: [{ id: "policy-1", version: "1" }],
    reasons: []
  },
  {
    check: "consent",
    status: "not_applicable",
    evidenceRefs: [],
    reasons: ["same-boundary reuse; no external destination requested"]
  },
  {
    check: "verification",
    status: "passed",
    evidenceRefs: [sourceBinding.recordRef],
    reasons: []
  }
];
const eligibility: EligibilityReceipt = EligibilityReceiptSchema.parse({
  contract: "olp.eligibility-receipt",
  contractVersion: "0.1.0",
  id: "eligibility-1",
  version: "1",
  organizationId: "acme",
  proposalRef: { id: proposal.id, version: proposal.version },
  sourceBindings: proposal.sourceBindings,
  decision: "eligible",
  checks,
  evaluatedBy: { kind: "service", id: "policy-engine" },
  evaluatedAt: timestamp
});
const artifact: LearningArtifact = LearningArtifactSchema.parse({
  contract: "olp.learning-artifact",
  contractVersion: "0.1.0",
  id: "artifact-1",
  version: "1",
  organizationId: "acme",
  artifactType: "evaluation_suite",
  status: "active",
  proposalRef: eligibility.proposalRef,
  eligibilityRef: { id: eligibility.id, version: eligibility.version },
  sourceBindings: eligibility.sourceBindings,
  contentRef: { algorithm: "sha256", digest: "artifact-digest" },
  createdBy: { kind: "service", id: "builder" },
  createdAt: timestamp
});
const evaluation: EvaluationReceipt = EvaluationReceiptSchema.parse({
  contract: "olp.evaluation-receipt",
  contractVersion: "0.1.0",
  id: "evaluation-receipt-1",
  version: "1",
  organizationId: "acme",
  artifactRef: { id: artifact.id, version: artifact.version },
  evaluationRefs: [{ id: "model-evaluation-1", version: "1" }],
  verdict: "passed",
  metrics: { passRate: 1 },
  evidenceRefs: [{ algorithm: "sha256", digest: "eval-evidence" }],
  evaluatedBy: { kind: "service", id: "evaluator" },
  independent: true,
  evaluatedAt: timestamp
});
const promotion: PromotionReceipt = PromotionReceiptSchema.parse({
  contract: "olp.promotion-receipt",
  contractVersion: "0.1.0",
  id: "promotion-1",
  version: "1",
  organizationId: "acme",
  proposalRef: artifact.proposalRef,
  eligibilityRef: artifact.eligibilityRef,
  artifactRef: { id: artifact.id, version: artifact.version },
  evaluationRefs: [{ id: evaluation.id, version: evaluation.version }],
  decision: "approved",
  target: { kind: "memory", id: "private-eval-memory" },
  reasons: ["Independent private evaluation passed"],
  decidedBy: { kind: "human", id: "owner" },
  decidedAt: timestamp
});

describe("Organizational Learning Protocol", () => {
  it("accepts an exact, purpose-complete eligibility chain", () => {
    expect(checkLearningEligibility(proposal, eligibility)).toEqual({
      valid: true
    });
    expect(checkEvaluationIndependence(artifact, evaluation)).toEqual({
      valid: true
    });
    expect(checkLearningPromotion(promotion, eligibility, artifact)).toEqual({
      valid: true
    });
    expect(checkPromotionEvaluations(promotion, [evaluation])).toEqual({
      valid: true
    });
  });

  it("rejects source substitution after the proposal", () => {
    const changed = {
      ...eligibility,
      sourceBindings: [
        {
          ...sourceBinding,
          contentRef: { ...sourceBinding.contentRef, digest: "other-bytes" }
        }
      ]
    };
    expect(checkLearningEligibility(proposal, changed).valid).toBe(false);
  });

  it("rejects a purpose that omits its required verification check", () => {
    const incomplete = {
      ...eligibility,
      checks: checks.filter((check) => check.check !== "verification")
    };
    expect(checkLearningEligibility(proposal, incomplete).valid).toBe(false);
  });

  it("derives evaluation independence from actor identity", () => {
    const selfEvaluation = {
      ...evaluation,
      evaluatedBy: artifact.createdBy,
      independent: true
    };
    expect(checkEvaluationIndependence(artifact, selfEvaluation).valid).toBe(
      false
    );
  });

  it("rejects promotion of blocked or mismatched artifacts", () => {
    const blocked = {
      ...eligibility,
      decision: "blocked" as const,
      checks: checks.map((check) =>
        check.check === "verification"
          ? {
              ...check,
              status: "failed" as const,
              reasons: ["verification failed"]
            }
          : check
      )
    };
    expect(checkLearningPromotion(promotion, blocked, artifact).valid).toBe(
      false
    );
    expect(
      checkLearningPromotion(promotion, eligibility, {
        ...artifact,
        id: "different-artifact"
      }).valid
    ).toBe(false);
  });

  it("normalizes legacy OpenOrg learning records without changing identity", () => {
    const legacy = {
      contract: "openorg.evaluation-suite",
      contractVersion: "1.0.0",
      id: "suite-legacy",
      version: "7"
    };
    expect(normalizeOlpRecord(legacy)).toEqual({
      ...legacy,
      contract: "olp.evaluation-suite",
      contractVersion: "0.1.0"
    });
    expect(
      matchesOlpContract("openorg.evaluation-suite", "olp.evaluation-suite")
    ).toBe(true);
  });

  it("requires evidence for a passed evaluation and a human promotion", () => {
    expect(() =>
      EvaluationReceiptSchema.parse({ ...evaluation, evidenceRefs: [] })
    ).toThrow(/require evidence/);
    expect(() =>
      PromotionReceiptSchema.parse({
        ...promotion,
        evaluationRefs: []
      })
    ).toThrow(/require evaluation evidence/);
  });

  it("rejects failed or self-authored evidence for an approved promotion", () => {
    expect(
      checkPromotionEvaluations(promotion, [
        { ...evaluation, verdict: "failed" }
      ]).valid
    ).toBe(false);
    expect(
      checkPromotionEvaluations(promotion, [
        { ...evaluation, independent: false }
      ]).valid
    ).toBe(false);
  });
});
