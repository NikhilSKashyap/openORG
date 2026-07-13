import { afterEach, describe, expect, it } from "vitest";
import type { OpenorgRecord } from "@openorg/sdk";
import { MemoryStore } from "@openorg/store-memory";
import { createServer } from "./app.js";

const timestamp = "2026-07-12T10:00:00Z";
const apps = new Set<ReturnType<typeof createServer>>();
afterEach(async () => Promise.all([...apps].map(async (app) => app.close())));
const makeApp = () => {
  const app = createServer(new MemoryStore());
  apps.add(app);
  return app;
};
const record = {
  contract: "openorg.work-record",
  contractVersion: "1.0.0",
  id: "work-1",
  version: "1",
  workspace: "swe",
  recordedAt: timestamp,
  actor: { kind: "agent", id: "agent-1" },
  action: "act",
  decisionRef: { id: "decision-1", version: "1" },
  components: [],
  contextRef: { id: "context-1", version: "1" },
  changes: [],
  artifacts: [],
  provenance: { source: "runtime", capturedAt: timestamp }
};
const signalRecord = {
  contract: "openorg.org-record",
  contractVersion: "0.2.0",
  id: "signal-1",
  version: "1",
  organizationId: "acme",
  workspaceId: "gtm",
  recordType: "signal",
  occurredAt: timestamp,
  recordedAt: timestamp,
  actor: { kind: "human", id: "gtm-user" },
  subjectRefs: [{ type: "account", id: "account-1" }],
  source: {
    system: "salesforce",
    externalId: "call-1",
    capturedAt: timestamp
  },
  access: {
    classification: "confidential",
    policyIds: ["customer-data"],
    permissions: ["account:read"]
  },
  payload: {
    title: "Operators need routing explanations",
    summary: "The customer needs cited reasons for every automated route.",
    exactQuote: "Show me why this ticket was routed.",
    severity: "high",
    status: "captured",
    desiredOutcome: "Every route includes a cited reason.",
    sourceRefs: []
  }
};

describe("runtime", () => {
  it("serves the documented health endpoint", async () => {
    const response = await makeApp().inject({
      method: "GET",
      url: "/api/health"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", securityMode: "local" });
  });
  it("accepts and returns a protocol record", async () => {
    const app = makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/records",
      payload: record
    });
    expect(created.statusCode).toBe(201);
    const fetched = await app.inject({
      method: "GET",
      url: "/api/records/work-1"
    });
    expect(fetched.json()).toEqual(record);
  });
  it("reads legacy learning contracts but writes the canonical OLP identity", async () => {
    const store = new MemoryStore();
    const app = createServer(store);
    apps.add(app);
    const legacySuite = {
      contract: "openorg.evaluation-suite",
      contractVersion: "1.0.0",
      id: "legacy-suite",
      version: "4",
      organizationId: "acme",
      workspaceId: "swe",
      title: "Legacy private eval",
      createdAt: timestamp,
      createdBy: { kind: "human", id: "owner" },
      cases: [
        {
          id: "case-legacy",
          kind: "model_output",
          input: "route this ticket",
          expectedOutput: "support",
          sourceRefs: [{ id: "correction-legacy", version: "2" }],
          permissions: []
        }
      ]
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/records",
      payload: legacySuite
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      contract: "olp.evaluation-suite",
      contractVersion: "0.1.0",
      id: legacySuite.id,
      version: legacySuite.version
    });
    const fetched = await app.inject({
      method: "GET",
      url: `/api/records/${legacySuite.id}`
    });
    expect(fetched.json()).toMatchObject({
      contract: "olp.evaluation-suite",
      contractVersion: "0.1.0",
      id: legacySuite.id,
      version: legacySuite.version
    });
    const storedLegacySuite = {
      ...legacySuite,
      id: "legacy-suite-already-stored",
      version: "2"
    };
    await store.append(storedLegacySuite as OpenorgRecord);
    const legacyFetched = await app.inject({
      method: "GET",
      url: `/api/records/${storedLegacySuite.id}`
    });
    expect(legacyFetched.json()).toMatchObject({
      contract: "olp.evaluation-suite",
      contractVersion: "0.1.0",
      id: storedLegacySuite.id,
      version: storedLegacySuite.version
    });
    const canonicalQuery = await app.inject({
      method: "GET",
      url: "/api/records?kind=olp.evaluation-suite"
    });
    expect(
      canonicalQuery
        .json<{ id: string; contract: string }[]>()
        .map(({ id, contract }) => ({ id, contract }))
    ).toEqual(
      expect.arrayContaining([
        { id: legacySuite.id, contract: "olp.evaluation-suite" },
        { id: storedLegacySuite.id, contract: "olp.evaluation-suite" }
      ])
    );
  });
  it("preserves semantic role content and exports resolved RAG text", async () => {
    const app = makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/records",
      payload: signalRecord
    });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({
      method: "GET",
      url: "/api/records?workspace=gtm&kind=signal"
    });
    expect(listed.json()).toEqual([signalRecord]);
    const exported = await app.inject({
      method: "GET",
      url: "/api/export/rag"
    });
    expect(exported.headers["x-openorg-resolved-content"]).toBe("true");
    const row = JSON.parse(exported.body) as { text: string };
    expect(row.text).toContain("cited reasons");
    expect(row.text).not.toBe(
      JSON.stringify({ id: signalRecord.id, version: "1" })
    );
  });
  it("exports only completed task work with passing verification", async () => {
    const app = makeApp();
    const common = {
      contract: "openorg.org-record",
      contractVersion: "0.2.0",
      organizationId: "acme",
      workspaceId: "fde",
      occurredAt: timestamp,
      recordedAt: timestamp,
      subjectRefs: [{ type: "initiative", id: "decision-1" }],
      access: {
        classification: "internal",
        policyIds: [],
        permissions: []
      }
    };
    const work = {
      ...common,
      id: "semantic-work-1",
      version: "1",
      recordType: "work",
      actor: { kind: "agent", id: "builder", version: "1" },
      source: {
        system: "harness",
        externalId: "run-1",
        capturedAt: timestamp
      },
      payload: {
        title: "Build the approved change",
        intent: "Implement the approved customer outcome",
        workType: "task",
        status: "in_progress",
        stage: "build",
        decisionRefs: [],
        contextRefs: [],
        components: [],
        changes: []
      }
    };
    const verification = {
      ...common,
      id: "semantic-verification-1",
      version: "1",
      recordType: "verification",
      actor: { kind: "service", id: "test-runner", version: "1" },
      source: {
        system: "test-runner",
        externalId: "check-1",
        capturedAt: timestamp
      },
      payload: {
        title: "Verify the approved change",
        policyRef: "test-policy",
        subjectRefs: [{ id: work.id, version: work.version }],
        verdict: "passed",
        independent: true,
        checks: [
          {
            id: "unit-tests",
            status: "passed",
            evidenceRefs: [{ algorithm: "sha256", digest: "test-output" }]
          }
        ],
        humanApprovals: []
      }
    };
    const unverified = {
      ...work,
      id: "semantic-work-unverified",
      payload: { ...work.payload, status: "completed" }
    };
    const legacy = {
      contract: "openorg.training-record",
      contractVersion: "1.0.0",
      id: "legacy-training-1",
      context: { id: "context-1", version: "1" },
      action: { id: "legacy-action-1", version: "1" },
      evidence: [],
      exportedAt: timestamp
    };
    for (const payload of [work, unverified, verification, legacy]) {
      expect(
        (await app.inject({ method: "POST", url: "/api/records", payload }))
          .statusCode
      ).toBe(201);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/lineage",
          payload: {
            contract: "openorg.lineage-assertion",
            contractVersion: "1.0.0",
            id: "verification-lineage-1",
            from: { id: verification.id, version: "1" },
            to: { id: work.id, version: "1" },
            relationship: "verifies",
            basis: "observed",
            state: "confirmed",
            authority: { kind: "service", id: "test-runner", version: "1" },
            evidenceRefs: [{ algorithm: "sha256", digest: "test-output" }],
            assertedAt: timestamp
          }
        })
      ).statusCode
    ).toBe(201);
    const beforeCompletion = await app.inject({
      method: "GET",
      url: "/api/export/sft"
    });
    expect(beforeCompletion.body).not.toContain(work.id);
    expect(beforeCompletion.body).not.toContain(unverified.id);
    expect(beforeCompletion.body).not.toContain(legacy.id);
    expect(beforeCompletion.body).toBe("");
    const completed = {
      ...work,
      version: "2",
      supersedes: { id: work.id, version: "1" },
      payload: { ...work.payload, status: "completed", stage: "verify" }
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: completed
        })
      ).statusCode
    ).toBe(201);
    const exported = await app.inject({
      method: "GET",
      url: "/api/export/sft"
    });
    expect(exported.body).toContain('"verified":true');
    expect(exported.body).toContain("Build the approved change");
    expect(exported.body).not.toContain(unverified.id);
    expect(exported.body).not.toContain(legacy.id);
  });
  it("appends new versions and rejects an existing id-version pair", async () => {
    const app = makeApp();
    const versionTwo = { ...record, version: "2", action: "attach artifact" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: record
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/records",
          payload: versionTwo
        })
      ).statusCode
    ).toBe(201);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/records",
      payload: versionTwo
    });
    expect(duplicate.statusCode).toBe(409);
    expect(
      (await app.inject({ method: "GET", url: "/api/records/work-1" })).json()
    ).toEqual(versionTwo);
    expect(
      (await app.inject({ method: "GET", url: "/api/records" })).json()
    ).toEqual([versionTwo]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/records?history=all"
        })
      ).json()
    ).toEqual([record, versionTwo]);
  });
  it("rejects work records without a workspace routing field", async () => {
    const missingWorkspace: Partial<typeof record> = { ...record };
    delete missingWorkspace.workspace;
    const response = await makeApp().inject({
      method: "POST",
      url: "/api/records",
      payload: missingWorkspace
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ invariant: "workspace-routing" });
  });
  it("names law failures", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: {
        contract: "openorg.capability-manifest",
        contractVersion: "1.0.0",
        id: "provider",
        version: "1",
        kind: "provider",
        capabilities: [],
        status: "healthy",
        lastVerifiedAt: timestamp,
        evidenceRef: { algorithm: "sha256", digest: "untrusted" }
      }
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      invariant: "honest-provider-status"
    });
  });
  it("does not fabricate provider health without a real checker", async () => {
    const app = makeApp();
    const registered = await app.inject({
      method: "POST",
      url: "/api/providers",
      payload: {
        contract: "openorg.capability-manifest",
        contractVersion: "1.0.0",
        id: "provider",
        version: "1",
        kind: "provider",
        capabilities: [],
        status: "configured"
      }
    });
    expect(registered.statusCode).toBe(201);
    const checked = await app.inject({
      method: "POST",
      url: "/api/providers/provider/check"
    });
    expect(checked.statusCode).toBe(422);
    expect(checked.json()).toMatchObject({
      invariant: "honest-provider-status"
    });
  });
  it("streams an accepted record over SSE", async () => {
    const events: string[] = [];
    const app = createServer(new MemoryStore(), (event) => events.push(event));
    apps.add(app);
    await app.inject({ method: "POST", url: "/api/records", payload: record });
    expect(events.join("")).toContain("record.accepted");
    expect(events.join("")).toContain("work-1");
  });
  it("exposes the human-gated skill extension flow", async () => {
    const app = makeApp();
    const drafted = await app.inject({
      method: "POST",
      url: "/api/skills/draft",
      payload: {
        content: "Summarize the supplied text.",
        harnessId: "draft-echo"
      }
    });
    expect(drafted.statusCode).toBe(201);
    const draftBody = drafted.json<{
      record: { id: string };
      hash: string;
    }>();
    const id = draftBody.record.id;
    expect(
      (await app.inject({ method: "POST", url: `/api/skills/${id}/install` }))
        .statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/skills/${id}/approve`,
          payload: { kind: "agent", id: "bot" }
        })
      ).statusCode
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/skills/${id}/approve`,
          payload: { kind: "human", id: "alice" }
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await app.inject({ method: "POST", url: `/api/skills/${id}/install` })
      ).json<{ status: string }>().status
    ).toBe("configured");
    const invoked = await app.inject({
      method: "POST",
      url: `/api/skills/${id}/invoke`,
      payload: { outcome: "ok" }
    });
    expect(invoked.statusCode).toBe(201);
    expect(
      invoked.json<{ components: { hash: string }[] }>().components[0]?.hash
    ).toBe(draftBody.hash);
  });
});
