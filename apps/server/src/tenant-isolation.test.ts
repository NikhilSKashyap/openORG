import { afterEach, describe, expect, it } from "vitest";
import type { AccessPolicyManifest } from "@openorg/protocol";
import { MemoryStore } from "@openorg/store-memory";
import { createServer } from "./app.js";

const timestamp = "2026-07-13T13:00:00Z";
const aliceAuthorization = { authorization: "Bearer alice-secret" };
const malloryAuthorization = { authorization: "Bearer mallory-secret" };
const apps = new Set<ReturnType<typeof createServer>>();

afterEach(async () => Promise.all([...apps].map(async (app) => app.close())));

const policy: AccessPolicyManifest = {
  contract: "openorg.access-policy",
  contractVersion: "1.0.0",
  id: "policy-tenant-isolation",
  version: "1",
  organizationId: "*",
  defaultEffect: "deny",
  createdAt: timestamp,
  rules: [
    {
      id: "tenant-operators",
      effect: "allow",
      actions: ["record.read", "record.write", "lineage.read", "export.rag"],
      principalIds: ["alice", "mallory"],
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
        permissions: ["tenant:read"]
      }
    },
    {
      token: "mallory-secret",
      principal: {
        identity: { kind: "human" as const, id: "mallory" },
        organizationId: "globex",
        permissions: ["tenant:read"]
      }
    }
  ]
};

const acmeRecord = {
  contract: "openorg.org-record",
  contractVersion: "0.2.0",
  id: "signal-acme-private",
  version: "1",
  organizationId: "acme",
  workspaceId: "gtm",
  recordType: "signal",
  occurredAt: timestamp,
  recordedAt: timestamp,
  actor: { kind: "human", id: "alice" },
  subjectRefs: [{ type: "account", id: "acme-account" }],
  source: {
    system: "crm",
    externalId: "acme-private-signal",
    capturedAt: timestamp
  },
  access: {
    classification: "confidential",
    policyIds: [policy.id],
    permissions: ["tenant:read"]
  },
  payload: {
    title: "Acme private expansion plan",
    summary: "Acme plans to expand into a private regulated market.",
    severity: "high",
    status: "captured",
    sourceRefs: []
  }
};

describe("enforced tenant isolation", () => {
  it("never discloses or accepts Acme data through a Globex principal", async () => {
    const app = createServer(
      new MemoryStore(),
      undefined,
      {},
      {},
      { security }
    );
    apps.add(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/records",
      headers: aliceAuthorization,
      payload: acmeRecord
    });
    expect(created.statusCode).toBe(201);

    const aliceRead = await app.inject({
      method: "GET",
      url: `/api/records/${acmeRecord.id}`,
      headers: aliceAuthorization
    });
    expect(aliceRead.statusCode).toBe(200);
    expect(aliceRead.json()).toMatchObject({
      id: acmeRecord.id,
      organizationId: "acme"
    });

    const malloryList = await app.inject({
      method: "GET",
      url: "/api/records",
      headers: malloryAuthorization
    });
    expect(malloryList.statusCode).toBe(200);
    expect(malloryList.json()).toEqual([]);

    const malloryRead = await app.inject({
      method: "GET",
      url: `/api/records/${acmeRecord.id}`,
      headers: malloryAuthorization
    });
    expect(malloryRead.statusCode).toBe(404);
    expect(malloryRead.json()).toMatchObject({ error: "record not found" });
    expect(malloryRead.body).not.toContain(acmeRecord.payload.title);

    const crossTenantWrite = await app.inject({
      method: "POST",
      url: "/api/records",
      headers: malloryAuthorization,
      payload: {
        ...acmeRecord,
        id: "signal-globex-writing-acme",
        actor: { kind: "human", id: "mallory" },
        source: {
          ...acmeRecord.source,
          externalId: "globex-writing-acme"
        }
      }
    });
    expect(crossTenantWrite.statusCode).toBe(403);
    expect(crossTenantWrite.json()).toMatchObject({
      invariant: "access-policy"
    });

    const malloryJourney = await app.inject({
      method: "GET",
      url: `/api/journey/${acmeRecord.id}`,
      headers: malloryAuthorization
    });
    expect(malloryJourney.statusCode).toBe(404);
    expect(malloryJourney.json()).toMatchObject({ error: "record not found" });
    expect(malloryJourney.body).not.toContain(acmeRecord.payload.title);

    const malloryExport = await app.inject({
      method: "POST",
      url: "/api/export/rag",
      headers: malloryAuthorization,
      payload: {
        purpose: "internal-retrieval",
        destination: { kind: "same_process", id: "globex-local-rag" }
      }
    });
    expect(malloryExport.statusCode).toBe(200);
    expect(malloryExport.body).not.toContain(acmeRecord.id);
    expect(malloryExport.body).not.toContain(acmeRecord.payload.title);
    expect(malloryExport.body).not.toContain(acmeRecord.payload.summary);
  });
});
