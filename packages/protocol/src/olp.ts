import { z } from "zod";
import {
  ContentRefSchema,
  HumanIdentitySchema,
  IdentifierSchema,
  IdentitySchema,
  RecordRefSchema,
  TimestampSchema,
  VersionSchema
} from "./common.js";

export const OLP_CONTRACT_VERSION = "0.1.0" as const;

export const LearningPurposeSchema = z.enum([
  "rag",
  "evaluation",
  "preference",
  "policy",
  "training"
]);

export const LearningSourceBindingSchema = z
  .object({
    recordRef: RecordRefSchema,
    contentRef: ContentRefSchema,
    permissions: z.array(IdentifierSchema)
  })
  .strict();

export const LearningProposalSchema = z
  .object({
    contract: z.literal("olp.learning-proposal"),
    contractVersion: z.literal(OLP_CONTRACT_VERSION),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    workspaceId: IdentifierSchema,
    purpose: LearningPurposeSchema,
    status: z.enum(["proposed", "withdrawn"]),
    sourceBindings: z.array(LearningSourceBindingSchema).min(1),
    policyRefs: z.array(RecordRefSchema),
    consentRefs: z.array(RecordRefSchema),
    rationale: z.string().min(1),
    requestedBy: IdentitySchema,
    proposedAt: TimestampSchema
  })
  .strict();

export const EligibilityCheckSchema = z
  .object({
    check: z.enum([
      "provenance",
      "access",
      "consent",
      "verification",
      "outcome",
      "egress"
    ]),
    status: z.enum(["passed", "failed", "not_applicable"]),
    evidenceRefs: z.array(RecordRefSchema),
    reasons: z.array(z.string().min(1))
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status !== "passed" && value.reasons.length === 0)
      context.addIssue({
        code: "custom",
        message: "failed and not-applicable checks require a reason"
      });
  });

export const EligibilityReceiptSchema = z
  .object({
    contract: z.literal("olp.eligibility-receipt"),
    contractVersion: z.literal(OLP_CONTRACT_VERSION),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    proposalRef: RecordRefSchema,
    sourceBindings: z.array(LearningSourceBindingSchema).min(1),
    decision: z.enum(["eligible", "blocked"]),
    checks: z.array(EligibilityCheckSchema).min(1),
    evaluatedBy: IdentitySchema,
    evaluatedAt: TimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    const names = value.checks.map((check) => check.check);
    if (new Set(names).size !== names.length)
      context.addIssue({
        code: "custom",
        message: "eligibility checks must be unique"
      });
    const hasFailure = value.checks.some((check) => check.status === "failed");
    if (value.decision === "eligible" && hasFailure)
      context.addIssue({
        code: "custom",
        message: "eligible receipts cannot contain failed checks"
      });
    if (value.decision === "blocked" && !hasFailure)
      context.addIssue({
        code: "custom",
        message: "blocked receipts require at least one failed check"
      });
  });

export const LearningArtifactSchema = z
  .object({
    contract: z.literal("olp.learning-artifact"),
    contractVersion: z.literal(OLP_CONTRACT_VERSION),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    artifactType: z.enum([
      "rag_memory",
      "evaluation_suite",
      "preference_dataset",
      "sft_dataset",
      "policy_candidate",
      "model_candidate"
    ]),
    status: z.enum(["active", "revoked"]),
    proposalRef: RecordRefSchema,
    eligibilityRef: RecordRefSchema,
    sourceBindings: z.array(LearningSourceBindingSchema).min(1),
    contentRef: ContentRefSchema,
    createdBy: IdentitySchema,
    createdAt: TimestampSchema,
    revokedBy: HumanIdentitySchema.optional(),
    revokedAt: TimestampSchema.optional(),
    revocationReason: z.string().min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const revocationFields = [
      value.revokedBy,
      value.revokedAt,
      value.revocationReason
    ];
    if (
      value.status === "revoked" &&
      revocationFields.some((field) => field === undefined)
    )
      context.addIssue({
        code: "custom",
        message: "revoked artifacts require human identity, time, and reason"
      });
    if (
      value.status === "active" &&
      revocationFields.some((field) => field !== undefined)
    )
      context.addIssue({
        code: "custom",
        message: "active artifacts cannot carry revocation fields"
      });
  });

export const EvaluationReceiptSchema = z
  .object({
    contract: z.literal("olp.evaluation-receipt"),
    contractVersion: z.literal(OLP_CONTRACT_VERSION),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    artifactRef: RecordRefSchema,
    evaluationRefs: z.array(RecordRefSchema).min(1),
    verdict: z.enum(["passed", "failed", "inconclusive"]),
    metrics: z.record(z.string(), z.number()),
    evidenceRefs: z.array(ContentRefSchema),
    evaluatedBy: IdentitySchema,
    independent: z.boolean(),
    evaluatedAt: TimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verdict === "passed" && value.evidenceRefs.length === 0)
      context.addIssue({
        code: "custom",
        message: "passed evaluation receipts require evidence"
      });
  });

export const PromotionReceiptSchema = z
  .object({
    contract: z.literal("olp.promotion-receipt"),
    contractVersion: z.literal(OLP_CONTRACT_VERSION),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    proposalRef: RecordRefSchema,
    eligibilityRef: RecordRefSchema,
    artifactRef: RecordRefSchema,
    evaluationRefs: z.array(RecordRefSchema),
    decision: z.enum(["approved", "rejected", "retired", "rolled_back"]),
    target: z
      .object({
        kind: z.enum(["memory", "routing", "policy", "model"]),
        id: IdentifierSchema
      })
      .strict(),
    reasons: z.array(z.string().min(1)).min(1),
    decidedBy: HumanIdentitySchema,
    decidedAt: TimestampSchema,
    rollbackOf: RecordRefSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "approved" && value.evaluationRefs.length === 0)
      context.addIssue({
        code: "custom",
        message: "approved promotions require evaluation evidence"
      });
    if (value.decision === "rolled_back" && !value.rollbackOf)
      context.addIssue({
        code: "custom",
        message: "rollback decisions require the promotion they reverse"
      });
    if (value.decision !== "rolled_back" && value.rollbackOf)
      context.addIssue({
        code: "custom",
        message: "only rollback decisions may carry rollbackOf"
      });
  });

export const LEGACY_OLP_CONTRACTS = {
  "openorg.dataset-manifest": "olp.dataset-manifest",
  "openorg.evaluation-suite": "olp.evaluation-suite",
  "openorg.model-evaluation": "olp.model-evaluation",
  "openorg.routing-policy": "olp.routing-policy",
  "openorg.routing-decision": "olp.routing-decision",
  "openorg.model-artifact": "olp.model-artifact",
  "openorg.training-job": "olp.training-job",
  "openorg.reusable-policy": "olp.reusable-policy"
} as const;

export type LegacyOlpContract = keyof typeof LEGACY_OLP_CONTRACTS;
export type CanonicalOlpContract =
  | (typeof LEGACY_OLP_CONTRACTS)[LegacyOlpContract]
  | "olp.learning-proposal"
  | "olp.eligibility-receipt"
  | "olp.learning-artifact"
  | "olp.evaluation-receipt"
  | "olp.promotion-receipt";

export function canonicalOlpContract(contract: string): string {
  return LEGACY_OLP_CONTRACTS[contract as LegacyOlpContract] ?? contract;
}

export function matchesOlpContract(actual: string, expected: string): boolean {
  return canonicalOlpContract(actual) === canonicalOlpContract(expected);
}

export function normalizeOlpRecord(
  record: Record<string, unknown>
): Record<string, unknown> {
  if (typeof record.contract !== "string") return record;
  const contract = canonicalOlpContract(record.contract);
  if (contract === record.contract) return record;
  return { ...record, contract, contractVersion: OLP_CONTRACT_VERSION };
}

export type LearningPurpose = z.infer<typeof LearningPurposeSchema>;
export type LearningSourceBinding = z.infer<typeof LearningSourceBindingSchema>;
export type LearningProposal = z.infer<typeof LearningProposalSchema>;
export type EligibilityCheck = z.infer<typeof EligibilityCheckSchema>;
export type EligibilityReceipt = z.infer<typeof EligibilityReceiptSchema>;
export type LearningArtifact = z.infer<typeof LearningArtifactSchema>;
export type EvaluationReceipt = z.infer<typeof EvaluationReceiptSchema>;
export type PromotionReceipt = z.infer<typeof PromotionReceiptSchema>;
