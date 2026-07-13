import { z } from "zod";
import {
  ContentRefSchema,
  IdentitySchema,
  IdentifierSchema,
  RecordRefSchema,
  TimestampSchema,
  VersionSchema
} from "./common.js";

const UsedComponentSchema = z
  .object({
    kind: z.enum(["tool", "model", "skill"]),
    id: IdentifierSchema,
    version: VersionSchema,
    hash: z.string().min(1)
  })
  .strict();

const ChangeSchema = z
  .object({
    target: z.string().min(1),
    operation: z.enum(["create", "update", "delete", "execute"]),
    before: ContentRefSchema.optional(),
    after: ContentRefSchema.optional()
  })
  .strict();

export const WorkRecordSchema = z
  .object({
    contract: z.literal("openorg.work-record"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    version: VersionSchema,
    workspace: IdentifierSchema,
    recordedAt: TimestampSchema,
    actor: IdentitySchema,
    action: z.string().min(1),
    decisionRef: RecordRefSchema,
    components: z.array(UsedComponentSchema),
    contextRef: RecordRefSchema,
    changes: z.array(ChangeSchema),
    cost: z
      .object({
        amount: z.number().nonnegative(),
        currency: z.string().length(3)
      })
      .strict()
      .optional(),
    latencyMs: z.number().nonnegative().optional(),
    artifacts: z.array(ContentRefSchema),
    provenance: z
      .object({ source: IdentifierSchema, capturedAt: TimestampSchema })
      .strict(),
    signature: z
      .object({
        algorithm: z.literal("hmac-sha256"),
        keyId: IdentifierSchema,
        value: z.string().min(1)
      })
      .strict()
      .optional()
  })
  .strict();

export type WorkRecord = z.infer<typeof WorkRecordSchema>;
