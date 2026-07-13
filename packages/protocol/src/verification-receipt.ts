import { z } from "zod";
import {
  ContentRefSchema,
  HumanIdentitySchema,
  IdentitySchema,
  IdentifierSchema,
  RecordRefSchema,
  TimestampSchema
} from "./common.js";

const VerdictSchema = z
  .object({
    checkId: IdentifierSchema,
    status: z.enum(["passed", "failed"]),
    verifier: IdentitySchema,
    evidenceRefs: z.array(ContentRefSchema).min(1),
    selfVerification: z.boolean()
  })
  .strict();

export const VerificationReceiptSchema = z
  .object({
    contract: z.literal("openorg.verification-receipt"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    workspace: IdentifierSchema,
    subject: RecordRefSchema,
    actor: IdentitySchema,
    policyRef: IdentifierSchema,
    requiredCheckIds: z.array(IdentifierSchema),
    verdicts: z.array(VerdictSchema),
    humanApprovals: z.array(
      z
        .object({
          gateId: IdentifierSchema,
          approver: HumanIdentitySchema,
          approvedAt: TimestampSchema
        })
        .strict()
    ),
    rejectedAlternatives: z.array(
      z
        .object({
          description: z.string().min(1),
          reason: z.string().min(1),
          evidenceRefs: z.array(ContentRefSchema)
        })
        .strict()
    ),
    measuredOutcomes: z.array(
      z
        .object({
          metric: IdentifierSchema,
          value: z.number(),
          unit: z.string().min(1),
          measuredAt: TimestampSchema
        })
        .strict()
    ),
    recordedAt: TimestampSchema
  })
  .strict();

export type VerificationReceipt = z.infer<typeof VerificationReceiptSchema>;
