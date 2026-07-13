import { z } from "zod";

export const VersionSchema = z.string().min(1);
export const TimestampSchema = z.iso.datetime({ offset: true });
export const IdentifierSchema = z.string().min(1);
export const UriSchema = z.url();

export const RecordRefSchema = z
  .object({
    id: IdentifierSchema,
    version: VersionSchema
  })
  .strict();

export const ContentRefSchema = z
  .object({
    algorithm: z.enum(["sha256", "sha512"]),
    digest: z.string().min(1),
    mediaType: z.string().min(1).optional(),
    uri: UriSchema.optional()
  })
  .strict();

export const HumanIdentitySchema = z
  .object({
    kind: z.literal("human"),
    id: IdentifierSchema,
    displayName: z.string().min(1).optional()
  })
  .strict();

export const SystemIdentitySchema = z
  .object({
    kind: z.enum(["agent", "service"]),
    id: IdentifierSchema,
    version: VersionSchema.optional()
  })
  .strict();

export const IdentitySchema = z.discriminatedUnion("kind", [
  HumanIdentitySchema,
  SystemIdentitySchema
]);

export type RecordRef = z.infer<typeof RecordRefSchema>;
export type ContentRef = z.infer<typeof ContentRefSchema>;
export type Identity = z.infer<typeof IdentitySchema>;
