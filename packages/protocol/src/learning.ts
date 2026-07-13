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

const MoneySchema = z
  .object({
    amount: z.number().nonnegative(),
    currency: z.string().length(3)
  })
  .strict();

export const EvaluationCaseSchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum(["model_output", "verification_check"]),
    input: z.string().min(1),
    expectedOutput: z.string().min(1).optional(),
    requiredCheckId: IdentifierSchema.optional(),
    sourceRefs: z.array(RecordRefSchema).min(1),
    permissions: z.array(IdentifierSchema)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "model_output" && !value.expectedOutput)
      context.addIssue({
        code: "custom",
        message: "model output cases require an expected output"
      });
    if (value.kind === "verification_check" && !value.requiredCheckId)
      context.addIssue({
        code: "custom",
        message: "verification cases require a check id"
      });
  });

export const EvaluationSuiteSchema = z
  .object({
    contract: z.literal("olp.evaluation-suite"),
    contractVersion: z.literal("0.1.0"),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    workspaceId: IdentifierSchema,
    title: z.string().min(1),
    createdAt: TimestampSchema,
    createdBy: IdentitySchema,
    cases: z.array(EvaluationCaseSchema).min(1)
  })
  .strict();

const CaseResultSchema = z
  .object({
    caseId: IdentifierSchema,
    status: z.enum(["passed", "failed", "error"]),
    output: z.string().optional(),
    error: z.string().optional(),
    latencyMs: z.number().nonnegative(),
    cost: MoneySchema.optional(),
    evidenceRefs: z.array(ContentRefSchema)
  })
  .strict();

export const ModelEvaluationSchema = z
  .object({
    contract: z.literal("olp.model-evaluation"),
    contractVersion: z.literal("0.1.0"),
    id: IdentifierSchema,
    organizationId: IdentifierSchema,
    suiteRef: RecordRefSchema,
    providerId: IdentifierSchema,
    modelId: IdentifierSchema,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    results: z.array(CaseResultSchema),
    metrics: z
      .object({
        totalCases: z.number().int().nonnegative(),
        passedCases: z.number().int().nonnegative(),
        passRate: z.number().min(0).max(1),
        averageLatencyMs: z.number().nonnegative(),
        totalCost: MoneySchema.optional(),
        costCoverage: z.number().min(0).max(1)
      })
      .strict()
  })
  .strict();

export const RoutingPolicySchema = z
  .object({
    contract: z.literal("olp.routing-policy"),
    contractVersion: z.literal("0.1.0"),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    candidateProviderIds: z.array(IdentifierSchema).min(1),
    objective: z.enum(["lowest_cost", "lowest_latency", "highest_quality"]),
    minimumPassRate: z.number().min(0).max(1),
    maximumAverageLatencyMs: z.number().nonnegative().optional(),
    maximumTotalCost: MoneySchema.optional(),
    createdAt: TimestampSchema
  })
  .strict();

export const RoutingDecisionSchema = z
  .object({
    contract: z.literal("olp.routing-decision"),
    contractVersion: z.literal("0.1.0"),
    id: IdentifierSchema,
    organizationId: IdentifierSchema,
    policyRef: RecordRefSchema,
    evaluationRefs: z.array(RecordRefSchema).min(1),
    status: z.enum(["selected", "blocked"]),
    selectedProviderId: IdentifierSchema.optional(),
    reasons: z.array(z.string().min(1)).min(1),
    decidedAt: TimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "selected" && !value.selectedProviderId)
      context.addIssue({
        code: "custom",
        message: "selected routing decisions require a provider"
      });
    if (value.status === "blocked" && value.selectedProviderId)
      context.addIssue({
        code: "custom",
        message: "blocked routing decisions cannot select a provider"
      });
  });

export const ModelArtifactSchema = z
  .object({
    contract: z.literal("olp.model-artifact"),
    contractVersion: z.literal("0.1.0"),
    id: IdentifierSchema,
    organizationId: IdentifierSchema,
    modelType: z.enum([
      "logistic_regression",
      "fine_tuned_model",
      "adapter_weights"
    ]),
    providerId: IdentifierSchema.optional(),
    baseModelId: IdentifierSchema.optional(),
    featureCount: z.number().int().positive().optional(),
    weights: z.array(z.number()).optional(),
    bias: z.number().optional(),
    threshold: z.number().min(0).max(1).optional(),
    contentRef: ContentRefSchema,
    createdAt: TimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.modelType === "logistic_regression" &&
      (value.featureCount === undefined ||
        value.weights === undefined ||
        value.bias === undefined ||
        value.threshold === undefined)
    )
      context.addIssue({
        code: "custom",
        message: "local logistic models require weights and decision parameters"
      });
    if (
      value.featureCount !== undefined &&
      value.weights !== undefined &&
      value.weights.length !== value.featureCount
    )
      context.addIssue({
        code: "custom",
        message: "model weight count must equal feature count"
      });
    if (
      value.modelType !== "logistic_regression" &&
      (!value.providerId || !value.baseModelId)
    )
      context.addIssue({
        code: "custom",
        message: "external model artifacts require provider and base model ids"
      });
  });

export const TrainingJobSchema = z
  .object({
    contract: z.literal("olp.training-job"),
    contractVersion: z.literal("0.1.0"),
    id: IdentifierSchema,
    organizationId: IdentifierSchema,
    adapterId: IdentifierSchema,
    method: z.enum(["local_logistic_regression", "external_adapter"]),
    executionBoundary: z.enum(["same_process", "organization_vpc"]),
    datasetRef: RecordRefSchema,
    status: z.enum(["completed", "failed"]),
    modelRef: RecordRefSchema.optional(),
    inputDigest: ContentRefSchema,
    metrics: z.record(z.string(), z.number()),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    error: z.string().min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "completed" && !value.modelRef)
      context.addIssue({
        code: "custom",
        message: "completed training requires a model artifact"
      });
    if (value.status === "failed" && !value.error)
      context.addIssue({
        code: "custom",
        message: "failed training requires an error"
      });
  });

export const ReusablePolicySchema = z
  .object({
    contract: z.literal("olp.reusable-policy"),
    contractVersion: z.literal("0.1.0"),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    status: z.enum(["proposed", "approved", "retired"]),
    scope: z.array(IdentifierSchema).min(1),
    instruction: z.string().min(1),
    sourceRefs: z.array(RecordRefSchema).min(1),
    evidenceRefs: z.array(ContentRefSchema).min(1),
    createdBy: IdentitySchema,
    approvedBy: HumanIdentitySchema.optional(),
    createdAt: TimestampSchema,
    approvedAt: TimestampSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "approved" && (!value.approvedBy || !value.approvedAt))
      context.addIssue({
        code: "custom",
        message: "approved reusable policy requires human approval"
      });
    if (value.status === "proposed" && (value.approvedBy || value.approvedAt))
      context.addIssue({
        code: "custom",
        message: "proposed policy cannot carry approval"
      });
  });

export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export type EvaluationSuite = z.infer<typeof EvaluationSuiteSchema>;
export type ModelEvaluation = z.infer<typeof ModelEvaluationSchema>;
export type RoutingPolicy = z.infer<typeof RoutingPolicySchema>;
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
export type ModelArtifact = z.infer<typeof ModelArtifactSchema>;
export type TrainingJob = z.infer<typeof TrainingJobSchema>;
export type ReusablePolicy = z.infer<typeof ReusablePolicySchema>;
