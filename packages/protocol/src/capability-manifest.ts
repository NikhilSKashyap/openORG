import { z } from "zod";
import {
  ContentRefSchema,
  IdentifierSchema,
  TimestampSchema,
  VersionSchema
} from "./common.js";

const CapabilitySchema = z
  .object({
    id: IdentifierSchema,
    description: z.string().min(1),
    permissionsRequired: z.array(IdentifierSchema),
    inputTypes: z.array(z.string().min(1)),
    outputTypes: z.array(z.string().min(1))
  })
  .strict();

export const CapabilityManifestSchema = z
  .object({
    contract: z.literal("openorg.capability-manifest"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    version: VersionSchema,
    kind: z.enum([
      "provider",
      "connector",
      "skill",
      "agent",
      "harness",
      "store",
      "evaluator",
      "model",
      "trainer"
    ]),
    capabilities: z.array(CapabilitySchema),
    status: z.enum([
      "available",
      "configured",
      "healthy",
      "unavailable",
      "planned"
    ]),
    lastVerifiedAt: TimestampSchema.optional(),
    evidenceRef: ContentRefSchema.optional()
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.status === "healthy" &&
      (!manifest.lastVerifiedAt || !manifest.evidenceRef)
    ) {
      context.addIssue({
        code: "custom",
        message: "healthy status requires lastVerifiedAt and evidenceRef"
      });
    }
  });

export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
