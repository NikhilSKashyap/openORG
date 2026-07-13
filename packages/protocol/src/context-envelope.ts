import { z } from "zod";
import {
  ContentRefSchema,
  IdentifierSchema,
  TimestampSchema
} from "./common.js";

const RedactionSchema = z
  .object({
    path: z.string().min(1),
    withheldType: z.string().min(1),
    reason: z.string().min(1),
    policyRef: IdentifierSchema.optional()
  })
  .strict();

const ContextSourceSchema = z
  .object({
    id: IdentifierSchema,
    type: z.string().min(1),
    contentRef: ContentRefSchema,
    observedAt: TimestampSchema,
    validAt: TimestampSchema.optional(),
    freshness: z.enum(["live", "fresh", "stale", "unknown"]),
    permissions: z.array(IdentifierSchema),
    citations: z.array(ContentRefSchema),
    redactions: z.array(RedactionSchema)
  })
  .strict();

export const ContextEnvelopeSchema = z
  .object({
    contract: z.literal("openorg.context-envelope"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    createdAt: TimestampSchema,
    sources: z.array(ContextSourceSchema)
  })
  .strict();

export type ContextEnvelope = z.infer<typeof ContextEnvelopeSchema>;
