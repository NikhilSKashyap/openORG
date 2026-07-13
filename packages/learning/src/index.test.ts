import { describe, expect, it } from "vitest";
import {
  evaluateModel,
  predictLocalModel,
  promoteLearning,
  routeEvaluations,
  trainLocalLogisticRegression
} from "./index.js";
import type {
  ConsentGrant,
  EvaluationSuite,
  OrgRecord,
  RoutingPolicy
} from "@openorg/protocol";
import type { ModelProvider } from "@openorg/sdk";

const timestamp = "2026-07-12T10:00:00Z";
const ref = { algorithm: "sha256" as const, digest: "measured-output" };
const suite: EvaluationSuite = {
  contract: "olp.evaluation-suite",
  contractVersion: "0.1.0",
  id: "suite-1",
  version: "1",
  organizationId: "acme",
  workspaceId: "fde",
  title: "Routing answers",
  createdAt: timestamp,
  createdBy: { kind: "human", id: "owner" },
  cases: [
    {
      id: "case-1",
      kind: "model_output",
      input: "route urgent ticket",
      expectedOutput: "technical support",
      sourceRefs: [{ id: "correction-1", version: "1" }],
      permissions: ["customer:read"]
    },
    {
      id: "case-2",
      kind: "model_output",
      input: "route pricing question",
      expectedOutput: "sales",
      sourceRefs: [{ id: "correction-2", version: "1" }],
      permissions: ["customer:read"]
    }
  ]
};
const model = (
  id: string,
  outputs: Record<string, string>,
  cost?: number
): ModelProvider => ({
  manifest: {
    contract: "openorg.capability-manifest",
    contractVersion: "1.0.0",
    id,
    version: "1",
    kind: "model",
    capabilities: [],
    status: "available"
  },
  modelId: `${id}-model`,
  async invoke(input) {
    return {
      output: outputs[input.caseId] ?? "unknown",
      modelId: `${id}-model`,
      latencyMs: id === "fast" ? 3 : 8,
      ...(cost === undefined
        ? {}
        : { cost: { amount: cost, currency: "USD" } }),
      evidenceRefs: [ref]
    };
  }
});

describe("enterprise learning loop", () => {
  it("measures interchangeable providers and routes on real quality and cost", async () => {
    const clock = () => timestamp;
    const accurate = await evaluateModel(
      suite,
      model(
        "accurate",
        {
          "case-1": "technical support",
          "case-2": "sales"
        },
        0.04
      ),
      clock
    );
    const cheap = await evaluateModel(
      suite,
      model(
        "cheap",
        {
          "case-1": "technical support",
          "case-2": "support"
        },
        0.01
      ),
      clock
    );
    expect(accurate.metrics.passRate).toBe(1);
    expect(cheap.metrics.passRate).toBe(0.5);
    const policy: RoutingPolicy = {
      contract: "olp.routing-policy",
      contractVersion: "0.1.0",
      id: "route-policy",
      version: "1",
      organizationId: "acme",
      candidateProviderIds: ["accurate", "cheap"],
      objective: "lowest_cost",
      minimumPassRate: 0.9,
      maximumTotalCost: { amount: 0.1, currency: "USD" },
      createdAt: timestamp
    };
    expect(
      routeEvaluations(policy, [accurate, cheap], clock).selectedProviderId
    ).toBe("accurate");
    const replaced = { ...policy, candidateProviderIds: ["cheap"] };
    expect(routeEvaluations(replaced, [cheap], clock).status).toBe("blocked");
  });

  it("never treats unknown cost as zero", async () => {
    const evaluation = await evaluateModel(
      suite,
      model("unknown-cost", {
        "case-1": "technical support",
        "case-2": "sales"
      }),
      () => timestamp
    );
    expect(evaluation.metrics.totalCost).toBeUndefined();
    expect(evaluation.metrics.costCoverage).toBe(0);
    expect(
      routeEvaluations(
        {
          contract: "olp.routing-policy",
          contractVersion: "0.1.0",
          id: "cost-policy",
          version: "1",
          organizationId: "acme",
          candidateProviderIds: ["unknown-cost"],
          objective: "lowest_cost",
          minimumPassRate: 1,
          createdAt: timestamp
        },
        [evaluation],
        () => timestamp
      ).status
    ).toBe("blocked");
  });

  it("trains and evaluates a real local model without network egress", () => {
    const examples = [
      { features: [0, 0], label: 0 as const },
      { features: [0, 1], label: 0 as const },
      { features: [1, 0], label: 1 as const },
      { features: [1, 1], label: 1 as const },
      { features: [0.1, 0.2], label: 0 as const },
      { features: [0.9, 0.2], label: 1 as const }
    ];
    const result = trainLocalLogisticRegression(
      {
        jobId: "train-1",
        modelId: "model-1",
        organizationId: "acme",
        datasetRef: { id: "dataset-1", version: "1" },
        examples
      },
      () => timestamp
    );
    expect(result.job.executionBoundary).toBe("same_process");
    expect(result.job.metrics.trainingAccuracy).toBe(1);
    expect(predictLocalModel(result.artifact, [0.95, 0.4])).toBe(1);
    expect(predictLocalModel(result.artifact, [0.05, 0.4])).toBe(0);
  });

  it("promotes failures to evals and corrections to human-gated policy candidates", () => {
    const base = {
      contract: "openorg.org-record" as const,
      contractVersion: "0.2.0" as const,
      organizationId: "acme",
      workspaceId: "fde",
      occurredAt: timestamp,
      recordedAt: timestamp,
      actor: { kind: "human" as const, id: "owner" },
      subjectRefs: [{ type: "initiative" as const, id: "initiative-1" }],
      source: { system: "openfde", externalId: "run-1", capturedAt: timestamp },
      access: {
        classification: "internal" as const,
        policyIds: [],
        permissions: ["repo:read"]
      }
    };
    const work: OrgRecord = {
      ...base,
      id: "work-1",
      version: "1",
      recordType: "work",
      payload: {
        title: "Implement routing",
        intent: "Route tickets to the correct team",
        workType: "task",
        status: "completed",
        stage: "verify",
        decisionRefs: [],
        contextRefs: [],
        components: [],
        changes: []
      }
    };
    const verification: OrgRecord = {
      ...base,
      id: "verify-1",
      version: "1",
      recordType: "verification",
      actor: { kind: "service", id: "test-runner" },
      payload: {
        title: "Routing checks",
        policyRef: "routing-policy",
        subjectRefs: [{ id: "work-1", version: "1" }],
        verdict: "failed",
        independent: true,
        checks: [
          { id: "routes-pricing", status: "failed", evidenceRefs: [ref] }
        ],
        humanApprovals: []
      }
    };
    const correction: OrgRecord = {
      ...base,
      id: "correction-1",
      version: "1",
      recordType: "correction",
      payload: {
        title: "Pricing routes to sales",
        reason: "The model routed a pricing request to support",
        originalRef: { id: "work-1", version: "1" },
        correctedRef: { id: "work-1", version: "2" },
        rejectedContent: "support",
        preferredContent: "sales"
      }
    };
    const selfVerification: OrgRecord = {
      ...verification,
      id: "verify-self",
      payload: {
        ...verification.payload,
        independent: false,
        checks: [{ id: "self-check", status: "failed", evidenceRefs: [ref] }]
      }
    };
    const outcome: OrgRecord = {
      ...base,
      id: "outcome-1",
      version: "1",
      recordType: "outcome",
      payload: {
        title: "Corrected routing measured",
        description: "The corrected route sent pricing requests to sales",
        outcomeType: "technical",
        metrics: [{ name: "correctRouteRate", value: 1 }],
        measuredAt: timestamp,
        measurementSourceRefs: [{ id: "correction-1", version: "1" }]
      }
    };
    const promoted = promoteLearning(
      [work, verification, selfVerification, correction, outcome],
      "acme",
      "fde",
      { kind: "service", id: "learning-loop" },
      () => timestamp
    );
    expect(promoted.suite?.cases).toHaveLength(2);
    expect(promoted.policies).toMatchObject([{ status: "proposed" }]);
    expect("approvedBy" in (promoted.policies[0] ?? {})).toBe(false);
    expect(promoted.proposals).toHaveLength(2);
    expect(promoted.eligibilityReceipts).toMatchObject([
      { decision: "eligible" },
      { decision: "eligible" }
    ]);
    expect(promoted.artifacts).toHaveLength(2);
  });

  it("blocks consent-bound evidence until the exact active grant is resolved", () => {
    const correction: OrgRecord = {
      contract: "openorg.org-record",
      contractVersion: "0.2.0",
      id: "correction-with-consent",
      version: "1",
      organizationId: "acme",
      workspaceId: "fde",
      recordType: "correction",
      occurredAt: timestamp,
      recordedAt: timestamp,
      actor: { kind: "human", id: "owner" },
      subjectRefs: [{ type: "initiative", id: "initiative-consent" }],
      source: {
        system: "openfde",
        externalId: "correction-with-consent",
        capturedAt: timestamp
      },
      access: {
        classification: "confidential",
        policyIds: [],
        permissions: ["customer:read"],
        consentRef: { id: "consent-learning", version: "1" }
      },
      payload: {
        title: "Use the preferred route",
        reason: "A reviewer corrected the original route",
        originalRef: { id: "route-original", version: "1" },
        correctedRef: { id: "route-corrected", version: "1" },
        rejectedContent: "support",
        preferredContent: "sales"
      }
    };
    const blocked = promoteLearning(
      [correction],
      "acme",
      "fde",
      { kind: "service", id: "learning-loop" },
      () => timestamp
    );
    expect(blocked.suite).toBeUndefined();
    expect(blocked.eligibilityReceipts[0]?.decision).toBe("blocked");
    expect(
      blocked.eligibilityReceipts[0]?.checks.find(
        (check) => check.check === "consent"
      )
    ).toMatchObject({ check: "consent", status: "failed" });

    const grant: ConsentGrant = {
      contract: "openorg.consent-grant",
      contractVersion: "1.0.0",
      id: "consent-learning",
      version: "1",
      organizationId: "acme",
      grantedBy: { kind: "human", id: "owner" },
      granteeIds: ["learning-loop"],
      actions: ["learning.promote"],
      purposes: ["evaluation", "policy"],
      destinationIds: ["openorg-learning"],
      recordTypes: ["correction"],
      recordRefs: [{ id: correction.id, version: correction.version }],
      evidenceRefs: [ref],
      grantedAt: timestamp
    };
    const eligible = promoteLearning(
      [correction],
      "acme",
      "fde",
      { kind: "service", id: "learning-loop" },
      {
        clock: () => timestamp,
        consentGrants: [grant],
        principal: {
          identity: { kind: "service", id: "learning-loop" },
          organizationId: "acme",
          permissions: []
        }
      }
    );
    expect(eligible.suite).toBeDefined();
    expect(eligible.eligibilityReceipts[0]?.decision).toBe("eligible");
    expect(
      eligible.eligibilityReceipts[0]?.checks.find(
        (check) => check.check === "consent"
      )
    ).toMatchObject({ check: "consent", status: "passed" });
  });
});
