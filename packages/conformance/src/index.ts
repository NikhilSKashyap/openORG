import type {
  LineageAssertion,
  OrgRecord,
  VerificationReceipt,
  WorkRecord
} from "@openorg/protocol";
import type { StoreProvider } from "@openorg/sdk";

export type ConformanceResult = { checks: string[] };
const equal = (
  actual: unknown,
  expected: unknown,
  name: string,
  checks: string[]
) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`conformance failed: ${name}`);
  checks.push(name);
};
export async function runConformance(
  provider: StoreProvider
): Promise<ConformanceResult> {
  const checks: string[] = [];
  const timestamp = "2026-07-12T10:00:00Z";
  const ref = { algorithm: "sha256" as const, digest: "evidence" };
  const work: WorkRecord = {
    contract: "openorg.work-record",
    contractVersion: "1.0.0",
    id: "work",
    version: "1",
    workspace: "runtime",
    recordedAt: timestamp,
    actor: { kind: "agent", id: "agent", version: "1" },
    action: "act",
    decisionRef: { id: "decision", version: "1" },
    components: [],
    contextRef: { id: "context", version: "1" },
    changes: [],
    artifacts: [ref],
    provenance: { source: "runtime", capturedAt: timestamp }
  };
  await provider.store.append(work);
  equal(
    await provider.store.get(work.id),
    work,
    "stable identity, timestamps, actor, provenance",
    checks
  );
  const signal: OrgRecord = {
    contract: "openorg.org-record",
    contractVersion: "0.2.0",
    id: "signal-seeded",
    version: "1",
    organizationId: "conformance-org",
    workspaceId: "gtm",
    recordType: "signal",
    occurredAt: timestamp,
    recordedAt: timestamp,
    actor: { kind: "human", id: "gtm-user" },
    subjectRefs: [{ type: "account", id: "account-1" }],
    source: {
      system: "crm",
      externalId: "interaction-1",
      capturedAt: timestamp
    },
    access: {
      classification: "confidential",
      policyIds: ["customer-data"],
      permissions: ["account:read"]
    },
    payload: {
      title: "Customer needs explainable automation",
      summary: "Operators need cited reasons before accepting automated work.",
      exactQuote: "Show me why the system did that.",
      severity: "high",
      status: "captured",
      desiredOutcome: "Every automated action has a cited reason.",
      sourceRefs: []
    }
  };
  await provider.store.append(signal);
  equal(
    await provider.store.query({ workspace: "gtm", kind: "signal" }),
    [signal],
    "canonical role records support workspace and kind queries",
    checks
  );
  equal(
    await provider.store.query({ organizationId: "conformance-org" }),
    [signal],
    "organization routing and semantic payload survive round trip",
    checks
  );
  const context = {
    contract: "openorg.context-envelope",
    contractVersion: "1.0.0",
    id: "context",
    createdAt: timestamp,
    sources: [
      {
        id: "source",
        type: "document",
        contentRef: ref,
        observedAt: timestamp,
        freshness: "fresh",
        permissions: ["read"],
        citations: [ref],
        redactions: [
          { path: "$.secret", withheldType: "secret", reason: "policy" }
        ]
      }
    ]
  } as const;
  await provider.store.append(context);
  equal(
    await provider.store.get(context.id),
    context,
    "source provenance, permissions, redactions",
    checks
  );
  const proposed: LineageAssertion = {
    contract: "openorg.lineage-assertion",
    contractVersion: "1.0.0",
    id: "edge",
    from: { id: "context", version: "1" },
    to: { id: "work", version: "1" },
    relationship: "derived_from",
    basis: "observed",
    state: "proposed",
    evidenceRefs: [],
    assertedAt: timestamp
  };
  await provider.store.appendLineage(proposed);
  equal(
    (await provider.store.trace("work")).incoming[0],
    proposed,
    "proposed lineage",
    checks
  );
  const confirmed: LineageAssertion = {
    ...proposed,
    state: "confirmed",
    authority: { kind: "human", id: "reviewer" },
    evidenceRefs: [ref]
  };
  await provider.store.updateLineage(confirmed);
  equal(
    (await provider.store.trace("work")).incoming[0],
    confirmed,
    "confirmed lineage authority and evidence",
    checks
  );
  const receipt: VerificationReceipt = {
    contract: "openorg.verification-receipt",
    contractVersion: "1.0.0",
    id: "receipt",
    workspace: "runtime",
    subject: { id: "work", version: "1" },
    actor: { kind: "agent", id: "agent" },
    policyRef: "policy",
    requiredCheckIds: ["test"],
    verdicts: [
      {
        checkId: "test",
        status: "passed",
        verifier: { kind: "service", id: "ci" },
        evidenceRefs: [ref],
        selfVerification: false
      }
    ],
    humanApprovals: [
      {
        gateId: "release",
        approver: { kind: "human", id: "reviewer" },
        approvedAt: timestamp
      }
    ],
    rejectedAlternatives: [],
    measuredOutcomes: [
      { metric: "latency", value: 1, unit: "ms", measuredAt: timestamp }
    ],
    recordedAt: timestamp
  };
  await provider.store.append(receipt);
  const storedReceipt = (await provider.store.get(
    receipt.id
  )) as VerificationReceipt;
  equal(
    storedReceipt.humanApprovals,
    receipt.humanApprovals,
    "human approvals",
    checks
  );
  equal(
    storedReceipt.verdicts,
    receipt.verdicts,
    "verification receipts",
    checks
  );
  equal(
    storedReceipt.measuredOutcomes,
    receipt.measuredOutcomes,
    "outcome settlement",
    checks
  );
  const corrected: WorkRecord = { ...work, version: "2", action: "corrected" };
  await provider.store.append(corrected);
  equal(
    await provider.store.get(work.id),
    corrected,
    "latest superseding version",
    checks
  );
  const history = (await provider.store.query({ history: "all" })).filter(
    (x) => x.id === work.id
  );
  equal(history.length, 2, "append-only history", checks);
  equal(
    history.map((x) => (x as WorkRecord).version),
    ["1", "2"],
    "corrections preserve preference pair versions",
    checks
  );
  return { checks };
}
