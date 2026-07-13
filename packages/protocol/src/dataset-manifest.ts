import { z } from "zod";
import {
  ContentRefSchema,
  IdentifierSchema,
  RecordRefSchema,
  TimestampSchema
} from "./common.js";

export const DatasetManifestSchema = z
  .object({
    contract: z.literal("openorg.dataset-manifest"),
    contractVersion: z.literal("0.2.0"),
    id: IdentifierSchema,
    organizationId: IdentifierSchema,
    purpose: z.enum(["rag", "evaluation", "preference", "sft"]),
    createdAt: TimestampSchema,
    createdBy: IdentifierSchema,
    policyRefs: z.array(IdentifierSchema),
    recordRefs: z.array(RecordRefSchema),
    schemaVersions: z.array(z.string().min(1)),
    inclusion: z.array(z.string().min(1)),
    exclusions: z.array(z.string().min(1)),
    contentRef: ContentRefSchema,
    split: z
      .object({
        train: z.number().min(0).max(1),
        validation: z.number().min(0).max(1),
        test: z.number().min(0).max(1)
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.split) {
      const total =
        value.split.train + value.split.validation + value.split.test;
      if (Math.abs(total - 1) > 0.000001) {
        context.addIssue({
          code: "custom",
          message: "dataset split must total 1"
        });
      }
    }
  });

export type DatasetManifest = z.infer<typeof DatasetManifestSchema>;
