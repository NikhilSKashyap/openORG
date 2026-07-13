import { describe, expect, it } from "vitest";
import type {
  AccessPolicyManifest,
  AuthenticatedPrincipal,
  ConsentGrant,
  LineageAssertion,
  VerificationReceipt
} from "./index.js";
import {
  checkAccessPolicy,
  checkConsent,
  checkCorrectionPreference,
  checkHumanGates,
  checkLineageConfirmation,
  checkProvenance,
  checkSelfVerification,
  checkVerdictEvidence,
  checkVerificationOutcomeSeparation,
  checkVerified,
  renderKnown,
  supersede
} from "./laws.js";

const timestamp = "2026-07-12T10:00:00Z";
const contentRef = { algorithm: "sha256" as const, digest: "abc123" };
const actor = { kind: "agent" as const, id: "agent-1", version: "1" };
const principal: AuthenticatedPrincipal = {
  identity: { kind: "human", id: "alice" },
  organizationId: "acme",
  permissions: ["records:read", "exports:sft"]
};
const accessPolicy: AccessPolicyManifest = {
  contract: "openorg.access-policy",
  contractVersion: "1.0.0",
  id: "acme-policy",
  version: "1",
  organizationId: "acme",
  defaultEffect: "deny",
  createdAt: timestamp,
  rules: [
    {
      id: "read-internal",
      effect: "allow",
      actions: ["record.read"],
      principalIds: [],
      requiredPermissions: ["records:read"],
      recordTypes: [],
      classifications: ["public", "internal"],
      purposes: [],
      destinationKinds: [],
      requireConsent: false
    },
    {
      id: "sft-external",
      effect: "allow",
      actions: ["export.sft"],
      principalIds: ["alice"],
      requiredPermissions: ["exports:sft"],
      recordTypes: [],
      classifications: [],
      purposes: ["model-adaptation"],
      destinationKinds: ["external"],
      requireConsent: true
    }
  ]
};

const receipt = (): VerificationReceipt => ({
  contract: "openorg.verification-receipt",
  contractVersion: "1.0.0",
  id: "receipt-1",
  workspace: "swe",
  subject: { id: "work-1", version: "1" },
  actor,
  policyRef: "policy-1",
  requiredCheckIds: ["test"],
  verdicts: [
    {
      checkId: "test",
      status: "passed",
      verifier: actor,
      evidenceRefs: [contentRef],
      selfVerification: true
    }
  ],
  humanApprovals: [],
  rejectedAlternatives: [],
  measuredOutcomes: [],
  recordedAt: timestamp
});

const lineage = (): LineageAssertion => ({
  contract: "openorg.lineage-assertion",
  contractVersion: "1.0.0",
  id: "lineage-1",
  from: { id: "work-1", version: "1" },
  to: { id: "work-1", version: "2" },
  relationship: "corrects",
  basis: "observed",
  state: "confirmed",
  authority: { kind: "policy", ruleId: "rule-1" },
  evidenceRefs: [contentRef],
  assertedAt: timestamp
});

function firstVerdict(
  value: VerificationReceipt
): VerificationReceipt["verdicts"][number] {
  const verdict = value.verdicts[0];
  if (!verdict) throw new Error("test fixture requires a verdict");
  return verdict;
}

describe("integrity laws", () => {
  it("requires provenance on every work record", () => {
    expect(
      checkProvenance({ provenance: { source: "", capturedAt: timestamp } })
        .valid
    ).toBe(false);
  });

  it("keeps proposed lineage distinct from confirmed lineage", () => {
    const assertion = lineage();
    delete assertion.authority;
    expect(
      checkLineageConfirmation({ ...assertion, state: "proposed" }, new Set())
        .valid
    ).toBe(true);
  });

  it("allows policy confirmation only when the rule is granted", () => {
    expect(checkLineageConfirmation(lineage(), new Set()).valid).toBe(false);
    expect(checkLineageConfirmation(lineage(), new Set(["rule-1"])).valid).toBe(
      true
    );
  });

  it("lets services confirm observed mechanical lineage", () => {
    const assertion: LineageAssertion = {
      ...lineage(),
      relationship: "verifies",
      authority: { kind: "service", id: "test-runner", version: "1" }
    };
    expect(checkLineageConfirmation(assertion, new Set()).valid).toBe(true);
  });

  it("keeps agent and interpretive service claims proposed", () => {
    const assertion = lineage();
    expect(
      checkLineageConfirmation({ ...assertion, authority: actor }, new Set())
        .valid
    ).toBe(false);
    expect(
      checkLineageConfirmation(
        {
          ...assertion,
          relationship: "motivates",
          authority: { kind: "service", id: "connector", version: "1" }
        },
        new Set()
      ).valid
    ).toBe(false);
  });

  it("requires verifier identity and evidence for verdicts", () => {
    const value = receipt();
    value.verdicts[0] = { ...firstVerdict(value), evidenceRefs: [] };
    expect(checkVerdictEvidence(value).valid).toBe(false);
  });

  it("requires self-verification to be declared", () => {
    const value = receipt();
    value.verdicts[0] = { ...firstVerdict(value), selfVerification: false };
    expect(checkSelfVerification(value).valid).toBe(false);
  });

  it("does not bypass human gates", () => {
    expect(checkHumanGates([{ gateId: "release" }], []).valid).toBe(false);
  });

  it("never marks failed or missing required checks verified", () => {
    const failed = receipt();
    failed.verdicts[0] = { ...firstVerdict(failed), status: "failed" };
    expect(checkVerified(failed).valid).toBe(false);
    expect(checkVerified({ ...receipt(), verdicts: [] }).valid).toBe(false);
  });

  it("keeps verification distinct from measured outcomes", () => {
    const value = receipt();
    value.measuredOutcomes = [
      { metric: "test", value: 1, unit: "score", measuredAt: timestamp }
    ];
    expect(checkVerificationOutcomeSeparation(value).valid).toBe(false);
  });

  it("creates a new immutable supersession instead of mutating", () => {
    const previous = Object.freeze({
      id: "work-1",
      version: "1",
      value: "old"
    });
    const next = Object.freeze({ id: "work-1", version: "2", value: "new" });
    const result = supersede(previous, next, timestamp);
    expect(result).toEqual({ previous, next, supersededAt: timestamp });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("requires corrections to form a preference pair", () => {
    const value = lineage();
    value.correction = { original: value.from, corrected: value.from };
    expect(checkCorrectionPreference(value).valid).toBe(false);
  });

  it("renders absent values honestly as unknown", () => {
    expect(renderKnown(undefined)).toBe("unknown");
    expect(renderKnown(0)).toBe(0);
  });

  it("fails closed across organizations, permissions, and classifications", () => {
    expect(
      checkAccessPolicy(accessPolicy, principal, {
        action: "record.read",
        organizationId: "acme",
        classification: "internal",
        requiredPermissions: ["records:read"]
      }).valid
    ).toBe(true);
    expect(
      checkAccessPolicy(accessPolicy, principal, {
        action: "record.read",
        organizationId: "other",
        classification: "internal"
      }).valid
    ).toBe(false);
    expect(
      checkAccessPolicy(accessPolicy, principal, {
        action: "record.read",
        organizationId: "acme",
        classification: "restricted"
      }).valid
    ).toBe(false);
  });

  it("requires active, purpose-bound consent for external learning egress", () => {
    const grant: ConsentGrant = {
      contract: "openorg.consent-grant",
      contractVersion: "1.0.0",
      id: "consent-1",
      version: "1",
      organizationId: "acme",
      grantedBy: { kind: "human", id: "data-owner" },
      granteeIds: ["alice"],
      actions: ["export.sft"],
      purposes: ["model-adaptation"],
      destinationIds: ["trainer-a"],
      recordTypes: [],
      recordRefs: [{ id: "work-1", version: "1" }],
      evidenceRefs: [contentRef],
      grantedAt: timestamp,
      expiresAt: "2026-07-13T10:00:00Z"
    };
    const request = {
      action: "export.sft" as const,
      organizationId: "acme",
      purpose: "model-adaptation",
      destination: { kind: "external" as const, id: "trainer-a" },
      recordRefs: [{ id: "work-1", version: "1" }]
    };
    expect(checkAccessPolicy(accessPolicy, principal, request).valid).toBe(
      true
    );
    expect(
      checkConsent(grant, principal, request, "2026-07-12T11:00:00Z").valid
    ).toBe(true);
    expect(
      checkConsent(
        grant,
        principal,
        { ...request, purpose: "unapproved-purpose" },
        "2026-07-12T11:00:00Z"
      ).valid
    ).toBe(false);
    expect(
      checkConsent(
        grant,
        principal,
        {
          ...request,
          recordRefs: [{ id: "different-work", version: "1" }]
        },
        "2026-07-12T11:00:00Z"
      ).valid
    ).toBe(false);
    expect(
      checkConsent(grant, principal, request, "2026-07-14T10:00:00Z").valid
    ).toBe(false);
    expect(
      checkConsent(
        { ...grant, expiresAt: "2026-07-12T03:00:00-07:00" },
        principal,
        request,
        "2026-07-12T09:30:00Z"
      ).valid
    ).toBe(true);
  });
});
