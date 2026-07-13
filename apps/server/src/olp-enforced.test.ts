import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AccessPolicyManifest,
  CapabilityManifest,
  EvaluationReceipt,
  LearningArtifact,
  PromotionReceipt
} from "@openorg/protocol";
import type { ModelProvider } from "@openorg/sdk";
import { MemoryStore } from "@openorg/store-memory";
import { createServer } from "./app.js";

const timestamp = "2026-07-13T12:00:00Z";
const humanAuthorization = { authorization: "Bearer alice-secret" };
const agentAuthorization = { authorization: "Bearer build-agent-secret" };
const apps = new Set<ReturnType<typeof createServer>>();

afterEach(async () => Promise.all([...apps].map(async (app) => app.close())));

const content = (value: string) => ({
  algorithm: "sha256" as const,
  digest: createHash("sha256").update(value).digest("hex"),
  mediaType: "text/plain"
});

const policy: AccessPolicyManifest = {
  contract: "openorg.access-policy",
  contractVersion: "1.0.0",
  id: "policy-acme-olp",
  version: "1",
  organizationId: "acme",
  defaultEffect: "deny",
  createdAt: timestamp,
  rules: [
    {
      id: "olp-operators",
      effect: "allow",
      actions: [
        "record.read",
        "record.write",
        "lineage.read",
        "lineage.write",
        "learning.evaluate",
        "learning.train",
        "learning.route",
        "learning.promote",
        "policy.approve"
      ],
      principalIds: ["alice", "build-agent"],
      requiredPermissions: [],
      recordTypes: [],
      classifications: [],
      purposes: [],
      destinationKinds: [],
      requireConsent: false
    }
  ]
};

const security = {
  mode: "enforced" as const,
  policy,
  apiKeys: [
    {
      token: "alice-secret",
      principal: {
        identity: { kind: "human" as const, id: "alice" },
        organizationId: "acme",
        permissions: ["learning:read"]
      }
    },
    {
      token: "build-agent-secret",
      principal: {
        identity: { kind: "agent" as const, id: "build-agent" },
        organizationId: "acme",
        permissions: ["learning:read"]
      }
    }
  ]
};

const modelManifest: CapabilityManifest = {
  contract: "openorg.capability-manifest",
  contractVersion: "1.0.0",
  id: "enforced-eval-provider",
  version: "1",
  kind: "model",
  capabilities: [],
  status: "configured"
};

const provider: ModelProvider = {
  manifest: modelManifest,
  modelId: "enforced-eval-model",
  async invoke() {
    return {
      output: "Check tenant ownership before routing",
      modelId: "enforced-eval-model",
      latencyMs: 10,
      cost: { amount: 0.001, currency: "USD" },
      evidenceRefs: [content("enforced evaluation output")]
    };
  }
};

const correction = {
  contract: "openorg.org-record",
  contractVersion: "0.2.0",
  id: "correction-enforced-tenant-route",
  version: "1",
  organizationId: "acme",
  workspaceId: "swe",
  recordType: "correction",
  occurredAt: timestamp,
  recordedAt: timestamp,
  actor: { kind: "human", id: "alice" },
  subjectRefs: [{ type: "initiative", id: "tenant-safe-routing" }],
  source: {
    system: "review",
    externalId: "review-enforced-tenant-route",
    capturedAt: timestamp
  },
  access: {
    classification: "internal",
    policyIds: [policy.id],
    permissions: ["learning:read"]
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

describe("OLP enforced security", () => {
  it("binds evaluation and promotion to authenticated identities", async () => {
    const store = new MemoryStore();
    const app = createServer(
      store,
      undefined,
      {},
      {},
      { security, modelProviders: [provider] }
    );
    apps.add(app);

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/learning/promote",
      payload: { organizationId: "acme", workspaceId: "swe" }
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({
      invariant: "authentication"
    });

    const correctionResponse = await app.inject({
      method: "POST",
      url: "/api/records",
      headers: humanAuthorization,
      payload: correction
    });
    expect(correctionResponse.statusCode).toBe(201);

    const promoted = await app.inject({
      method: "POST",
      url: "/api/learning/promote",
      headers: humanAuthorization,
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
    if (!artifact) throw new Error("expected an evaluation-suite artifact");

    const currentArtifact: LearningArtifact = { ...artifact, version: "2" };
    await store.append(currentArtifact);

    const forgedEvaluation = await app.inject({
      method: "POST",
      url: "/api/records",
      headers: humanAuthorization,
      payload: {
        contract: "olp.evaluation-receipt",
        contractVersion: "0.1.0",
        id: "evaluation-receipt-forged-identity",
        version: "1",
        organizationId: "acme",
        artifactRef: {
          id: currentArtifact.id,
          version: currentArtifact.version
        },
        evaluationRefs: [{ id: "forged-run", version: "1" }],
        verdict: "passed",
        metrics: { passRate: 1 },
        evidenceRefs: [content("forged evaluation")],
        evaluatedBy: { kind: "service", id: "forged-evaluator" },
        independent: true,
        evaluatedAt: timestamp
      }
    });
    expect(forgedEvaluation.statusCode).toBe(422);
    expect(forgedEvaluation.json()).toMatchObject({
      invariant: "evaluation-identity"
    });

    const agentPromotion = await app.inject({
      method: "POST",
      url: "/api/learning/promotions",
      headers: agentAuthorization,
      payload: {
        artifactId: currentArtifact.id,
        decision: "approved",
        target: { kind: "memory", id: "private-eval-memory" },
        reasons: ["Agent attempted to promote its own work"]
      }
    });
    expect(agentPromotion.statusCode).toBe(403);
    expect(agentPromotion.json()).toMatchObject({
      invariant: "learning-promotion"
    });

    const evaluated = await app.inject({
      method: "POST",
      url: "/api/learning/evaluate",
      headers: humanAuthorization,
      payload: {
        suiteId: promotedBody.suite.id,
        providerIds: [provider.manifest.id]
      }
    });
    expect(evaluated.statusCode).toBe(201);
    const evaluation = (
      await store.query({ kind: "olp.evaluation-receipt" })
    )[0] as EvaluationReceipt | undefined;
    expect(evaluation).toMatchObject({
      artifactRef: {
        id: currentArtifact.id,
        version: currentArtifact.version
      },
      verdict: "passed",
      independent: true
    });
    if (!evaluation) throw new Error("expected an evaluation receipt");

    const approved = await app.inject({
      method: "POST",
      url: "/api/learning/promotions",
      headers: humanAuthorization,
      payload: {
        artifactId: currentArtifact.id,
        evaluationReceiptIds: [evaluation.id],
        decision: "approved",
        target: { kind: "memory", id: "private-eval-memory" },
        reasons: ["Independent private evaluation passed"]
      }
    });
    expect(approved.statusCode).toBe(201);
    const promotion = approved.json<PromotionReceipt>();
    expect(promotion).toMatchObject({
      artifactRef: {
        id: currentArtifact.id,
        version: currentArtifact.version
      },
      decidedBy: { kind: "human", id: "alice" }
    });

    const outcome = await app.inject({
      method: "POST",
      url: "/api/records",
      headers: humanAuthorization,
      payload: {
        ...correction,
        id: "outcome-enforced-promotion",
        recordType: "outcome",
        source: {
          system: "metrics",
          externalId: "outcome-enforced-promotion",
          capturedAt: timestamp
        },
        payload: {
          title: "Promoted evaluation measured",
          description: "The private evaluation caught the known regression",
          outcomeType: "technical",
          metrics: [{ name: "regressionsCaught", value: 1 }],
          measuredAt: timestamp,
          measurementSourceRefs: [
            { id: promotion.id, version: promotion.version }
          ]
        }
      }
    });
    expect(outcome.statusCode).toBe(201);

    const rolledBack = await app.inject({
      method: "POST",
      url: "/api/learning/promotions",
      headers: humanAuthorization,
      payload: {
        artifactId: currentArtifact.id,
        decision: "rolled_back",
        target: promotion.target,
        reasons: ["Measured outcome requires another review"],
        rollbackOf: { id: promotion.id, version: promotion.version }
      }
    });
    expect(rolledBack.statusCode).toBe(201);
    expect(rolledBack.json()).toMatchObject({
      decision: "rolled_back",
      decidedBy: { kind: "human", id: "alice" },
      rollbackOf: { id: promotion.id, version: promotion.version }
    });
  });
});
