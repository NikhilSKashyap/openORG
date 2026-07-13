import { createHash } from "node:crypto";
import {
  AccessPolicyManifestSchema,
  AuthenticatedPrincipalSchema,
  checkAccessPolicy,
  policyRequiresConsent,
  type AccessPolicyManifest,
  type AccessRequest,
  type AuthenticatedPrincipal
} from "@openorg/protocol";
import type { OpenorgRecord } from "@openorg/sdk";

export type ApiKeyPrincipal = {
  token: string;
  principal: AuthenticatedPrincipal;
};
export type SecurityConfig =
  | { mode: "local" }
  | {
      mode: "enforced";
      policy: AccessPolicyManifest;
      apiKeys: ApiKeyPrincipal[];
    };

type SecurityError = Error & { statusCode: number; invariant: string };
const securityError = (
  statusCode: number,
  invariant: string,
  message: string
): SecurityError =>
  Object.assign(new Error(message), { statusCode, invariant });
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const fields = (record: OpenorgRecord) =>
  record as OpenorgRecord & Record<string, unknown>;

export class SecurityRuntime {
  readonly mode: SecurityConfig["mode"];
  readonly policy?: AccessPolicyManifest;
  private readonly principals = new Map<string, AuthenticatedPrincipal>();

  constructor(config: SecurityConfig = { mode: "local" }) {
    this.mode = config.mode;
    if (config.mode === "enforced") {
      this.policy = AccessPolicyManifestSchema.parse(config.policy);
      if (config.apiKeys.length === 0)
        throw new Error("enforced security requires at least one API key");
      for (const value of config.apiKeys) {
        if (!value.token) throw new Error("API key token cannot be empty");
        this.principals.set(
          hashToken(value.token),
          AuthenticatedPrincipalSchema.parse(value.principal)
        );
      }
    }
  }

  authenticate(authorization?: string): AuthenticatedPrincipal {
    if (this.mode === "local")
      return {
        identity: { kind: "human", id: "local-operator" },
        organizationId: "*",
        permissions: ["*"]
      };
    if (!authorization?.startsWith("Bearer "))
      throw securityError(401, "authentication", "bearer token is required");
    const token = authorization.slice("Bearer ".length).trim();
    const principal = this.principals.get(hashToken(token));
    if (!principal)
      throw securityError(401, "authentication", "invalid bearer token");
    return principal;
  }

  authorize(principal: AuthenticatedPrincipal, request: AccessRequest): void {
    if (this.mode === "local") return;
    const result = checkAccessPolicy(this.requiredPolicy(), principal, request);
    if (!result.valid)
      throw securityError(403, "access-policy", result.reasons.join("; "));
  }

  consentRequired(
    principal: AuthenticatedPrincipal,
    request: AccessRequest
  ): boolean {
    if (request.destination?.kind === "external") return true;
    return (
      this.mode === "enforced" &&
      policyRequiresConsent(this.requiredPolicy(), principal, request)
    );
  }

  canRead(principal: AuthenticatedPrincipal, record: OpenorgRecord): boolean {
    if (this.mode === "local") return true;
    const data = fields(record);
    const organizationId = data.organizationId;
    const access = data.access as
      | {
          classification?: AccessRequest["classification"];
          permissions?: string[];
        }
      | undefined;
    if (typeof organizationId !== "string")
      return principal.permissions.includes("legacy:read");
    try {
      this.authorize(principal, {
        action: "record.read",
        organizationId,
        ...(typeof data.recordType === "string"
          ? { recordType: data.recordType }
          : {}),
        ...(access?.classification
          ? { classification: access.classification }
          : {}),
        requiredPermissions: access?.permissions ?? []
      });
      return true;
    } catch {
      return false;
    }
  }

  authorizeWrite(
    principal: AuthenticatedPrincipal,
    record: OpenorgRecord
  ): void {
    if (this.mode === "local") return;
    const data = fields(record);
    const organizationId = data.organizationId;
    if (typeof organizationId !== "string")
      throw securityError(
        403,
        "organization-boundary",
        "enforced mode rejects records without organizationId"
      );
    const access = data.access as
      | {
          classification?: AccessRequest["classification"];
          permissions?: string[];
        }
      | undefined;
    const actor = data.actor as { kind?: string; id?: string } | undefined;
    const createdBy = data.createdBy as
      string | { kind?: string; id?: string } | undefined;
    const claimedCreatorId =
      typeof createdBy === "string" ? createdBy : createdBy?.id;
    const delegated = principal.permissions.includes("identity:delegate");
    if (
      !delegated &&
      actor &&
      (actor.id !== principal.identity.id ||
        actor.kind !== principal.identity.kind)
    )
      throw securityError(
        403,
        "actor-identity",
        "record actor must match the authenticated principal"
      );
    if (
      !delegated &&
      claimedCreatorId &&
      claimedCreatorId !== principal.identity.id
    )
      throw securityError(
        403,
        "creator-identity",
        "record creator must match the authenticated principal"
      );
    this.authorize(principal, {
      action: "record.write",
      organizationId,
      ...(typeof data.recordType === "string"
        ? { recordType: data.recordType }
        : {}),
      ...(access?.classification
        ? { classification: access.classification }
        : {}),
      requiredPermissions: access?.permissions ?? []
    });
  }

  private requiredPolicy(): AccessPolicyManifest {
    if (!this.policy) throw new Error("enforced security policy unavailable");
    return this.policy;
  }
}

export function securityConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): SecurityConfig {
  const mode =
    environment.OPENORG_SECURITY_MODE ??
    (environment.NODE_ENV === "production" ? "enforced" : "local");
  if (mode === "local") return { mode: "local" };
  if (mode !== "enforced")
    throw new Error("OPENORG_SECURITY_MODE must be local or enforced");
  if (!environment.OPENORG_ACCESS_POLICY_JSON)
    throw new Error("OPENORG_ACCESS_POLICY_JSON is required in enforced mode");
  if (!environment.OPENORG_API_KEYS_JSON)
    throw new Error("OPENORG_API_KEYS_JSON is required in enforced mode");
  const policy = AccessPolicyManifestSchema.parse(
    JSON.parse(environment.OPENORG_ACCESS_POLICY_JSON) as unknown
  );
  const rawKeys = JSON.parse(environment.OPENORG_API_KEYS_JSON) as unknown;
  if (!Array.isArray(rawKeys))
    throw new Error("OPENORG_API_KEYS_JSON must be an array");
  const apiKeys = rawKeys.map((value) => {
    if (!value || typeof value !== "object")
      throw new Error("invalid API key principal");
    const raw = value as { token?: unknown; principal?: unknown };
    if (typeof raw.token !== "string")
      throw new Error("API key token must be a string");
    return {
      token: raw.token,
      principal: AuthenticatedPrincipalSchema.parse(raw.principal)
    };
  });
  return { mode: "enforced", policy, apiKeys };
}
