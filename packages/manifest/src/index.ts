import { z } from "zod";

export const FieldSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    type: z
      .enum(["text", "number", "date", "boolean", "url", "identity"])
      .default("text")
  })
  .strict();

export const PrimaryObjectSchema = z
  .object({
    kind: z.string().min(1),
    label: z.string().min(1),
    fields: z.array(FieldSchema).default([])
  })
  .strict();

const AttentionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    query: z.string().min(1).optional()
  })
  .strict();
const StageSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    policy: z.string().min(1).optional()
  })
  .strict();
const QuerySchema = z
  .object({
    kind: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    actor: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    workType: z.string().min(1).optional(),
    since: z.string().min(1).optional()
  })
  .strict();
export const HomeSchema = z
  .object({
    attention: z.array(AttentionSchema).default([]),
    stages: z.array(StageSchema).min(1)
  })
  .strict();

export const RoleManifestSchema = z
  .object({
    contract: z
      .literal("openorg.role-manifest")
      .default("openorg.role-manifest"),
    contractVersion: z.literal("1.0.0").default("1.0.0"),
    workspace: z.string().min(1),
    title: z.string().min(1),
    primaryObject: PrimaryObjectSchema,
    stations: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            tagline: z.string().min(1),
            primaryObject: PrimaryObjectSchema.optional(),
            defaultQueries: z.array(QuerySchema).default([]),
            home: HomeSchema.optional()
          })
          .strict()
      )
      .optional(),
    sources: z.array(
      z
        .object({
          provider: z.string().min(1),
          label: z.string().min(1).optional(),
          status: z
            .enum([
              "available",
              "configured",
              "healthy",
              "degraded",
              "unavailable",
              "planned",
              "unknown"
            ])
            .default("unknown"),
          statusDetail: z.string().min(1).optional()
        })
        .strict()
    ),
    council: z
      .object({
        architect: z.string().min(1),
        builder: z.string().min(1),
        verifier: z.string().min(1)
      })
      .strict(),
    skills: z.array(z.string().min(1)).default([]),
    gates: z
      .record(
        z.string().min(1),
        z.enum(["human_approval", "verified_receipt", "none"])
      )
      .default({}),
    home: HomeSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    const stages = new Set(manifest.home.stages.map((stage) => stage.id));
    for (const transition of Object.keys(manifest.gates)) {
      const [from, to] = transition.split("->");
      if (!from || !to || !stages.has(from) || !stages.has(to)) {
        context.addIssue({
          code: "custom",
          path: ["gates", transition],
          message:
            "gate transition must be '<stage>-><stage>' using home stages"
        });
      }
    }
  });

export type RoleManifest = z.infer<typeof RoleManifestSchema>;
export type PrimaryObject = z.infer<typeof PrimaryObjectSchema>;
export type WorkbenchHome = z.infer<typeof HomeSchema>;

export function parseRoleManifest(input: unknown): RoleManifest {
  return RoleManifestSchema.parse(input);
}

export function roleManifestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(RoleManifestSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}
