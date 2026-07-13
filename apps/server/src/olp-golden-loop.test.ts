import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CapabilityManifest,
  EvaluationReceipt,
  LearningArtifact,
  PromotionReceipt
} from "@openorg/protocol";
import type { ModelProvider } from "@openorg/sdk";
import { MemoryStore } from "@openorg/store-memory";
import { createServer } from "./app.js";

const timestamp = "2026-07-12T10:00:00Z";
const apps = new Set<ReturnType<typeof createServer>>();
afterEach(async () => Promise.all([...apps].map(async (app) => app.close())));

const content = (value: string) => ({
  algorithm: "sha256" as const,
  digest: createHash("sha256").update(value).digest("hex"),
  mediaType: "text/plain"
});

const modelManifest: CapabilityManifest = {
  contract: "openorg.capability-manifest",
  contractVersion: "1.0.0",
  id: "private-eval-provider",
  version: "1",
  kind: "model",
  capabilities: [],
  status: "configured"
};

const provider: ModelProvider = {
  manifest: modelManifest,
  modelId: "private-eval-model",
  async invoke() {
    return {
      output: "Check tenant ownership before routing",
      modelId: "private-eval-model",
      latencyMs: 12,
      cost: { amount: 0.002, currency: "USD" },
      evidenceRefs: [content("private evaluation output")]
    };
  }
};

describe("ORP and OLP golden loop", () => {
  it("replays evidence through eligibility, evaluation, human promotion, and measured outcome", async () => {
    const store = new MemoryStore();
    const app = createServer(
      store,
      undefined,
      {},
      {},
      {
        modelProviders: [provider]
      }
    );
    apps.add(app);
    const common = {
      contract: "openorg.org-record",
      contractVersion: "0.2.0",
      organizationId: "acme",
      workspaceId: "swe",
      occurredAt: timestamp,
      recordedAt: timestamp,
      subjectRefs: [{ type: "initiative", id: "tenant-safe-routing" }],
      access: {
        classification: "internal",
        policyIds: [],
        permissions: ["learning:read"]
      }
    };
    const correction = {
      ...common,
      id: "correction-tenant-route",
      version: "1",
      recordType: "correction",
      actor: { kind: "human", id: "reviewer" },
      source: {
        system: "review",
        externalId: "review-tenant-route",
        capturedAt: timestamp
      },
      payload: {
        title: "Preserve the tenant boundary",
        reason: "The original route crossed a tenant boundary",
        originalRef: { id: "route-original", version: "1" },
        correctedRef: { id: "route-corrected", version: "1" },
        rejectedContent: "Route without checking tenant ownership",
        preferredContent: "Check tenant ownership before routing"
      }
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: correction
        })
      ).statusCode
    ).toBe(201);

    const promoted = await app.inject({
      method: "POST",
      url: "/api/learning/promote",
      payload: { organizationId: "acme", workspaceId: "swe" }
    });
    expect(promoted.statusCode).toBe(201);
    const promotedBody = promoted.json<{
      suite: { id: string; version: string };
      artifacts: LearningArtifact[];
    }>();
    const artifact = promotedBody.artifacts.find(
      (value) => value.artifactType === "evaluation_suite"
    );
    expect(artifact).toBeDefined();
    if (!artifact) throw new Error("expected a governed evaluation artifact");

    const wrongVersionEvaluation = await app.inject({
      method: "POST",
      url: "/api/records",
      payload: {
        contract: "olp.evaluation-receipt",
        contractVersion: "0.1.0",
        id: "evaluation-receipt-wrong-artifact-version",
        version: "1",
        organizationId: "acme",
        artifactRef: { id: artifact.id, version: "not-the-current-version" },
        evaluationRefs: [{ id: "wrong-version-run", version: "1" }],
        verdict: "failed",
        metrics: { passRate: 0 },
        evidenceRefs: [],
        evaluatedBy: { kind: "service", id: "independent-evaluator" },
        independent: true,
        evaluatedAt: timestamp
      }
    });
    expect(wrongVersionEvaluation.statusCode).toBe(422);
    expect(wrongVersionEvaluation.json()).toMatchObject({
      invariant: "evaluation-artifact-binding"
    });

    const failedEvaluation = {
      contract: "olp.evaluation-receipt",
      contractVersion: "0.1.0",
      id: "evaluation-receipt-failed",
      version: "1",
      organizationId: "acme",
      artifactRef: { id: artifact.id, version: artifact.version },
      evaluationRefs: [{ id: "failed-run", version: "1" }],
      verdict: "failed",
      metrics: { passRate: 0 },
      evidenceRefs: [],
      evaluatedBy: { kind: "service", id: "independent-evaluator" },
      independent: true,
      evaluatedAt: timestamp
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: failedEvaluation
        })
      ).statusCode
    ).toBe(201);
    const bypassAttempt = await app.inject({
      method: "POST",
      url: "/api/records",
      payload: {
        contract: "olp.promotion-receipt",
        contractVersion: "0.1.0",
        id: "promotion-bypass-attempt",
        version: "1",
        organizationId: "acme",
        proposalRef: artifact.proposalRef,
        eligibilityRef: artifact.eligibilityRef,
        artifactRef: { id: artifact.id, version: artifact.version },
        evaluationRefs: [
          { id: failedEvaluation.id, version: failedEvaluation.version }
        ],
        decision: "approved",
        target: { kind: "memory", id: "private-eval-memory" },
        reasons: ["Attempted direct approval"],
        decidedBy: { kind: "human", id: "local-operator" },
        decidedAt: timestamp
      }
    });
    expect(bypassAttempt.statusCode).toBe(422);
    expect(bypassAttempt.json()).toMatchObject({
      invariant: "learning-promotion"
    });

    const evaluated = await app.inject({
      method: "POST",
      url: "/api/learning/evaluate",
      payload: {
        suiteId: promotedBody.suite.id,
        providerIds: [provider.manifest.id]
      }
    });
    expect(evaluated.statusCode).toBe(201);
    const evaluation = (
      await store.query({
        kind: "olp.evaluation-receipt"
      })
    ).find((record) => record.id !== failedEvaluation.id) as
      EvaluationReceipt | undefined;
    expect(evaluation).toMatchObject({
      artifactRef: { id: artifact.id, version: artifact.version },
      verdict: "passed",
      independent: true
    });
    if (!evaluation) throw new Error("expected an evaluation receipt");

    const promotionResponse = await app.inject({
      method: "POST",
      url: "/api/learning/promotions",
      payload: {
        artifactId: artifact.id,
        evaluationReceiptIds: [evaluation.id],
        decision: "approved",
        target: { kind: "memory", id: "private-eval-memory" },
        reasons: ["Independent private evaluation passed"]
      }
    });
    expect(promotionResponse.statusCode).toBe(201);
    const promotion = promotionResponse.json<PromotionReceipt>();
    expect(promotion).toMatchObject({
      artifactRef: { id: artifact.id, version: artifact.version },
      decidedBy: { kind: "human", id: "local-operator" }
    });

    const measuredOutcome = {
      ...common,
      id: "outcome-promoted-eval",
      version: "1",
      recordType: "outcome",
      actor: { kind: "service", id: "production-metrics" },
      source: {
        system: "metrics",
        externalId: "outcome-promoted-eval",
        capturedAt: timestamp
      },
      payload: {
        title: "Promoted tenant-route evaluation measured",
        description: "The promoted private eval catches the known regression",
        outcomeType: "technical",
        metrics: [{ name: "regressionsCaught", value: 1 }],
        measuredAt: timestamp,
        measurementSourceRefs: [
          { id: promotion.id, version: promotion.version }
        ]
      }
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: measuredOutcome
        })
      ).statusCode
    ).toBe(201);

    const allRecords = await store.query({ history: "all" });
    const byId = new Map(allRecords.map((record) => [record.id, record]));
    expect(byId.get(artifact.proposalRef.id)?.contract).toBe(
      "olp.learning-proposal"
    );
    expect(byId.get(artifact.eligibilityRef.id)?.contract).toBe(
      "olp.eligibility-receipt"
    );
    expect(byId.get(evaluation.id)?.contract).toBe("olp.evaluation-receipt");
    expect(byId.get(promotion.id)?.contract).toBe("olp.promotion-receipt");
    expect(byId.get(measuredOutcome.id)).toMatchObject({
      contract: "openorg.org-record",
      payload: {
        measurementSourceRefs: [
          { id: promotion.id, version: promotion.version }
        ]
      }
    });

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/api/learning/promotions",
      payload: {
        artifactId: artifact.id,
        decision: "rolled_back",
        target: promotion.target,
        reasons: ["Production outcome requires another review"],
        rollbackOf: { id: promotion.id, version: promotion.version }
      }
    });
    expect(rollbackResponse.statusCode).toBe(201);
    expect(rollbackResponse.json()).toMatchObject({
      decision: "rolled_back",
      rollbackOf: { id: promotion.id, version: promotion.version },
      artifactRef: promotion.artifactRef,
      target: promotion.target
    });
  });
});
