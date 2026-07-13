import { createHash, createHmac } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@openorg/store-memory";
import { createServer } from "./app.js";

const servers: { close(): Promise<unknown> }[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((app) => app.close())));
const post = async <T extends Record<string, unknown>>(
  url: string,
  body: unknown
): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
};
const content = (value: string) => ({
  algorithm: "sha256" as const,
  digest: createHash("sha256").update(value).digest("hex"),
  mediaType: "text/plain"
});
const record = (
  id: string,
  workspace: string,
  _kind: string,
  title: string,
  context: string,
  at: string
) => ({
  contract: "openorg.work-record",
  contractVersion: "1.0.0",
  id,
  version: "1",
  workspace,
  recordedAt: at,
  actor: { kind: "human", id: `${workspace}-user` },
  action: title,
  decisionRef: { id: context, version: "1" },
  components: [],
  contextRef: { id: context, version: "1" },
  changes: [],
  artifacts: [],
  provenance: { source: `open${workspace}`, capturedAt: at }
});
const edge = (id: string, from: string, to: string, at: string) => ({
  contract: "openorg.lineage-assertion",
  contractVersion: "1.0.0",
  id,
  from: { id: from, version: "1" },
  to: { id: to, version: "1" },
  relationship: "related_to",
  basis: "asserted",
  state: "confirmed",
  authority: { kind: "human", id: "flow-user" },
  evidenceRefs: [content(id)],
  assertedAt: at
});

describe("golden cross-role flow", () => {
  it("crosses all four real HTTP services and produces a complete journey", async () => {
    const runtime = createServer(new MemoryStore());
    servers.push(runtime);
    const runtimeAddress = await runtime.listen({ host: "127.0.0.1", port: 0 });
    const gtm = Fastify();
    gtm.post("/api/signals", async (request) => {
      const body = request.body as { summary: string };
      const at = new Date().toISOString();
      const id = `signal-${crypto.randomUUID()}`;
      const unsigned = record(id, "gtm", "signal", body.summary, id, at);
      const signed = {
        ...unsigned,
        signature: {
          algorithm: "hmac-sha256",
          keyId: "gtm-test",
          value: createHmac("sha256", "test-key")
            .update(JSON.stringify(unsigned))
            .digest("hex")
        }
      };
      return post(`${runtimeAddress}/api/records`, signed);
    });
    servers.push(gtm);
    const gtmAddress = await gtm.listen({ host: "127.0.0.1", port: 0 });
    const pm = Fastify();
    pm.post("/api/initiatives", async (request) => {
      const body = request.body as { goal: string; signalRefs: string[] };
      const signalRef = body.signalRefs[0];
      if (!signalRef) throw new Error("initiative requires a signal reference");
      const at = new Date().toISOString();
      const id = `initiative-${crypto.randomUUID()}`;
      const value = record(id, "pm", "initiative", body.goal, signalRef, at);
      await post(`${runtimeAddress}/api/records`, value);
      await post(
        `${runtimeAddress}/api/lineage`,
        edge(`edge-${id}`, signalRef, id, at)
      );
      return value;
    });
    servers.push(pm);
    const pmAddress = await pm.listen({ host: "127.0.0.1", port: 0 });
    const swe = Fastify();
    swe.post("/api/work", async (request) => {
      const body = request.body as { title: string; initiativeRef: string };
      const at = new Date().toISOString();
      const id = `work-${crypto.randomUUID()}`;
      const value = record(
        id,
        "swe",
        "change",
        body.title,
        body.initiativeRef,
        at
      );
      await post(`${runtimeAddress}/api/records`, value);
      await post(
        `${runtimeAddress}/api/lineage`,
        edge(`edge-${id}`, body.initiativeRef, id, at)
      );
      return value;
    });
    swe.post<{ Params: { id: string; kind: string } }>(
      "/api/work/:id/:kind",
      async (request) => {
        const at = new Date().toISOString();
        if (request.params.kind === "verify") {
          const evidence = content("pnpm test passed");
          const receipt = {
            contract: "openorg.verification-receipt",
            contractVersion: "1.0.0",
            id: `receipt-${crypto.randomUUID()}`,
            workspace: "swe",
            subject: { id: request.params.id, version: "1" },
            actor: { kind: "human", id: "swe-user" },
            policyRef: "verified_receipt",
            requiredCheckIds: ["repo-test"],
            verdicts: [
              {
                checkId: "repo-test",
                status: "passed",
                verifier: {
                  kind: "service",
                  id: "local-harness",
                  version: "1"
                },
                evidenceRefs: [evidence],
                selfVerification: false
              }
            ],
            humanApprovals: [],
            rejectedAlternatives: [],
            measuredOutcomes: [],
            recordedAt: at
          };
          await post(`${runtimeAddress}/api/records`, receipt);
          await post(
            `${runtimeAddress}/api/lineage`,
            edge(`edge-${receipt.id}`, request.params.id, receipt.id, at)
          );
          return receipt;
        }
        const kind = request.params.kind === "actions" ? "action" : "artifact";
        const id = `${kind}-${crypto.randomUUID()}`;
        const value = record(id, "swe", kind, kind, request.params.id, at);
        await post(`${runtimeAddress}/api/records`, value);
        await post(
          `${runtimeAddress}/api/lineage`,
          edge(`edge-${id}`, request.params.id, id, at)
        );
        return value;
      }
    );
    servers.push(swe);
    const sweAddress = await swe.listen({ host: "127.0.0.1", port: 0 });

    const signal = await post<{ id: string; signature: unknown }>(
      `${gtmAddress}/api/signals`,
      { summary: "signal" }
    );
    expect(signal.signature).toBeTruthy();
    const initiative = await post<{ id: string }>(
      `${pmAddress}/api/initiatives`,
      {
        goal: "initiative",
        signalRefs: [signal.id]
      }
    );
    const work = await post<{ id: string }>(`${sweAddress}/api/work`, {
      title: "change",
      initiativeRef: initiative.id
    });
    await post(`${sweAddress}/api/work/${work.id}/actions`, {});
    await post(`${sweAddress}/api/work/${work.id}/artifacts`, {});
    await post(`${sweAddress}/api/work/${work.id}/verify`, {});
    const [gtmRecords, pmRecords, sweRecords] = await Promise.all([
      fetch(`${runtimeAddress}/api/records?workspace=gtm&kind=signal`).then(
        (response) => response.json() as Promise<{ id: string }[]>
      ),
      fetch(`${runtimeAddress}/api/records?workspace=pm&kind=initiative`).then(
        (response) => response.json() as Promise<{ id: string }[]>
      ),
      fetch(`${runtimeAddress}/api/records?workspace=swe&kind=work`).then(
        (response) => response.json() as Promise<{ id: string }[]>
      )
    ]);
    expect(gtmRecords.map(({ id }) => id)).toEqual([signal.id]);
    expect(pmRecords.map(({ id }) => id)).toEqual([initiative.id]);
    expect(sweRecords.map(({ id }) => id)).toEqual([work.id]);
    const journey = await fetch(
      `${runtimeAddress}/api/journey/${signal.id}`
    ).then(
      (response) =>
        response.json() as Promise<{
          stages: { record: { action?: string; contract: string } }[];
        }>
    );
    expect(journey.stages.map((stage) => stage.record.action)).toEqual([
      "signal",
      "initiative",
      "change",
      "action",
      "artifact",
      undefined
    ]);
  });
});
