import { z } from "zod";
import {
  ContentRefSchema,
  IdentitySchema,
  IdentifierSchema,
  RecordRefSchema,
  TimestampSchema,
  UriSchema,
  VersionSchema
} from "./common.js";

export const EntityRefSchema = z
  .object({
    type: z.enum([
      "customer",
      "account",
      "contact",
      "product",
      "initiative",
      "mission",
      "repository",
      "service",
      "model",
      "release",
      "other"
    ]),
    id: IdentifierSchema,
    displayName: z.string().min(1).optional()
  })
  .strict();

export const AccessPolicySchema = z
  .object({
    classification: z.enum([
      "public",
      "internal",
      "confidential",
      "restricted"
    ]),
    policyIds: z.array(IdentifierSchema),
    permissions: z.array(IdentifierSchema),
    consentRef: RecordRefSchema.optional(),
    retention: z
      .object({
        policyId: IdentifierSchema,
        deleteAfter: TimestampSchema.optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const SourcePointerSchema = z
  .object({
    system: IdentifierSchema,
    externalId: IdentifierSchema.optional(),
    uri: UriSchema.optional(),
    contentRef: ContentRefSchema.optional(),
    capturedAt: TimestampSchema
  })
  .strict()
  .superRefine((source, context) => {
    if (!source.externalId && !source.uri && !source.contentRef) {
      context.addIssue({
        code: "custom",
        message: "source requires externalId, uri, or contentRef"
      });
    }
  });

const MetricSchema = z
  .object({
    name: z.string().min(1),
    value: z.number(),
    unit: z.string().min(1).optional(),
    baseline: z.number().optional(),
    target: z.number().optional()
  })
  .strict();

const AlternativeSchema = z
  .object({
    title: z.string().min(1),
    reasonRejected: z.string().min(1).optional()
  })
  .strict();

const envelope = {
  contract: z.literal("openorg.org-record"),
  contractVersion: z.literal("0.2.0"),
  id: IdentifierSchema,
  version: VersionSchema,
  organizationId: IdentifierSchema,
  workspaceId: IdentifierSchema,
  occurredAt: TimestampSchema,
  recordedAt: TimestampSchema,
  actor: IdentitySchema,
  subjectRefs: z.array(EntityRefSchema),
  source: SourcePointerSchema,
  access: AccessPolicySchema,
  integrity: z
    .object({
      algorithm: z.enum(["sha256", "hmac-sha256"]),
      keyId: IdentifierSchema.optional(),
      value: z.string().min(1)
    })
    .strict()
    .optional(),
  supersedes: RecordRefSchema.optional(),
  correctionOf: RecordRefSchema.optional()
} as const;

const makeRecord = <TType extends string, T extends z.ZodType>(
  recordType: TType,
  payload: T
) =>
  z
    .object({
      ...envelope,
      recordType: z.literal(recordType),
      payload
    })
    .strict();

export const EntityRecordSchema = makeRecord(
  "entity",
  z
    .object({
      entityType: EntityRefSchema.shape.type,
      name: z.string().min(1),
      externalIds: z.record(IdentifierSchema, IdentifierSchema)
    })
    .strict()
);

export const SourceRecordSchema = makeRecord(
  "source",
  z
    .object({
      sourceType: z.enum([
        "email",
        "meeting",
        "transcript",
        "ticket",
        "document",
        "commit",
        "metric",
        "query",
        "other"
      ]),
      title: z.string().min(1),
      excerpt: z.string().min(1).optional(),
      contentRef: ContentRefSchema.optional()
    })
    .strict()
);

export const SignalRecordSchema = makeRecord(
  "signal",
  z
    .object({
      title: z.string().min(1),
      summary: z.string().min(1),
      exactQuote: z.string().min(1).optional(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      status: z.enum(["captured", "qualified", "handed_off"]),
      desiredOutcome: z.string().min(1).optional(),
      urgency: z.string().min(1).optional(),
      sourceRefs: z.array(RecordRefSchema)
    })
    .strict()
);

export const ClaimRecordSchema = makeRecord(
  "claim",
  z
    .object({
      statement: z.string().min(1),
      basis: z.enum(["human_asserted", "model_inferred"]),
      confidence: z.number().min(0).max(1).optional(),
      supportingRefs: z.array(RecordRefSchema),
      contradictingRefs: z.array(RecordRefSchema)
    })
    .strict()
);

export const ConstraintRecordSchema = makeRecord(
  "constraint",
  z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      category: z.enum([
        "security",
        "privacy",
        "compliance",
        "cost",
        "latency",
        "timeline",
        "data",
        "architecture",
        "commercial",
        "other"
      ]),
      hard: z.boolean()
    })
    .strict()
);

export const DecisionRecordSchema = makeRecord(
  "decision",
  z
    .object({
      title: z.string().min(1),
      problem: z.string().min(1),
      rationale: z.string().min(1),
      alternatives: z.array(AlternativeSchema),
      scope: z.array(z.string().min(1)),
      nonGoals: z.array(z.string().min(1)),
      successMetrics: z.array(MetricSchema),
      status: z.enum(["proposed", "approved", "rejected", "superseded"]),
      signalRefs: z.array(RecordRefSchema),
      constraintRefs: z.array(RecordRefSchema)
    })
    .strict()
);

export const CommitmentRecordSchema = makeRecord(
  "commitment",
  z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      owner: IdentitySchema,
      recipientRef: EntityRefSchema.optional(),
      dueAt: TimestampSchema.optional(),
      status: z.enum(["open", "fulfilled", "missed", "cancelled"])
    })
    .strict()
);

export const WorkRecordV2Schema = makeRecord(
  "work",
  z
    .object({
      title: z.string().min(1),
      intent: z.string().min(1),
      workType: z.enum([
        "plan",
        "task",
        "human_action",
        "agent_run",
        "tool_invocation"
      ]),
      status: z.enum(["planned", "in_progress", "blocked", "completed"]),
      stage: z.string().min(1),
      decisionRefs: z.array(RecordRefSchema),
      contextRefs: z.array(RecordRefSchema),
      components: z.array(
        z
          .object({
            kind: z.enum(["tool", "model", "skill", "harness", "mcp"]),
            id: IdentifierSchema,
            version: VersionSchema.optional(),
            hash: z.string().min(1).optional()
          })
          .strict()
      ),
      changes: z.array(
        z
          .object({
            target: z.string().min(1),
            operation: z.enum(["create", "update", "delete", "execute"]),
            before: ContentRefSchema.optional(),
            after: ContentRefSchema.optional()
          })
          .strict()
      ),
      cost: z
        .object({
          amount: z.number().nonnegative(),
          currency: z.string().length(3)
        })
        .strict()
        .optional(),
      latencyMs: z.number().nonnegative().optional()
    })
    .strict()
);

export const ArtifactRecordSchema = makeRecord(
  "artifact",
  z
    .object({
      title: z.string().min(1),
      artifactType: z.enum([
        "design",
        "code",
        "pull_request",
        "model",
        "document",
        "configuration",
        "release",
        "other"
      ]),
      contentRefs: z.array(ContentRefSchema),
      externalUri: UriSchema.optional(),
      producedByRefs: z.array(RecordRefSchema)
    })
    .strict()
);

export const VerificationRecordSchema = makeRecord(
  "verification",
  z
    .object({
      title: z.string().min(1),
      policyRef: IdentifierSchema,
      subjectRefs: z.array(RecordRefSchema),
      verdict: z.enum(["passed", "failed", "inconclusive"]),
      independent: z.boolean(),
      checks: z.array(
        z
          .object({
            id: IdentifierSchema,
            status: z.enum(["passed", "failed", "skipped"]),
            evidenceRefs: z.array(ContentRefSchema)
          })
          .strict()
      ),
      humanApprovals: z.array(
        z
          .object({ approver: IdentitySchema, approvedAt: TimestampSchema })
          .strict()
      )
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.verdict === "passed" &&
        value.checks.length === 0 &&
        value.humanApprovals.length === 0
      ) {
        context.addIssue({
          code: "custom",
          message: "passed verification requires checks or human approval"
        });
      }
      if (
        value.verdict === "passed" &&
        value.checks.some((check) => check.status === "failed")
      ) {
        context.addIssue({
          code: "custom",
          message: "failed checks cannot produce a passed verification"
        });
      }
    })
);

export const OutcomeRecordSchema = makeRecord(
  "outcome",
  z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      outcomeType: z.enum(["technical", "customer", "product", "commercial"]),
      metrics: z.array(MetricSchema),
      measuredAt: TimestampSchema,
      measurementSourceRefs: z.array(RecordRefSchema)
    })
    .strict()
);

export const CorrectionRecordSchema = makeRecord(
  "correction",
  z
    .object({
      title: z.string().min(1),
      reason: z.string().min(1),
      originalRef: RecordRefSchema,
      correctedRef: RecordRefSchema,
      rejectedContent: z.string().min(1).optional(),
      preferredContent: z.string().min(1).optional()
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.originalRef.id === value.correctedRef.id &&
        value.originalRef.version === value.correctedRef.version
      ) {
        context.addIssue({
          code: "custom",
          message: "correction must reference distinct versions"
        });
      }
    })
);

export const OrgRecordSchema = z.discriminatedUnion("recordType", [
  EntityRecordSchema,
  SourceRecordSchema,
  SignalRecordSchema,
  ClaimRecordSchema,
  ConstraintRecordSchema,
  DecisionRecordSchema,
  CommitmentRecordSchema,
  WorkRecordV2Schema,
  ArtifactRecordSchema,
  VerificationRecordSchema,
  OutcomeRecordSchema,
  CorrectionRecordSchema
]);

export type OrgRecord = z.infer<typeof OrgRecordSchema>;
export type EntityRef = z.infer<typeof EntityRefSchema>;
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;
export type SourcePointer = z.infer<typeof SourcePointerSchema>;
