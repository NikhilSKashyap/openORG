import { describe, expect, it } from "vitest";
import {
  DatasetManifestSchema,
  DecisionRecordSchema,
  OrgRecordSchema,
  SignalRecordSchema,
  VerificationRecordSchema
} from "./index.js";

const now = "2026-07-12T12:00:00Z";
const source = {
  system: "salesforce",
  externalId: "call-42",
  capturedAt: now
};
const access = {
  classification: "confidential" as const,
  policyIds: ["customer-data"],
  permissions: ["account:read"]
};
const common = {
  contract: "openorg.org-record" as const,
  contractVersion: "0.2.0" as const,
  version: "1",
  organizationId: "acme",
  occurredAt: now,
  recordedAt: now,
  actor: { kind: "human" as const, id: "gtm-user" },
  subjectRefs: [{ type: "account" as const, id: "account-1" }],
  source,
  access
};

describe("organizational records", () => {
  it("preserves the customer content of a GTM signal", () => {
    const signal = SignalRecordSchema.parse({
      ...common,
      id: "signal-1",
      workspaceId: "gtm",
      recordType: "signal",
      payload: {
        title: "Support team cannot explain routing",
        summary: "Operators need cited reasons for automated routing.",
        exactQuote: "I need to know why the ticket went there.",
        severity: "high",
        status: "captured",
        desiredOutcome: "Every route includes a cited reason.",
        sourceRefs: []
      }
    });
    expect(signal.payload.exactQuote).toContain("why");
    expect(OrgRecordSchema.parse(signal)).toEqual(signal);
  });

  it("keeps PM rationale, alternatives, and success metrics", () => {
    const decision = DecisionRecordSchema.parse({
      ...common,
      id: "decision-1",
      workspaceId: "pm",
      recordType: "decision",
      payload: {
        title: "Add cited routing explanations",
        problem: "Operators cannot audit automated ticket routing.",
        rationale: "Three high-severity customer signals share this problem.",
        alternatives: [
          {
            title: "Disable automation",
            reasonRejected: "Removes the latency benefit."
          }
        ],
        scope: ["routing explanation"],
        nonGoals: ["replace the support CRM"],
        successMetrics: [
          {
            name: "auditable_routes",
            value: 0,
            baseline: 0,
            target: 0.95,
            unit: "ratio"
          }
        ],
        status: "proposed",
        signalRefs: [{ id: "signal-1", version: "1" }],
        constraintRefs: []
      }
    });
    expect(decision.payload.rationale).toContain("customer signals");
  });

  it("rejects a passed verification without evidence-bearing checks or approval", () => {
    expect(() =>
      VerificationRecordSchema.parse({
        ...common,
        id: "verification-1",
        workspaceId: "fde",
        recordType: "verification",
        payload: {
          title: "Verify routing implementation",
          policyRef: "release-gate",
          subjectRefs: [{ id: "artifact-1", version: "1" }],
          verdict: "passed",
          independent: true,
          checks: [],
          humanApprovals: []
        }
      })
    ).toThrow(/passed verification requires/);
  });

  it("requires reproducible dataset splits", () => {
    expect(() =>
      DatasetManifestSchema.parse({
        contract: "olp.dataset-manifest",
        contractVersion: "0.1.0",
        id: "dataset-1",
        organizationId: "acme",
        purpose: "sft",
        createdAt: now,
        createdBy: "local-user",
        policyRefs: ["training-approved"],
        recordRefs: [{ id: "signal-1", version: "1" }],
        schemaVersions: ["0.2.0"],
        inclusion: ["verified customer missions"],
        exclusions: ["restricted sources"],
        contentRef: { algorithm: "sha256", digest: "dataset" },
        split: { train: 0.8, validation: 0.2, test: 0.2 }
      })
    ).toThrow(/dataset split must total 1/);
  });
});
