import { z } from "zod";
import {
  ContentRefSchema,
  HumanIdentitySchema,
  IdentifierSchema,
  IdentitySchema,
  RecordRefSchema,
  TimestampSchema,
  UriSchema,
  VersionSchema
} from "./common.js";

export const DataActionSchema = z.enum([
  "record.read",
  "record.write",
  "lineage.read",
  "lineage.write",
  "provider.read",
  "provider.manage",
  "skill.manage",
  "skill.invoke",
  "export.rag",
  "export.evaluation",
  "export.preference",
  "export.sft",
  "learning.evaluate",
  "learning.train",
  "learning.route",
  "learning.promote",
  "policy.approve"
]);

export const DestinationSchema = z
  .object({
    kind: z.enum(["same_process", "organization_vpc", "external"]),
    id: IdentifierSchema,
    uri: UriSchema.optional()
  })
  .strict();

export const AuthenticatedPrincipalSchema = z
  .object({
    identity: IdentitySchema,
    organizationId: IdentifierSchema,
    permissions: z.array(IdentifierSchema)
  })
  .strict();

const PolicyRuleSchema = z
  .object({
    id: IdentifierSchema,
    effect: z.enum(["allow", "deny"]),
    actions: z.array(DataActionSchema).min(1),
    principalIds: z.array(IdentifierSchema),
    requiredPermissions: z.array(IdentifierSchema),
    recordTypes: z.array(IdentifierSchema),
    classifications: z.array(
      z.enum(["public", "internal", "confidential", "restricted"])
    ),
    purposes: z.array(IdentifierSchema),
    destinationKinds: z.array(DestinationSchema.shape.kind),
    requireConsent: z.boolean()
  })
  .strict();

export const AccessPolicyManifestSchema = z
  .object({
    contract: z.literal("openorg.access-policy"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    defaultEffect: z.enum(["allow", "deny"]),
    createdAt: TimestampSchema,
    rules: z.array(PolicyRuleSchema)
  })
  .strict();

export const ConsentGrantSchema = z
  .object({
    contract: z.literal("openorg.consent-grant"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    version: VersionSchema,
    organizationId: IdentifierSchema,
    grantedBy: HumanIdentitySchema,
    granteeIds: z.array(IdentifierSchema).min(1),
    actions: z.array(DataActionSchema).min(1),
    purposes: z.array(IdentifierSchema).min(1),
    destinationIds: z.array(IdentifierSchema).min(1),
    recordTypes: z.array(IdentifierSchema),
    recordRefs: z.array(RecordRefSchema).min(1),
    evidenceRefs: z.array(ContentRefSchema).min(1),
    grantedAt: TimestampSchema,
    expiresAt: TimestampSchema.optional(),
    revokedAt: TimestampSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.expiresAt &&
      Date.parse(value.expiresAt) <= Date.parse(value.grantedAt)
    )
      context.addIssue({
        code: "custom",
        message: "consent expiry must be after grant time"
      });
    if (
      value.revokedAt &&
      Date.parse(value.revokedAt) < Date.parse(value.grantedAt)
    )
      context.addIssue({
        code: "custom",
        message: "consent revocation cannot predate the grant"
      });
  });

export const ExportRequestSchema = z
  .object({
    purpose: IdentifierSchema,
    destination: DestinationSchema,
    consentRef: RecordRefSchema.optional()
  })
  .strict();

export const EgressReceiptSchema = z
  .object({
    contract: z.literal("openorg.egress-receipt"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    organizationId: IdentifierSchema,
    actor: IdentitySchema,
    action: DataActionSchema,
    purpose: IdentifierSchema,
    destination: DestinationSchema,
    datasetRef: RecordRefSchema,
    consentRef: RecordRefSchema.optional(),
    policyRef: RecordRefSchema,
    recordRefs: z.array(RecordRefSchema),
    contentRef: ContentRefSchema,
    createdAt: TimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.destination.kind === "external" && !value.consentRef)
      context.addIssue({
        code: "custom",
        message: "external egress requires explicit consent"
      });
  });

export type DataAction = z.infer<typeof DataActionSchema>;
export type Destination = z.infer<typeof DestinationSchema>;
export type AuthenticatedPrincipal = z.infer<
  typeof AuthenticatedPrincipalSchema
>;
export type AccessPolicyManifest = z.infer<typeof AccessPolicyManifestSchema>;
export type ConsentGrant = z.infer<typeof ConsentGrantSchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type EgressReceipt = z.infer<typeof EgressReceiptSchema>;
