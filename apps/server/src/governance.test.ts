import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type {
  AccessPolicyManifest,
  CapabilityManifest,
  ConsentGrant,
  EvaluationSuite,
  RoutingPolicy
} from "@openorg/protocol";
import type { ModelProvider, TrainingAdapter } from "@openorg/sdk";
import { MemoryStore } from "@openorg/store-memory";
import { createServer } from "./app.js";

const timestamp = "2026-07-12T18:00:00Z";
const allActions = [
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
] as const;
const policy: AccessPolicyManifest = {
  contract: "openorg.access-policy",
  contractVersion: "1.0.0",
  id: "policy-acme",
  version: "1",
  organizationId: "acme",
  defaultEffect: "deny",
  createdAt: timestamp,
  rules: [
    {
      id: "alice-control",
      effect: "allow",
      actions: [...allActions],
      principalIds: ["alice"],
      requiredPermissions: [],
      recordTypes: [],
      classifications: [],
      purposes: [],
      destinationKinds: [],
      requireConsent: false
    },
    {
      id: "external-consent",
      effect: "allow",
      actions: ["export.rag"],
      principalIds: ["alice"],
      requiredPermissions: [],
      recordTypes: [],
      classifications: [],
      purposes: ["model-improvement"],
      destinationKinds: ["external"],
      requireConsent: true
    }
  ]
};
const authorization = { authorization: "Bearer alice-secret" };
const security = {
  mode: "enforced" as const,
  policy,
  apiKeys: [
    {
      token: "alice-secret",
      principal: {
        identity: { kind: "human" as const, id: "alice" },
        organizationId: "acme",
        permissions: ["account:read"]
      }
    }
  ]
};
const signal = {
  contract: "openorg.org-record",
  contractVersion: "0.2.0",
  id: "signal-governed",
  version: "1",
  organizationId: "acme",
  workspaceId: "gtm",
  recordType: "signal",
  occurredAt: timestamp,
  recordedAt: timestamp,
  actor: { kind: "human", id: "alice" },
  subjectRefs: [{ type: "account", id: "account-1" }],
  source: {
    system: "crm",
    externalId: "signal-1",
    capturedAt: timestamp
  },
  access: {
    classification: "confidential",
    policyIds: [policy.id],
    permissions: ["account:read"]
  },
  payload: {
    title: "Private customer signal",
    summary: "Keep the learning inside the customer boundary.",
    severity: "high",
    status: "captured",
    sourceRefs: []
  }
};

const apps = new Set<ReturnType<typeof createServer>>();
afterEach(async () => Promise.all([...apps].map(async (app) => app.close())));

describe("private learning boundary", () => {
  it("requires identity, purpose, consent, and an egress receipt", async () => {
    const app = createServer(
      new MemoryStore(),
      undefined,
      {},
      {},
      { security }
    );
    apps.add(app);
    expect(
      (await app.inject({ method: "GET", url: "/api/records" })).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          headers: authorization,
          payload: signal
        })
      ).statusCode
    ).toBe(201);
    const impersonated = await app.inject({
      method: "POST",
      url: "/api/records",
      headers: authorization,
      payload: {
        ...signal,
        id: "signal-impersonated",
        actor: { kind: "human", id: "bob" }
      }
    });
    expect(impersonated.statusCode).toBe(403);
    expect(impersonated.json()).toMatchObject({
      invariant: "actor-identity"
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/export/rag",
          headers: authorization
        })
      ).statusCode
    ).toBe(405);
    const request = {
      purpose: "model-improvement",
      destination: {
        kind: "external",
        id: "approved-vendor",
        uri: "https://vendor.example/upload"
      }
    };
    const withoutConsent = await app.inject({
      method: "POST",
      url: "/api/export/rag",
      headers: authorization,
      payload: request
    });
    expect(withoutConsent.statusCode).toBe(403);
    expect(withoutConsent.json()).toMatchObject({ invariant: "consent" });

    const consent: ConsentGrant = {
      contract: "openorg.consent-grant",
      contractVersion: "1.0.0",
      id: "consent-vendor",
      version: "1",
      organizationId: "acme",
      grantedBy: { kind: "human", id: "alice" },
      granteeIds: ["alice"],
      actions: ["export.rag"],
      purposes: ["model-improvement"],
      destinationIds: ["approved-vendor"],
      recordTypes: [],
      recordRefs: [{ id: signal.id, version: signal.version }],
      evidenceRefs: [{ algorithm: "sha256", digest: "approval-evidence" }],
      grantedAt: timestamp
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          headers: authorization,
          payload: consent
        })
      ).statusCode
    ).toBe(201);
    const impersonatedAuthority = await app.inject({
      method: "POST",
      url: "/api/lineage",
      headers: authorization,
      payload: {
        contract: "openorg.lineage-assertion",
        contractVersion: "1.0.0",
        id: "lineage-impersonated",
        from: { id: signal.id, version: "1" },
        to: { id: consent.id, version: "1" },
        relationship: "motivates",
        basis: "asserted",
        state: "confirmed",
        authority: { kind: "human", id: "bob" },
        evidenceRefs: [{ algorithm: "sha256", digest: "claimed-evidence" }],
        assertedAt: timestamp
      }
    });
    expect(impersonatedAuthority.statusCode).toBe(422);
    expect(impersonatedAuthority.json()).toMatchObject({
      invariant: "lineage-authority"
    });
    const wrongRecordConsent: ConsentGrant = {
      ...consent,
      id: "consent-wrong-record",
      recordRefs: [{ id: "different-signal", version: "1" }]
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          headers: authorization,
          payload: wrongRecordConsent
        })
      ).statusCode
    ).toBe(201);
    const wrongRecordExport = await app.inject({
      method: "POST",
      url: "/api/export/rag",
      headers: authorization,
      payload: {
        ...request,
        consentRef: { id: wrongRecordConsent.id, version: "1" }
      }
    });
    expect(wrongRecordExport.statusCode).toBe(403);
    expect(wrongRecordExport.json()).toMatchObject({ invariant: "consent" });
    const exported = await app.inject({
      method: "POST",
      url: "/api/export/rag",
      headers: authorization,
      payload: { ...request, consentRef: { id: consent.id, version: "1" } }
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain("Private customer signal");
    expect(exported.headers["x-openorg-dataset-manifest-id"]).toBeTruthy();
    expect(exported.headers["x-openorg-egress-receipt-id"]).toBeTruthy();
    const records = (
      await app.inject({
        method: "GET",
        url: "/api/records",
        headers: authorization
      })
    ).json<{ contract: string }[]>();
    expect(
      records.some((value) => value.contract === "olp.dataset-manifest")
    ).toBe(true);
    expect(
      records.some((value) => value.contract === "openorg.egress-receipt")
    ).toBe(true);
  });

  it("evaluates interchangeable models and routes only on measured evidence", async () => {
    const manifest = (id: string): CapabilityManifest => ({
      contract: "openorg.capability-manifest",
      contractVersion: "1.0.0",
      id,
      version: "1",
      kind: "model",
      capabilities: [],
      status: "configured"
    });
    const provider = (
      id: string,
      amount: number,
      output = "approved"
    ): ModelProvider => ({
      manifest: manifest(id),
      modelId: `${id}-model`,
      async invoke() {
        return {
          output,
          modelId: `${id}-model`,
          latencyMs: id === "fast-cheap" ? 8 : 20,
          cost: { amount, currency: "USD" }
        };
      }
    });
    const app = createServer(
      new MemoryStore(),
      undefined,
      {},
      {},
      {
        modelProviders: [
          provider("fast-cheap", 0.01),
          provider("slow-costly", 0.1)
        ]
      }
    );
    apps.add(app);
    const suite: EvaluationSuite = {
      contract: "olp.evaluation-suite",
      contractVersion: "0.1.0",
      id: "suite-replacement",
      version: "1",
      organizationId: "acme",
      workspaceId: "swe",
      title: "Replacement proof",
      createdAt: timestamp,
      createdBy: { kind: "human", id: "alice" },
      cases: [
        {
          id: "case-1",
          kind: "model_output",
          input: "Should this ship?",
          expectedOutput: "approved",
          sourceRefs: [{ id: "source-1", version: "1" }],
          permissions: []
        }
      ]
    };
    const routing: RoutingPolicy = {
      contract: "olp.routing-policy",
      contractVersion: "0.1.0",
      id: "route-cheapest-qualified",
      version: "1",
      organizationId: "acme",
      candidateProviderIds: ["fast-cheap", "slow-costly"],
      objective: "lowest_cost",
      minimumPassRate: 1,
      createdAt: timestamp
    };
    for (const payload of [suite, routing])
      expect(
        (await app.inject({ method: "POST", url: "/api/records", payload }))
          .statusCode
      ).toBe(201);
    const evaluated = await app.inject({
      method: "POST",
      url: "/api/learning/evaluate",
      payload: {
        suiteId: suite.id,
        providerIds: ["fast-cheap", "slow-costly"]
      }
    });
    expect(evaluated.statusCode).toBe(201);
    const ids = evaluated.json<{ id: string }[]>().map((value) => value.id);
    const decision = await app.inject({
      method: "POST",
      url: "/api/learning/route",
      payload: { policyId: routing.id, evaluationIds: ids }
    });
    expect(decision.statusCode).toBe(201);
    expect(decision.json()).toMatchObject({
      status: "selected",
      selectedProviderId: "fast-cheap"
    });
  });

  it("accepts only receipted VPC trainer output", async () => {
    const trainerManifest: CapabilityManifest = {
      contract: "openorg.capability-manifest",
      contractVersion: "1.0.0",
      id: "customer-vpc-trainer",
      version: "1",
      kind: "trainer",
      capabilities: [],
      status: "configured"
    };
    const trainer: TrainingAdapter = {
      manifest: trainerManifest,
      async train(input) {
        return {
          artifact: {
            contract: "olp.model-artifact",
            contractVersion: "0.1.0",
            id: "customer-model-1",
            organizationId: input.organizationId,
            modelType: "adapter_weights",
            providerId: "customer-runtime",
            baseModelId: "base-model",
            contentRef: {
              algorithm: "sha256",
              digest: "customer-owned-model-artifact"
            },
            createdAt: timestamp
          },
          job: {
            contract: "olp.training-job",
            contractVersion: "0.1.0",
            id: "customer-training-1",
            organizationId: input.organizationId,
            adapterId: trainerManifest.id,
            method: "external_adapter",
            executionBoundary: "organization_vpc",
            datasetRef: input.datasetRef,
            status: "completed",
            modelRef: { id: "customer-model-1", version: "1" },
            inputDigest: { algorithm: "sha256", digest: "dataset-digest" },
            metrics: { validationAccuracy: 0.91 },
            startedAt: timestamp,
            completedAt: timestamp
          }
        };
      }
    };
    const app = createServer(
      new MemoryStore(),
      undefined,
      {},
      {},
      {
        trainingAdapters: [trainer]
      }
    );
    apps.add(app);
    const dataset = {
      contract: "olp.dataset-manifest",
      contractVersion: "0.1.0",
      id: "dataset-private",
      organizationId: "acme",
      purpose: "sft",
      createdAt: timestamp,
      createdBy: "alice",
      policyRefs: [],
      recordRefs: [],
      schemaVersions: ["0.2.0"],
      inclusion: ["human approved"],
      exclusions: [],
      contentRef: { algorithm: "sha256", digest: "dataset-digest" }
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: dataset
        })
      ).statusCode
    ).toBe(201);
    const trained = await app.inject({
      method: "POST",
      url: `/api/learning/train-adapter/${trainerManifest.id}`,
      payload: { datasetId: dataset.id, parameters: { epochs: 1 } }
    });
    expect(trained.statusCode).toBe(201);
    expect(trained.json()).toMatchObject({
      job: { executionBoundary: "organization_vpc" },
      artifact: { id: "customer-model-1" }
    });
  });

  it("trains a real local model only from the manifest-bound dataset", async () => {
    const app = createServer(new MemoryStore());
    apps.add(app);
    const examples = [
      { features: [0, 0], label: 0 as const },
      { features: [0, 1], label: 0 as const },
      { features: [1, 0], label: 1 as const },
      { features: [1, 1], label: 1 as const },
      { features: [2, 0], label: 1 as const },
      { features: [-1, 0], label: 0 as const }
    ];
    const digest = createHash("sha256")
      .update(JSON.stringify(examples))
      .digest("hex");
    const dataset = {
      contract: "olp.dataset-manifest",
      contractVersion: "0.1.0",
      id: "dataset-local-training",
      organizationId: "acme",
      purpose: "sft",
      createdAt: timestamp,
      createdBy: "alice",
      policyRefs: [],
      recordRefs: [],
      schemaVersions: ["0.2.0"],
      inclusion: ["governed labeled rows"],
      exclusions: [],
      contentRef: {
        algorithm: "sha256",
        digest,
        mediaType: "application/json"
      }
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: dataset
        })
      ).statusCode
    ).toBe(201);
    const mismatched = await app.inject({
      method: "POST",
      url: "/api/learning/train/local-logistic",
      payload: { datasetId: dataset.id, examples: examples.slice(0, -1) }
    });
    expect(mismatched.statusCode).toBe(422);
    expect(mismatched.json()).toMatchObject({
      invariant: "training-dataset-binding"
    });
    const trained = await app.inject({
      method: "POST",
      url: "/api/learning/train/local-logistic",
      payload: { datasetId: dataset.id, examples }
    });
    expect(trained.statusCode).toBe(201);
    expect(trained.json()).toMatchObject({
      artifact: { modelType: "logistic_regression", featureCount: 2 },
      job: { status: "completed", metrics: { trainingExamples: 5 } }
    });
  });

  it("promotes failures into evals and corrections into human-gated policy", async () => {
    const app = createServer(new MemoryStore());
    apps.add(app);
    const common = {
      contract: "openorg.org-record",
      contractVersion: "0.2.0",
      organizationId: "acme",
      workspaceId: "swe",
      occurredAt: timestamp,
      recordedAt: timestamp,
      subjectRefs: [{ type: "initiative", id: "learning-loop" }],
      access: {
        classification: "internal",
        policyIds: [],
        permissions: []
      }
    };
    const work = {
      ...common,
      id: "work-failed",
      version: "1",
      recordType: "work",
      actor: { kind: "agent", id: "builder", version: "1" },
      source: {
        system: "harness",
        externalId: "run-failed",
        capturedAt: timestamp
      },
      payload: {
        title: "Implement guarded routing",
        intent: "Route only when the guard passes",
        workType: "task",
        status: "completed",
        stage: "verify",
        decisionRefs: [],
        contextRefs: [],
        components: [],
        changes: []
      }
    };
    const verification = {
      ...common,
      id: "verification-failed",
      version: "1",
      recordType: "verification",
      actor: { kind: "service", id: "ci", version: "1" },
      source: {
        system: "ci",
        externalId: "check-failed",
        capturedAt: timestamp
      },
      payload: {
        title: "Routing verification",
        policyRef: "routing-policy",
        subjectRefs: [{ id: work.id, version: "1" }],
        verdict: "failed",
        independent: true,
        checks: [
          {
            id: "tenant-boundary",
            status: "failed",
            evidenceRefs: [{ algorithm: "sha256", digest: "failed-check" }]
          }
        ],
        humanApprovals: []
      }
    };
    const correction = {
      ...common,
      id: "correction-routing",
      version: "1",
      recordType: "correction",
      actor: { kind: "human", id: "reviewer" },
      source: {
        system: "review",
        externalId: "correction-1",
        capturedAt: timestamp
      },
      payload: {
        title: "Keep tenant boundaries explicit",
        reason: "The original route crossed a tenant boundary",
        originalRef: { id: "answer-original", version: "1" },
        correctedRef: { id: "answer-corrected", version: "1" },
        rejectedContent: "Route without checking tenant ownership",
        preferredContent: "Check tenant ownership before routing"
      }
    };
    const outcome = {
      ...common,
      id: "outcome-routing",
      version: "1",
      recordType: "outcome",
      actor: { kind: "service", id: "production-metrics" },
      source: {
        system: "metrics",
        externalId: "routing-outcome-1",
        capturedAt: timestamp
      },
      payload: {
        title: "Tenant-safe routing measured",
        description: "The corrected route preserved the tenant boundary",
        outcomeType: "technical",
        metrics: [{ name: "tenantBoundaryViolations", value: 0 }],
        measuredAt: timestamp,
        measurementSourceRefs: [
          { id: correction.id, version: correction.version }
        ]
      }
    };
    for (const payload of [work, verification, correction, outcome])
      expect(
        (await app.inject({ method: "POST", url: "/api/records", payload }))
          .statusCode
      ).toBe(201);
    const promoted = await app.inject({
      method: "POST",
      url: "/api/learning/promote",
      payload: { organizationId: "acme", workspaceId: "swe" }
    });
    expect(promoted.statusCode).toBe(201);
    const body = promoted.json<{
      suite: { id: string; version: string; cases: { id: string }[] };
      policies: { id: string; status: string; approvedBy?: unknown }[];
      proposals: { contract: string }[];
      eligibilityReceipts: { decision: string }[];
      artifacts: {
        contract: string;
        id: string;
        version: string;
        organizationId: string;
      }[];
    }>();
    expect(body.suite.cases.map((value) => value.id)).toEqual(
      expect.arrayContaining([
        "eval-verification-failed-tenant-boundary",
        "eval-correction-routing-preference"
      ])
    );
    expect(body.policies[0]).toMatchObject({ status: "proposed" });
    expect(body.proposals).toHaveLength(2);
    expect(body.eligibilityReceipts).toMatchObject([
      { decision: "eligible" },
      { decision: "eligible" }
    ]);
    expect(body.artifacts).toHaveLength(2);
    expect(body.policies[0]).not.toHaveProperty("approvedBy");
    const proposedPolicy = body.policies[0];
    expect(proposedPolicy).toBeDefined();
    if (!proposedPolicy) throw new Error("expected a proposed policy");
    const policyArtifact = body.artifacts.find(
      (artifact) => artifact.id === `artifact-${proposedPolicy.id}`
    );
    expect(policyArtifact).toBeDefined();
    if (!policyArtifact) throw new Error("expected a governed policy artifact");
    const policyEvaluation = {
      contract: "olp.evaluation-receipt",
      contractVersion: "0.1.0",
      id: "evaluation-routing-policy",
      version: "1",
      organizationId: policyArtifact.organizationId,
      artifactRef: {
        id: policyArtifact.id,
        version: policyArtifact.version
      },
      evaluationRefs: [{ id: body.suite.id, version: body.suite.version }],
      verdict: "passed",
      metrics: { passRate: 1 },
      evidenceRefs: [
        {
          algorithm: "sha256",
          digest: "routing-policy-evaluation",
          uri: "openorg://evaluation/routing-policy"
        }
      ],
      evaluatedBy: { kind: "service", id: "independent-evaluator" },
      independent: true,
      evaluatedAt: timestamp
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: policyEvaluation
        })
      ).statusCode
    ).toBe(201);
    const approved = await app.inject({
      method: "POST",
      url: `/api/learning/policies/${proposedPolicy.id}/approve`,
      payload: { evaluationReceiptIds: [policyEvaluation.id] }
    });
    expect(approved.statusCode).toBe(201);
    expect(approved.headers["x-olp-promotion-receipt-id"]).toBeTruthy();
    expect(approved.json()).toMatchObject({
      status: "approved",
      approvedBy: { kind: "human", id: "local-operator" }
    });
  });

  it("derives verification independence from the subject actor", async () => {
    const app = createServer(new MemoryStore());
    apps.add(app);
    const common = {
      contract: "openorg.org-record",
      contractVersion: "0.2.0",
      organizationId: "acme",
      workspaceId: "swe",
      occurredAt: timestamp,
      recordedAt: timestamp,
      subjectRefs: [{ type: "initiative", id: "independence" }],
      access: {
        classification: "internal",
        policyIds: [],
        permissions: []
      }
    };
    const work = {
      ...common,
      id: "work-self-verified",
      version: "1",
      recordType: "work",
      actor: { kind: "agent", id: "same-agent", version: "1" },
      source: {
        system: "harness",
        externalId: "self-run",
        capturedAt: timestamp
      },
      payload: {
        title: "Implement the change",
        intent: "Implement and test",
        workType: "task",
        status: "completed",
        stage: "verify",
        decisionRefs: [],
        contextRefs: [],
        components: [],
        changes: []
      }
    };
    expect(
      (await app.inject({ method: "POST", url: "/api/records", payload: work }))
        .statusCode
    ).toBe(201);
    const verification = {
      ...common,
      id: "verification-self-claimed-independent",
      version: "1",
      recordType: "verification",
      actor: { kind: "agent", id: "same-agent", version: "1" },
      source: {
        system: "harness",
        externalId: "self-check",
        capturedAt: timestamp
      },
      payload: {
        title: "Self check",
        policyRef: "test-policy",
        subjectRefs: [{ id: work.id, version: "1" }],
        verdict: "passed",
        independent: true,
        checks: [
          {
            id: "unit-tests",
            status: "passed",
            evidenceRefs: [{ algorithm: "sha256", digest: "self-output" }]
          }
        ],
        humanApprovals: []
      }
    };
    const rejected = await app.inject({
      method: "POST",
      url: "/api/records",
      payload: verification
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      invariant: "verification-independence"
    });
    const declaredSelfCheck = await app.inject({
      method: "POST",
      url: "/api/records",
      payload: {
        ...verification,
        id: "verification-declared-self-check",
        payload: { ...verification.payload, independent: false }
      }
    });
    expect(declaredSelfCheck.statusCode).toBe(201);
  });
});
