import Fastify, { type FastifyInstance } from "fastify";
import {
  CapabilityManifestSchema,
  ContextEnvelopeSchema,
  DatasetManifestSchema,
  LineageAssertionSchema,
  OrgRecordSchema,
  TrainingRecordSchema,
  VerificationReceiptSchema,
  WorkRecordSchema,
  checkCorrectionPreference,
  checkLineageConfirmation,
  checkProvenance,
  checkSelfVerification,
  checkVerdictEvidence,
  checkVerificationOutcomeSeparation,
  type CapabilityManifest,
  type LineageAssertion,
  type OrgRecord
} from "@openorg/protocol";
import type { OpenorgRecord, RecordQuery, Store } from "@openorg/sdk";
import { SkillSpine, type SkillSpineOptions } from "@openorg/skill-spine";

const recordSchemas = {
  "openorg.capability-manifest": CapabilityManifestSchema,
  "openorg.context-envelope": ContextEnvelopeSchema,
  "openorg.dataset-manifest": DatasetManifestSchema,
  "openorg.lineage-assertion": LineageAssertionSchema,
  "openorg.org-record": OrgRecordSchema,
  "openorg.training-record": TrainingRecordSchema,
  "openorg.verification-receipt": VerificationReceiptSchema,
  "openorg.work-record": WorkRecordSchema
} as const;
type EventSink = (data: string) => void;
type ProviderHealthCheck = () => Promise<{
  healthy: boolean;
  checkedAt: string;
  evidenceRef?: CapabilityManifest["evidenceRef"];
  detail?: string;
}>;
const isOrgRecord = (record: OpenorgRecord | undefined): record is OrgRecord =>
  record?.contract === "openorg.org-record" && "recordType" in record;

export function isSftEligible(
  record: OrgRecord,
  trace: readonly OpenorgRecord[]
): record is Extract<OrgRecord, { recordType: "work" }> {
  return (
    record.recordType === "work" &&
    record.payload.workType === "task" &&
    record.payload.status === "completed" &&
    trace.some((related) => {
      if (isOrgRecord(related))
        return (
          related.recordType === "verification" &&
          related.payload.verdict === "passed"
        );
      const receipt = related as OpenorgRecord & {
        verdicts?: { status?: string }[];
      };
      return (
        receipt.contract === "openorg.verification-receipt" &&
        Array.isArray(receipt.verdicts) &&
        receipt.verdicts.length > 0 &&
        receipt.verdicts.every((verdict) => verdict.status === "passed")
      );
    })
  );
}
const policyRules = () =>
  new Set(
    (process.env.OPENORG_POLICY_RULE_IDS ?? "").split(",").filter(Boolean)
  );

function lawError(
  name: string,
  reasons: string[]
): Error & { statusCode: number; invariant: string } {
  return Object.assign(new Error(`${name}: ${reasons.join("; ")}`), {
    statusCode: 422,
    invariant: name
  });
}
function enforceRecord(record: OpenorgRecord) {
  if (record.contract === "openorg.work-record") {
    const result = checkProvenance(record as never);
    if (!result.valid) throw lawError("provenance", result.reasons);
  }
  if (record.contract === "openorg.verification-receipt") {
    for (const [name, check] of [
      ["verdict-evidence", checkVerdictEvidence],
      ["self-verification", checkSelfVerification],
      ["verification-outcome-separation", checkVerificationOutcomeSeparation]
    ] as const) {
      const result = check(record as never);
      if (!result.valid) throw lawError(name, result.reasons);
    }
  }
}
function enforceLineage(value: LineageAssertion) {
  for (const [name, result] of [
    ["lineage-confirmation", checkLineageConfirmation(value, policyRules())],
    ["correction-preference", checkCorrectionPreference(value)]
  ] as const)
    if (!result.valid) throw lawError(name, result.reasons);
}
function preflightLaw(raw: Record<string, unknown>) {
  if (
    (raw.contract === "openorg.work-record" ||
      raw.contract === "openorg.verification-receipt") &&
    (typeof raw.workspace !== "string" || raw.workspace.length === 0)
  )
    throw Object.assign(new Error("workspace is required on role records"), {
      statusCode: 400,
      invariant: "workspace-routing"
    });
  if (
    raw.contract === "openorg.work-record" &&
    (!raw.provenance || typeof raw.provenance !== "object")
  )
    throw lawError("provenance", ["provenance is required"]);
  if (raw.contract === "openorg.verification-receipt") {
    const verdicts = Array.isArray(raw.verdicts)
      ? (raw.verdicts as {
          verifier?: { id?: string };
          evidenceRefs?: unknown[];
          selfVerification?: boolean;
        }[])
      : [];
    if (
      verdicts.some(
        (value) => !value.verifier?.id || !value.evidenceRefs?.length
      )
    )
      throw lawError("verdict-evidence", [
        "every verdict requires verifier identity and evidence"
      ]);
    const actor = raw.actor as { id?: string } | undefined;
    if (
      verdicts.some(
        (value) =>
          value.verifier?.id === actor?.id && value.selfVerification !== true
      )
    )
      throw lawError("self-verification", [
        "actor verification must declare selfVerification"
      ]);
  }
  if (raw.contract === "openorg.lineage-assertion") {
    if (
      raw.state === "confirmed" &&
      (!raw.authority ||
        !Array.isArray(raw.evidenceRefs) ||
        raw.evidenceRefs.length === 0)
    )
      throw lawError("lineage-confirmation", [
        "confirmed lineage requires authority and evidence"
      ]);
    const correction = raw.correction as
      | {
          original?: { id?: string; version?: string };
          corrected?: { id?: string; version?: string };
        }
      | undefined;
    if (
      correction?.original &&
      correction.corrected &&
      correction.original.id === correction.corrected.id &&
      correction.original.version === correction.corrected.version
    )
      throw lawError("correction-preference", [
        "correction must link distinct original and corrected versions"
      ]);
  }
}

export function createServer(
  store: Store,
  eventSink?: EventSink,
  skillOptions: Omit<SkillSpineOptions, "store"> = {},
  providerHealthChecks: Record<string, ProviderHealthCheck> = {}
): FastifyInstance {
  const app = Fastify({ logger: false });
  const sinks = new Set<EventSink>();
  const providers = new Map<string, CapabilityManifest>();
  const skills = new SkillSpine({ ...skillOptions, store });
  if (eventSink) sinks.add(eventSink);
  const broadcast = (type: string, value: unknown) => {
    const frame = `data: ${JSON.stringify({ type, value })}\n\n`;
    for (const sink of sinks) sink(frame);
  };
  app.setErrorHandler((error, _request, reply) => {
    const value = error as Error & { statusCode?: number; invariant?: string };
    reply
      .status(value.statusCode ?? 500)
      .send({ error: value.message, invariant: value.invariant });
  });
  app.get("/", async (_request, reply) =>
    reply.type("text/html").send(homePage())
  );
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get<{ Params: { signalId: string } }>(
    "/journey/:signalId",
    async (request, reply) =>
      reply.type("text/html").send(journeyPage(request.params.signalId))
  );

  app.post("/api/records", async (request, reply) => {
    const raw = request.body as { contract?: string };
    const schema = raw?.contract
      ? recordSchemas[raw.contract as keyof typeof recordSchemas]
      : undefined;
    if (!schema)
      return reply.status(400).send({ error: "unknown record kind" });
    preflightLaw(raw as Record<string, unknown>);
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: "protocol-validation", issues: parsed.error.issues });
    const record = parsed.data as OpenorgRecord;
    enforceRecord(record);
    try {
      await store.append(record);
    } catch (error) {
      return reply.status(409).send({ error: (error as Error).message });
    }
    broadcast("record.accepted", record);
    return reply.status(201).send(record);
  });
  app.get("/api/records", async (request) =>
    store.query(request.query as RecordQuery)
  );
  app.get<{ Params: { id: string } }>(
    "/api/records/:id",
    async (request, reply) => {
      const value = await store.get(request.params.id);
      return value ?? reply.status(404).send({ error: "record not found" });
    }
  );
  app.post("/api/lineage", async (request, reply) => {
    preflightLaw(request.body as Record<string, unknown>);
    const parsed = LineageAssertionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: "protocol-validation", issues: parsed.error.issues });
    enforceLineage(parsed.data);
    try {
      await store.appendLineage(parsed.data);
    } catch (error) {
      return reply.status(409).send({ error: (error as Error).message });
    }
    broadcast("lineage.accepted", parsed.data);
    return reply.status(201).send(parsed.data);
  });
  app.post<{ Params: { id: string } }>(
    "/api/lineage/:id/judge",
    async (request, reply) => {
      const current = await store.getLineage(request.params.id);
      if (!current)
        return reply.status(404).send({ error: "lineage not found" });
      const body = request.body as Partial<LineageAssertion>;
      const candidate = LineageAssertionSchema.safeParse({
        ...current,
        state: body.state,
        authority: body.authority,
        evidenceRefs: body.evidenceRefs ?? current.evidenceRefs
      });
      if (!candidate.success)
        return reply.status(422).send({
          error: "lineage-confirmation",
          invariant: "lineage-confirmation",
          issues: candidate.error.issues
        });
      enforceLineage(candidate.data);
      await store.updateLineage(candidate.data);
      broadcast("lineage.judged", candidate.data);
      return candidate.data;
    }
  );
  app.post("/api/skills/import", async (request, reply) =>
    reply
      .status(201)
      .send(
        await skills.importSkillDraft(
          (request.body as { source: string }).source
        )
      )
  );
  app.post("/api/skills/draft", async (request, reply) => {
    const body = request.body as { content: string; harnessId: string };
    return reply
      .status(201)
      .send(await skills.draftSkill(body.content, body.harnessId));
  });
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/approve",
    async (request, reply) =>
      reply
        .status(201)
        .send(await skills.approve(request.params.id, request.body))
  );
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/install",
    async (request, reply) =>
      reply.status(201).send(await skills.install(request.params.id))
  );
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/invoke",
    async (request, reply) =>
      reply
        .status(201)
        .send(await skills.invoke(request.params.id, request.body))
  );
  app.get<{ Params: { recordId: string } }>(
    "/api/lineage/trace/:recordId",
    async (request) => store.trace(request.params.recordId)
  );
  app.get<{ Params: { rootId: string } }>(
    "/api/journey/:rootId",
    async (request) => {
      const seen = new Set<string>();
      const queue = [request.params.rootId];
      const nodes: OpenorgRecord[] = [];
      const lineage: LineageAssertion[] = [];
      while (queue.length) {
        const id = queue.shift();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const trace = await store.trace(id);
        if (trace.record) nodes.push(trace.record);
        for (const edge of [...trace.incoming, ...trace.outgoing]) {
          if (!lineage.some((x) => x.id === edge.id)) lineage.push(edge);
          queue.push(edge.from.id, edge.to.id);
        }
      }
      return {
        rootId: request.params.rootId,
        stages: nodes.map((record) => ({
          record,
          incoming: lineage.filter((x) => x.to.id === record.id),
          outgoing: lineage.filter((x) => x.from.id === record.id)
        }))
      };
    }
  );
  app.get("/api/events/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    reply.raw.write(": connected\n\n");
    const sink = (data: string) => reply.raw.write(data);
    sinks.add(sink);
    request.raw.on("close", () => sinks.delete(sink));
  });
  app.get("/api/providers", async () => [...providers.values()]);
  app.post("/api/providers", async (request, reply) => {
    const parsed = CapabilityManifestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: "protocol-validation", issues: parsed.error.issues });
    if (parsed.data.status === "healthy")
      return reply.status(422).send({
        error: "healthy status requires a runtime check",
        invariant: "honest-provider-status"
      });
    providers.set(parsed.data.id, parsed.data);
    return reply.status(201).send(parsed.data);
  });
  app.post<{ Params: { id: string } }>(
    "/api/providers/:id/check",
    async (request, reply) => {
      const current = providers.get(request.params.id);
      if (!current)
        return reply.status(404).send({ error: "provider not found" });
      const check = providerHealthChecks[current.id];
      if (!check)
        return reply.status(422).send({
          error: "provider has no runtime health check",
          invariant: "honest-provider-status",
          providerId: current.id
        });
      const result = await check();
      if (!result.healthy || !result.evidenceRef)
        return reply.status(503).send({
          error: result.detail ?? "provider health check failed",
          invariant: "honest-provider-status",
          providerId: current.id,
          checkedAt: result.checkedAt
        });
      const next = CapabilityManifestSchema.parse({
        ...current,
        status: "healthy",
        lastVerifiedAt: result.checkedAt,
        evidenceRef: result.evidenceRef
      });
      providers.set(next.id, next);
      broadcast("provider.checked", next);
      return next;
    }
  );
  app.get<{ Params: { shape: string } }>(
    "/api/export/:shape",
    async (request, reply) => {
      const all = await store.query();
      const records = all.filter((record): record is OrgRecord =>
        isOrgRecord(record)
      );

      const byId = new Map(all.map((record) => [record.id, record]));
      const resolvedPayload = (record: OpenorgRecord | undefined) =>
        record?.contract === "openorg.org-record"
          ? JSON.stringify((record as OrgRecord).payload)
          : undefined;
      const relatedRecords = async (record: OrgRecord) => {
        const trace = await store.trace(record.id);
        return [...trace.incoming, ...trace.outgoing].flatMap((edge) => {
          const otherId =
            edge.from.id === record.id ? edge.to.id : edge.from.id;
          const other = byId.get(otherId);
          return other ? [other] : [];
        });
      };

      let lines: unknown[];
      if (request.params.shape === "rag") {
        lines = records.map((record) => ({
          id: record.id,
          text: resolvedPayload(record),
          metadata: {
            recordType: record.recordType,
            organizationId: record.organizationId,
            workspaceId: record.workspaceId,
            sourceSystem: record.source.system,
            sourceUri: record.source.uri,
            classification: record.access.classification,
            occurredAt: record.occurredAt
          }
        }));
      } else if (request.params.shape === "sft") {
        const accepted: unknown[] = [];
        for (const record of records) {
          const related = await relatedRecords(record);
          if (!isSftEligible(record, related)) continue;
          const trace = await store.trace(record.id);
          const contextIds = new Set([
            ...trace.incoming.map((edge) => edge.from.id),
            ...record.payload.contextRefs.map((ref) => ref.id),
            ...record.payload.decisionRefs.map((ref) => ref.id)
          ]);
          const context = [...contextIds]
            .map((id) => byId.get(id))
            .filter((value): value is OrgRecord => isOrgRecord(value))
            .map((value) => resolvedPayload(value));
          accepted.push({
            messages: [
              {
                role: "system",
                content: "Use only the cited organizational context."
              },
              { role: "user", content: JSON.stringify(context) },
              { role: "assistant", content: resolvedPayload(record) }
            ],
            metadata: { recordId: record.id, verified: true }
          });
        }
        lines = accepted;
      } else if (request.params.shape === "preference") {
        lines = records
          .filter((record) => record.recordType === "correction")
          .map((record) => ({
            prompt: record.payload.reason,
            chosen:
              record.payload.preferredContent ??
              resolvedPayload(byId.get(record.payload.correctedRef.id)),
            rejected:
              record.payload.rejectedContent ??
              resolvedPayload(byId.get(record.payload.originalRef.id)),
            metadata: { correctionId: record.id }
          }));
      } else {
        return reply.status(404).send({ error: "unknown export shape" });
      }
      return reply
        .header("x-openorg-resolved-content", "true")
        .type("application/x-ndjson")
        .send(lines.map((line) => JSON.stringify(line)).join("\n"));
    }
  );
  return app;
}

const shell = (title: string, body: string, script = "") => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#17212b;background:#f5f7f8}body{margin:0}header{padding:20px 6vw;background:#152b35;color:white;display:flex;justify-content:space-between}main{max-width:1050px;margin:40px auto;padding:0 24px}.eyebrow{text-transform:uppercase;letter-spacing:.12em;color:#52717d;font-size:12px}.card,.stage{background:white;border:1px solid #dbe3e6;border-radius:12px;padding:20px;margin:12px 0;box-shadow:0 4px 20px #17313b0d}a{color:#087d8b}.chain{display:grid;gap:12px}.stage small{color:#55717c}.state{display:inline-block;padding:3px 8px;border-radius:999px;background:#e7f5ef;color:#176443;margin-left:8px}.empty{color:#61747c}</style></head>
<body><header><strong>openorg</strong><nav>Current work · Journey</nav></header><main>${body}</main><script>${script}</script></body></html>`;

function homePage() {
  return shell(
    "openorg — Current work",
    `<p class="eyebrow">Current work first</p><h1>Organization journeys</h1><p>Trace decisions and delivery evidence from their originating signal.</p><section id="work" class="card"><p class="empty">Loading current signals…</p></section>`,
    `
const work=document.querySelector('#work');
const title=r=>r.payload?.title||r.payload?.summary||r.action||r.id;
async function load(){const rows=await fetch('/api/records?kind=signal').then(r=>r.json()),signals=rows.filter(r=>r.recordType==='signal'||r.provenance?.source==='openGTM');work.innerHTML=signals.length?signals.map(r=>'<p><a href="/journey/'+encodeURIComponent(r.id)+'">'+title(r)+'</a> <small>'+r.id+'</small></p>').join(''):'<p class="empty">No current signals yet.</p>'}load();
new EventSource('/api/events/stream').onmessage=load;`
  );
}

function journeyPage(signalId: string) {
  return shell(
    "openorg — Journey",
    `<p class="eyebrow">Journey</p><h1>Signal to evidence</h1><p><a href="/">← Current work</a></p><section id="journey" class="chain"><p class="empty">Loading journey…</p></section>`,
    `
const root=${JSON.stringify(signalId)}, el=document.querySelector('#journey');
const esc=v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const title=r=>r.payload?.title||r.payload?.summary||r.action||r.id;
const detail=r=>r.payload?.summary||r.payload?.rationale||r.payload?.intent||r.payload?.description||'';
async function load(){const j=await fetch('/api/journey/'+encodeURIComponent(root)).then(r=>r.json());el.innerHTML=j.stages.length?j.stages.map(s=>{const r=s.record,edges=[...s.incoming,...s.outgoing],states=[...new Set(edges.map(e=>e.state))];return '<article class="stage"><small>'+esc(r.recordType||r.contract)+'</small><h2>'+esc(title(r))+'</h2><p>'+esc(detail(r))+'</p><code>'+esc(r.id)+'</code>'+states.map(x=>'<span class="state">'+esc(x)+'</span>').join('')+'</article>'}).join(''):'<p class="empty">No journey records found.</p>'}load();
new EventSource('/api/events/stream').onmessage=load;`
  );
}
