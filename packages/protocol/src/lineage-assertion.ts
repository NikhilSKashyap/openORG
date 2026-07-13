import { z } from "zod";
import {
  ContentRefSchema,
  HumanIdentitySchema,
  IdentifierSchema,
  RecordRefSchema,
  SystemIdentitySchema,
  TimestampSchema
} from "./common.js";

const AuthoritySchema = z.discriminatedUnion("kind", [
  HumanIdentitySchema,
  SystemIdentitySchema,
  z.object({ kind: z.literal("policy"), ruleId: IdentifierSchema }).strict()
]);

export const LineageAssertionSchema = z
  .object({
    contract: z.literal("openorg.lineage-assertion"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    from: RecordRefSchema,
    to: RecordRefSchema,
    relationship: z
      .enum([
        "related_to",
        "derived_from",
        "supports",
        "contradicts",
        "constrains",
        "motivates",
        "authorizes",
        "commits_to",
        "implements",
        "produces",
        "verifies",
        "measures",
        "corrects",
        "supersedes"
      ])
      .default("related_to"),
    basis: z.enum(["observed", "inferred", "asserted"]),
    state: z.enum(["proposed", "confirmed", "rejected", "superseded"]),
    authority: AuthoritySchema.optional(),
    evidenceRefs: z.array(ContentRefSchema),
    correction: z
      .object({ original: RecordRefSchema, corrected: RecordRefSchema })
      .strict()
      .optional(),
    supersedes: RecordRefSchema.optional(),
    assertedAt: TimestampSchema
  })
  .strict()
  .superRefine((assertion, context) => {
    if (
      assertion.state === "confirmed" &&
      (!assertion.authority || assertion.evidenceRefs.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "confirmed lineage requires authority and evidence"
      });
    }
  });

export type LineageAssertion = z.infer<typeof LineageAssertionSchema>;
