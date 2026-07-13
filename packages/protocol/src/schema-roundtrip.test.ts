import { describe, expect, it } from "vitest";
import {
  CapabilityManifestSchema,
  ContextEnvelopeSchema,
  LineageAssertionSchema,
  TrainingRecordSchema,
  exportPreferenceJsonl,
  exportRagJsonl,
  exportSftJsonl,
  VerificationReceiptSchema,
  WorkRecordSchema
} from "./index.js";

const timestamp = "2026-07-12T10:00:00Z";
const ref = { id: "record-1", version: "1" };
const contentRef = { algorithm: "sha256" as const, digest: "abc123" };
const actor = { kind: "agent" as const, id: "agent-1", version: "1" };

const cases = [
  [
    "CapabilityManifest",
    CapabilityManifestSchema,
    {
      contract: "openorg.capability-manifest",
      contractVersion: "1.0.0",
      id: "provider-1",
      version: "1",
      kind: "provider",
      capabilities: [
        {
          id: "read",
          description: "Read records",
          permissionsRequired: ["records:read"],
          inputTypes: [],
          outputTypes: ["record"]
        }
      ],
      status: "healthy",
      lastVerifiedAt: timestamp,
      evidenceRef: contentRef
    }
  ],
  [
    "ContextEnvelope",
    ContextEnvelopeSchema,
    {
      contract: "openorg.context-envelope",
      contractVersion: "1.0.0",
      id: "context-1",
      createdAt: timestamp,
      sources: [
        {
          id: "source-1",
          type: "document",
          contentRef,
          observedAt: timestamp,
          freshness: "fresh",
          permissions: ["docs:read"],
          citations: [contentRef],
          redactions: [
            {
              path: "$.secret",
              withheldType: "credential",
              reason: "access policy"
            }
          ]
        }
      ]
    }
  ],
  [
    "WorkRecord",
    WorkRecordSchema,
    {
      contract: "openorg.work-record",
      contractVersion: "1.0.0",
      id: "work-1",
      version: "1",
      workspace: "swe",
      recordedAt: timestamp,
      actor,
      action: "updated record",
      decisionRef: ref,
      components: [
        { kind: "tool", id: "editor", version: "1", hash: "def456" }
      ],
      contextRef: ref,
      changes: [{ target: "file.txt", operation: "update", after: contentRef }],
      artifacts: [contentRef],
      provenance: { source: "runtime", capturedAt: timestamp }
    }
  ],
  [
    "VerificationReceipt",
    VerificationReceiptSchema,
    {
      contract: "openorg.verification-receipt",
      contractVersion: "1.0.0",
      id: "receipt-1",
      workspace: "swe",
      subject: ref,
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
      measuredOutcomes: [
        { metric: "latency", value: 12, unit: "ms", measuredAt: timestamp }
      ],
      recordedAt: timestamp
    }
  ],
  [
    "LineageAssertion",
    LineageAssertionSchema,
    {
      contract: "openorg.lineage-assertion",
      contractVersion: "1.0.0",
      id: "lineage-1",
      from: ref,
      to: { id: "record-1", version: "2" },
      relationship: "corrects",
      basis: "observed",
      state: "confirmed",
      authority: { kind: "human", id: "person-1" },
      evidenceRefs: [contentRef],
      assertedAt: timestamp
    }
  ],
  [
    "TrainingRecord",
    TrainingRecordSchema,
    {
      contract: "openorg.training-record",
      contractVersion: "1.0.0",
      id: "training-1",
      context: ref,
      action: { id: "work-1", version: "1" },
      correction: {
        original: ref,
        corrected: { id: "record-1", version: "2" },
        reason: "human preference"
      },
      evidence: [contentRef],
      outcome: { description: "Reduced latency", metrics: { latency_ms: 12 } },
      exportedAt: timestamp
    }
  ]
] as const;

describe("contract schema round trips", () => {
  it.each(cases)("round trips %s", (_name, schema, value) => {
    const parsed = schema.parse(value);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(value);
  });

  it("rejects unsupported fields", () => {
    expect(() =>
      CapabilityManifestSchema.parse({ ...cases[0][2], unsupported: true })
    ).toThrow();
  });

  it("rejects healthy status without evidence", () => {
    expect(() =>
      CapabilityManifestSchema.parse({ ...cases[0][2], evidenceRef: undefined })
    ).toThrow();
  });

  it("exports normalized training records to all JSONL shapes", () => {
    const training = TrainingRecordSchema.parse(cases[5][2]);
    expect(JSON.parse(exportSftJsonl([training]))).toHaveProperty("messages");
    expect(JSON.parse(exportPreferenceJsonl([training]))).toEqual({
      prompt: JSON.stringify(training.context),
      chosen: JSON.stringify(training.correction?.corrected),
      rejected: JSON.stringify(training.correction?.original)
    });
    expect(JSON.parse(exportRagJsonl([training]))).toMatchObject({
      id: "training-1",
      metadata: { contractVersion: "1.0.0" }
    });
  });
});
