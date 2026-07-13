import { describe, expect, it } from "vitest";
import {
  AccessPolicyManifestSchema,
  CapabilityManifestSchema,
  ConsentGrantSchema,
  ContextEnvelopeSchema,
  EgressReceiptSchema,
  EvaluationSuiteSchema,
  LineageAssertionSchema,
  ModelArtifactSchema,
  ModelEvaluationSchema,
  ReusablePolicySchema,
  RoutingDecisionSchema,
  RoutingPolicySchema,
  TrainingJobSchema,
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
    "AccessPolicyManifest",
    AccessPolicyManifestSchema,
    {
      contract: "openorg.access-policy",
      contractVersion: "1.0.0",
      id: "policy-1",
      version: "1",
      organizationId: "acme",
      defaultEffect: "deny",
      createdAt: timestamp,
      rules: [
        {
          id: "read",
          effect: "allow",
          actions: ["record.read"],
          principalIds: ["person-1"],
          requiredPermissions: [],
          recordTypes: [],
          classifications: [],
          purposes: [],
          destinationKinds: [],
          requireConsent: false
        }
      ]
    }
  ],
  [
    "ConsentGrant",
    ConsentGrantSchema,
    {
      contract: "openorg.consent-grant",
      contractVersion: "1.0.0",
      id: "consent-1",
      version: "1",
      organizationId: "acme",
      grantedBy: { kind: "human", id: "person-1" },
      granteeIds: ["person-1"],
      actions: ["export.evaluation"],
      purposes: ["model-improvement"],
      destinationIds: ["customer-vpc"],
      recordTypes: [],
      recordRefs: [ref],
      evidenceRefs: [contentRef],
      grantedAt: timestamp
    }
  ],
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
  ],
  [
    "EvaluationSuite",
    EvaluationSuiteSchema,
    {
      contract: "olp.evaluation-suite",
      contractVersion: "0.1.0",
      id: "suite-1",
      version: "1",
      organizationId: "acme",
      workspaceId: "swe",
      title: "Private evals",
      createdAt: timestamp,
      createdBy: { kind: "human", id: "person-1" },
      cases: [
        {
          id: "case-1",
          kind: "model_output",
          input: "input",
          expectedOutput: "output",
          sourceRefs: [ref],
          permissions: []
        }
      ]
    }
  ],
  [
    "ModelEvaluation",
    ModelEvaluationSchema,
    {
      contract: "olp.model-evaluation",
      contractVersion: "0.1.0",
      id: "evaluation-1",
      organizationId: "acme",
      suiteRef: { id: "suite-1", version: "1" },
      providerId: "model-provider",
      modelId: "model-1",
      startedAt: timestamp,
      completedAt: timestamp,
      results: [
        {
          caseId: "case-1",
          status: "passed",
          output: "output",
          latencyMs: 10,
          cost: { amount: 0.01, currency: "USD" },
          evidenceRefs: []
        }
      ],
      metrics: {
        totalCases: 1,
        passedCases: 1,
        passRate: 1,
        averageLatencyMs: 10,
        totalCost: { amount: 0.01, currency: "USD" },
        costCoverage: 1
      }
    }
  ],
  [
    "RoutingPolicy",
    RoutingPolicySchema,
    {
      contract: "olp.routing-policy",
      contractVersion: "0.1.0",
      id: "routing-1",
      version: "1",
      organizationId: "acme",
      candidateProviderIds: ["model-provider"],
      objective: "highest_quality",
      minimumPassRate: 0.9,
      createdAt: timestamp
    }
  ],
  [
    "RoutingDecision",
    RoutingDecisionSchema,
    {
      contract: "olp.routing-decision",
      contractVersion: "0.1.0",
      id: "routing-decision-1",
      organizationId: "acme",
      policyRef: { id: "routing-1", version: "1" },
      evaluationRefs: [{ id: "evaluation-1", version: "1" }],
      status: "selected",
      selectedProviderId: "model-provider",
      reasons: ["met measured quality floor"],
      decidedAt: timestamp
    }
  ],
  [
    "ModelArtifact",
    ModelArtifactSchema,
    {
      contract: "olp.model-artifact",
      contractVersion: "0.1.0",
      id: "model-artifact-1",
      organizationId: "acme",
      modelType: "adapter_weights",
      providerId: "customer-trainer",
      baseModelId: "base-model",
      contentRef,
      createdAt: timestamp
    }
  ],
  [
    "TrainingJob",
    TrainingJobSchema,
    {
      contract: "olp.training-job",
      contractVersion: "0.1.0",
      id: "training-job-1",
      organizationId: "acme",
      adapterId: "customer-trainer",
      method: "external_adapter",
      executionBoundary: "organization_vpc",
      datasetRef: { id: "dataset-1", version: "1" },
      status: "completed",
      modelRef: { id: "model-artifact-1", version: "1" },
      inputDigest: contentRef,
      metrics: { validationAccuracy: 0.9 },
      startedAt: timestamp,
      completedAt: timestamp
    }
  ],
  [
    "ReusablePolicy",
    ReusablePolicySchema,
    {
      contract: "olp.reusable-policy",
      contractVersion: "0.1.0",
      id: "reusable-policy-1",
      version: "1",
      organizationId: "acme",
      status: "proposed",
      scope: ["swe"],
      instruction: "Check tenant ownership before routing",
      sourceRefs: [ref],
      evidenceRefs: [contentRef],
      createdBy: actor,
      createdAt: timestamp
    }
  ],
  [
    "EgressReceipt",
    EgressReceiptSchema,
    {
      contract: "openorg.egress-receipt",
      contractVersion: "1.0.0",
      id: "egress-1",
      organizationId: "acme",
      actor: { kind: "human", id: "person-1" },
      action: "export.evaluation",
      purpose: "model-improvement",
      destination: {
        kind: "external",
        id: "customer-vpc",
        uri: "https://customer.example/upload"
      },
      datasetRef: { id: "dataset-1", version: "1" },
      consentRef: { id: "consent-1", version: "1" },
      policyRef: { id: "policy-1", version: "1" },
      recordRefs: [ref],
      contentRef,
      createdAt: timestamp
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
    const training = TrainingRecordSchema.parse(cases[7][2]);
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
