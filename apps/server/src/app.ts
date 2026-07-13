import { createHash, randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import {
  evaluateModel,
  promoteLearning,
  routeEvaluations,
  trainLocalLogisticRegression
} from "@openorg/learning";
import {
  AccessPolicyManifestSchema,
  CapabilityManifestSchema,
  ConsentGrantSchema,
  ContextEnvelopeSchema,
  DatasetManifestSchema,
  EgressReceiptSchema,
  EligibilityReceiptSchema,
  EvaluationReceiptSchema,
  EvaluationSuiteSchema,
  ExportRequestSchema,
  LineageAssertionSchema,
  LearningArtifactSchema,
  LearningProposalSchema,
  ModelArtifactSchema,
  ModelEvaluationSchema,
  OrgRecordSchema,
  PromotionReceiptSchema,
  ReusablePolicySchema,
  RoutingDecisionSchema,
  RoutingPolicySchema,
  TrainingJobSchema,
  TrainingRecordSchema,
  VerificationReceiptSchema,
  WorkRecordSchema,
  checkConsent,
  checkCorrectionPreference,
  checkEvaluationIndependence,
  checkLineageConfirmation,
  checkLearningEligibility,
  checkLearningPromotion,
  checkPromotionEvaluations,
  checkProvenance,
  checkSelfVerification,
  checkVerdictEvidence,
  checkVerificationOutcomeSeparation,
  canonicalOlpContract,
  matchesOlpContract,
  normalizeOlpRecord,
  type AuthenticatedPrincipal,
  type CapabilityManifest,
  type ConsentGrant,
  type DatasetManifest,
  type EvaluationSuite,
  type EligibilityReceipt,
  type ExportRequest,
  type LineageAssertion,
  type ModelEvaluation,
  type OrgRecord,
  type PromotionReceipt,
  type ReusablePolicy,
  type RoutingPolicy
} from "@openorg/protocol";
import type {
  ModelProvider,
  OpenorgRecord,
  RecordQuery,
  Store,
  TrainingAdapter
} from "@openorg/sdk";
import { SkillSpine, type SkillSpineOptions } from "@openorg/skill-spine";
import { buildGovernedExport, type ExportShape } from "./exports.js";
import { SecurityRuntime, type SecurityConfig } from "./security.js";

const recordSchemas = {
  "openorg.access-policy": AccessPolicyManifestSchema,
  "openorg.capability-manifest": CapabilityManifestSchema,
  "openorg.consent-grant": ConsentGrantSchema,
  "openorg.context-envelope": ContextEnvelopeSchema,
  "olp.dataset-manifest": DatasetManifestSchema,
  "openorg.egress-receipt": EgressReceiptSchema,
  "olp.eligibility-receipt": EligibilityReceiptSchema,
  "olp.evaluation-receipt": EvaluationReceiptSchema,
  "olp.evaluation-suite": EvaluationSuiteSchema,
  "olp.learning-artifact": LearningArtifactSchema,
  "olp.learning-proposal": LearningProposalSchema,
  "olp.model-artifact": ModelArtifactSchema,
  "olp.model-evaluation": ModelEvaluationSchema,
  "openorg.org-record": OrgRecordSchema,
  "olp.promotion-receipt": PromotionReceiptSchema,
  "olp.reusable-policy": ReusablePolicySchema,
  "olp.routing-decision": RoutingDecisionSchema,
  "olp.routing-policy": RoutingPolicySchema,
  "olp.training-job": TrainingJobSchema,
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
export type RuntimeOptions = {
  security?: SecurityConfig;
  modelProviders?: ModelProvider[];
  trainingAdapters?: TrainingAdapter[];
};
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
  providerHealthChecks: Record<string, ProviderHealthCheck> = {},
  runtimeOptions: RuntimeOptions = {}
): FastifyInstance {
  const app = Fastify({ logger: false });
  const sinks = new Set<EventSink>();
  const providers = new Map<string, CapabilityManifest>();
  const modelProviders = new Map(
    (runtimeOptions.modelProviders ?? []).map((provider) => [
      provider.manifest.id,
      provider
    ])
  );
  const trainingAdapters = new Map(
    (runtimeOptions.trainingAdapters ?? []).map((adapter) => [
      adapter.manifest.id,
      adapter
    ])
  );
  for (const provider of modelProviders.values())
    providers.set(provider.manifest.id, provider.manifest);
  for (const adapter of trainingAdapters.values())
    providers.set(adapter.manifest.id, adapter.manifest);
  const security = new SecurityRuntime(runtimeOptions.security);
  const principals = new WeakMap<FastifyRequest, AuthenticatedPrincipal>();
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
  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/") || request.url === "/api/health")
      return;
    principals.set(
      request,
      security.authenticate(request.headers.authorization)
    );
  });
  const principalFor = (request: FastifyRequest) => {
    const value = principals.get(request);
    if (!value)
      throw Object.assign(new Error("principal unavailable"), {
        statusCode: 401,
        invariant: "authentication"
      });
    return value;
  };
  const organizationFor = (principal: AuthenticatedPrincipal) =>
    principal.organizationId === "*" ? "local" : principal.organizationId;
  const authorize = (
    request: FastifyRequest,
    action: Parameters<SecurityRuntime["authorize"]>[1]["action"],
    values: Omit<
      Parameters<SecurityRuntime["authorize"]>[1],
      "action" | "organizationId"
    > & {
      organizationId?: string;
    } = {}
  ) => {
    const principal = principalFor(request);
    security.authorize(principal, {
      action,
      organizationId: values.organizationId ?? organizationFor(principal),
      ...values
    });
    return principal;
  };
  const scopedRecords = async (request: FastifyRequest) => {
    const principal = principalFor(request);
    const query =
      security.mode === "enforced"
        ? { organizationId: principal.organizationId }
        : undefined;
    return (await store.query(query)).filter((record) =>
      security.canRead(principal, record)
    );
  };
  const requireReadableRecord = async <T extends OpenorgRecord>(
    request: FastifyRequest,
    id: string,
    contract: string
  ): Promise<T> => {
    const principal = principalFor(request);
    const value = await store.get(id);
    if (
      !value ||
      !matchesOlpContract(value.contract, contract) ||
      !security.canRead(principal, value)
    )
      throw Object.assign(new Error(`${contract} record not found`), {
        statusCode: 404,
        invariant: "record-visibility"
      });
    return normalizeOlpRecord(
      value as OpenorgRecord & Record<string, unknown>
    ) as T;
  };
  const appendIfAbsent = async (record: OpenorgRecord) => {
    if (await store.get(record.id)) return false;
    await store.append(record);
    broadcast("record.accepted", record);
    return true;
  };
  const enforcePromotionRollback = async (
    request: FastifyRequest,
    receipt: PromotionReceipt
  ) => {
    if (!receipt.rollbackOf) return;
    const previous = PromotionReceiptSchema.parse(
      await requireReadableRecord(
        request,
        receipt.rollbackOf.id,
        "olp.promotion-receipt"
      )
    );
    const reasons: string[] = [];
    if (previous.version !== receipt.rollbackOf.version)
      reasons.push("rollback must bind the exact prior promotion version");
    if (previous.decision !== "approved")
      reasons.push("rollback must reverse an approved promotion");
    if (
      previous.artifactRef.id !== receipt.artifactRef.id ||
      previous.artifactRef.version !== receipt.artifactRef.version
    )
      reasons.push("rollback must reverse the same artifact version");
    if (
      previous.target.kind !== receipt.target.kind ||
      previous.target.id !== receipt.target.id
    )
      reasons.push("rollback must reverse the same promotion target");
    if (reasons.length > 0) throw lawError("learning-rollback", reasons);
  };
  const createPromotionReceipt = async (
    request: FastifyRequest,
    input: {
      artifactId: string;
      evaluationReceiptIds: string[];
      decision: PromotionReceipt["decision"];
      target: PromotionReceipt["target"];
      reasons: string[];
      rollbackOf?: PromotionReceipt["rollbackOf"];
    }
  ) => {
    const principal = principalFor(request);
    if (principal.identity.kind !== "human")
      throw Object.assign(
        new Error("only an authenticated human may promote learning"),
        { statusCode: 403, invariant: "learning-promotion" }
      );
    const artifact = LearningArtifactSchema.parse(
      await requireReadableRecord(
        request,
        input.artifactId,
        "olp.learning-artifact"
      )
    );
    authorize(request, "learning.promote", {
      organizationId: artifact.organizationId
    });
    const eligibility = EligibilityReceiptSchema.parse(
      await requireReadableRecord<EligibilityReceipt>(
        request,
        artifact.eligibilityRef.id,
        "olp.eligibility-receipt"
      )
    );
    const evaluations = await Promise.all(
      input.evaluationReceiptIds.map(async (id) =>
        EvaluationReceiptSchema.parse(
          await requireReadableRecord(request, id, "olp.evaluation-receipt")
        )
      )
    );
    if (
      evaluations.some(
        (evaluation) =>
          evaluation.artifactRef.id !== artifact.id ||
          evaluation.artifactRef.version !== artifact.version
      )
    )
      throw lawError("learning-promotion", [
        "evaluation receipts must judge the promoted artifact version"
      ]);
    const receipt = PromotionReceiptSchema.parse({
      contract: "olp.promotion-receipt",
      contractVersion: "0.1.0",
      id: `promotion-${randomUUID()}`,
      version: "1",
      organizationId: artifact.organizationId,
      proposalRef: artifact.proposalRef,
      eligibilityRef: artifact.eligibilityRef,
      artifactRef: { id: artifact.id, version: artifact.version },
      evaluationRefs: evaluations.map((evaluation) => ({
        id: evaluation.id,
        version: evaluation.version
      })),
      decision: input.decision,
      target: input.target,
      reasons: input.reasons,
      decidedBy: principal.identity,
      decidedAt: new Date().toISOString(),
      ...(input.rollbackOf ? { rollbackOf: input.rollbackOf } : {})
    });
    await enforcePromotionRollback(request, receipt);
    const result = checkLearningPromotion(receipt, eligibility, artifact);
    if (!result.valid) throw lawError("learning-promotion", result.reasons);
    const evaluationResult = checkPromotionEvaluations(receipt, evaluations);
    if (!evaluationResult.valid)
      throw lawError("learning-promotion", evaluationResult.reasons);
    await store.append(receipt);
    broadcast("learning.promoted", receipt);
    return receipt;
  };
  const enforceAuthenticatedAuthority = (
    principal: AuthenticatedPrincipal,
    assertion: LineageAssertion
  ) => {
    if (security.mode !== "enforced" || assertion.state !== "confirmed") return;
    const authority = assertion.authority;
    if (!authority) return;
    if (authority.kind === "policy") {
      if (!principal.permissions.includes(`policy:assert:${authority.ruleId}`))
        throw lawError("lineage-authority", [
          "policy confirmation requires its explicit assertion permission"
        ]);
      return;
    }
    if (
      authority.id !== principal.identity.id ||
      authority.kind !== principal.identity.kind
    )
      throw lawError("lineage-authority", [
        "lineage authority must match the authenticated principal"
      ]);
  };
  const enforceSemanticVerification = async (
    principal: AuthenticatedPrincipal,
    record: OrgRecord
  ) => {
    if (record.recordType !== "verification") return;
    const history = await store.query({ history: "all" });
    for (const subjectRef of record.payload.subjectRefs) {
      const subject = history.find(
        (value) =>
          value.id === subjectRef.id &&
          ((value as OpenorgRecord & { version?: string }).version ?? "1") ===
            subjectRef.version
      );
      if (!subject)
        throw lawError("verification-referential-integrity", [
          `verification subject not found: ${subjectRef.id}@${subjectRef.version}`
        ]);
      if (!security.canRead(principal, subject))
        throw Object.assign(new Error("verification subject not found"), {
          statusCode: 404,
          invariant: "record-visibility"
        });
      const subjectOrganization = (
        subject as OpenorgRecord & { organizationId?: string }
      ).organizationId;
      if (subjectOrganization && subjectOrganization !== record.organizationId)
        throw lawError("organization-boundary", [
          "verification cannot cross organization boundaries"
        ]);
      const subjectActor = (
        subject as OpenorgRecord & { actor?: { kind?: string; id?: string } }
      ).actor;
      if (
        record.payload.independent &&
        subjectActor?.id === record.actor.id &&
        subjectActor.kind === record.actor.kind
      )
        throw lawError("verification-independence", [
          "a subject's actor cannot independently verify its own work"
        ]);
    }
  };
  app.get("/", async (_request, reply) =>
    reply.type("text/html").send(homePage())
  );
  app.get("/api/health", async () => ({
    status: "ok",
    securityMode: security.mode
  }));
  app.get<{ Params: { signalId: string } }>(
    "/journey/:signalId",
    async (request, reply) =>
      reply.type("text/html").send(journeyPage(request.params.signalId))
  );

  app.post("/api/records", async (request, reply) => {
    const raw = request.body as Record<string, unknown>;
    const canonical = normalizeOlpRecord(raw);
    const schema =
      typeof canonical.contract === "string"
        ? recordSchemas[canonical.contract as keyof typeof recordSchemas]
        : undefined;
    if (!schema)
      return reply.status(400).send({ error: "unknown record kind" });
    preflightLaw(canonical);
    const parsed = schema.safeParse(canonical);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: "protocol-validation", issues: parsed.error.issues });
    const record = parsed.data as OpenorgRecord;
    const principal = principalFor(request);
    security.authorizeWrite(principal, record);
    if (
      record.contract === "olp.reusable-policy" &&
      (record as ReusablePolicy).status === "approved"
    )
      throw lawError("policy-approval", [
        "approved policy must supersede a stored proposal through the approval endpoint"
      ]);
    if (record.contract === "olp.eligibility-receipt") {
      const receipt = EligibilityReceiptSchema.parse(record);
      const proposal = LearningProposalSchema.parse(
        await requireReadableRecord(
          request,
          receipt.proposalRef.id,
          "olp.learning-proposal"
        )
      );
      const result = checkLearningEligibility(proposal, receipt);
      if (!result.valid) throw lawError("learning-eligibility", result.reasons);
    }
    if (record.contract === "olp.evaluation-receipt") {
      const receipt = EvaluationReceiptSchema.parse(record);
      const artifact = LearningArtifactSchema.parse(
        await requireReadableRecord(
          request,
          receipt.artifactRef.id,
          "olp.learning-artifact"
        )
      );
      if (artifact.version !== receipt.artifactRef.version)
        throw lawError("evaluation-artifact-binding", [
          "evaluation receipt must judge the exact artifact version"
        ]);
      const result = checkEvaluationIndependence(artifact, receipt);
      if (!result.valid)
        throw lawError("evaluation-independence", result.reasons);
      if (
        security.mode === "enforced" &&
        (principal.identity.kind !== receipt.evaluatedBy.kind ||
          principal.identity.id !== receipt.evaluatedBy.id)
      )
        throw lawError("evaluation-identity", [
          "evaluator identity must match the authenticated principal"
        ]);
    }
    if (record.contract === "olp.promotion-receipt") {
      const receipt = PromotionReceiptSchema.parse(record);
      const eligibility = EligibilityReceiptSchema.parse(
        await requireReadableRecord<EligibilityReceipt>(
          request,
          receipt.eligibilityRef.id,
          "olp.eligibility-receipt"
        )
      );
      const artifact = LearningArtifactSchema.parse(
        await requireReadableRecord(
          request,
          receipt.artifactRef.id,
          "olp.learning-artifact"
        )
      );
      const evaluations = await Promise.all(
        receipt.evaluationRefs.map(async (ref) =>
          EvaluationReceiptSchema.parse(
            await requireReadableRecord(
              request,
              ref.id,
              "olp.evaluation-receipt"
            )
          )
        )
      );
      if (
        receipt.evaluationRefs.some(
          (ref, index) => evaluations[index]?.version !== ref.version
        )
      )
        throw lawError("learning-promotion", [
          "promotion must bind exact evaluation receipt versions"
        ]);
      if (
        evaluations.some(
          (evaluation) =>
            evaluation.artifactRef.id !== artifact.id ||
            evaluation.artifactRef.version !== artifact.version
        )
      )
        throw lawError("learning-promotion", [
          "evaluation receipts must judge the promoted artifact version"
        ]);
      await enforcePromotionRollback(request, receipt);
      const result = checkLearningPromotion(receipt, eligibility, artifact);
      if (!result.valid) throw lawError("learning-promotion", result.reasons);
      const evaluationResult = checkPromotionEvaluations(receipt, evaluations);
      if (!evaluationResult.valid)
        throw lawError("learning-promotion", evaluationResult.reasons);
      if (principal.identity.kind !== "human")
        throw lawError("learning-promotion", [
          "promotion decisions require an authenticated human"
        ]);
      if (
        principal.identity.id !== receipt.decidedBy.id ||
        principal.identity.kind !== receipt.decidedBy.kind
      )
        throw lawError("learning-promotion", [
          "promotion identity must match the authenticated human"
        ]);
    }
    if (record.contract === "openorg.consent-grant") {
      const grant = record as ConsentGrant;
      if (
        security.mode === "enforced" &&
        (principal.identity.kind !== "human" ||
          principal.identity.id !== grant.grantedBy.id)
      )
        throw lawError("consent-authority", [
          "consent must be created by the authenticated human grantor"
        ]);
    }
    if (record.contract === "openorg.access-policy") {
      authorize(request, "policy.approve", {
        organizationId:
          (record as OpenorgRecord & { organizationId?: string })
            .organizationId ?? organizationFor(principal)
      });
    }
    enforceRecord(record);
    if (record.contract === "openorg.org-record")
      await enforceSemanticVerification(principal, record as OrgRecord);
    try {
      await store.append(record);
    } catch (error) {
      return reply.status(409).send({ error: (error as Error).message });
    }
    broadcast("record.accepted", record);
    return reply.status(201).send(record);
  });
  app.get("/api/records", async (request) => {
    const principal = authorize(request, "record.read");
    const query = request.query as RecordQuery;
    const scopedQuery =
      security.mode === "enforced"
        ? { ...query, organizationId: principal.organizationId }
        : query;
    const requestedContract = query.kind
      ? canonicalOlpContract(query.kind)
      : undefined;
    const olpQuery = requestedContract?.startsWith("olp.")
      ? requestedContract
      : undefined;
    const storeQuery: RecordQuery = { ...scopedQuery };
    if (olpQuery) delete storeQuery.kind;
    return (await store.query(storeQuery))
      .filter((record) => security.canRead(principal, record))
      .map((record) => normalizeOlpRecord(record))
      .filter(
        (record) =>
          !olpQuery ||
          (typeof record.contract === "string" &&
            matchesOlpContract(record.contract, olpQuery))
      );
  });
  app.get<{ Params: { id: string } }>(
    "/api/records/:id",
    async (request, reply) => {
      const principal = authorize(request, "record.read");
      const value = await store.get(request.params.id);
      return value && security.canRead(principal, value)
        ? normalizeOlpRecord(value)
        : reply.status(404).send({ error: "record not found" });
    }
  );
  app.post("/api/lineage", async (request, reply) => {
    preflightLaw(request.body as Record<string, unknown>);
    const parsed = LineageAssertionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: "protocol-validation", issues: parsed.error.issues });
    const from = await store.get(parsed.data.from.id);
    const to = await store.get(parsed.data.to.id);
    const principal = principalFor(request);
    if (!from || !to)
      return reply.status(422).send({
        error: "lineage endpoints must reference existing records",
        invariant: "lineage-referential-integrity"
      });
    if (!security.canRead(principal, from) || !security.canRead(principal, to))
      return reply.status(404).send({ error: "lineage endpoint not found" });
    const fromOrganization = (
      from as OpenorgRecord & { organizationId?: string }
    ).organizationId;
    const toOrganization = (to as OpenorgRecord & { organizationId?: string })
      .organizationId;
    if (
      security.mode === "enforced" &&
      (!fromOrganization || fromOrganization !== toOrganization)
    )
      throw lawError("organization-boundary", [
        "lineage cannot cross organization boundaries"
      ]);
    authorize(request, "lineage.write", {
      organizationId: fromOrganization ?? organizationFor(principal)
    });
    enforceAuthenticatedAuthority(principal, parsed.data);
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
      const principal = principalFor(request);
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
      const from = await store.get(candidate.data.from.id);
      if (!from || !security.canRead(principal, from))
        return reply.status(404).send({ error: "lineage not found" });
      authorize(request, "lineage.write", {
        organizationId:
          (from as OpenorgRecord & { organizationId?: string })
            .organizationId ?? organizationFor(principal)
      });
      enforceAuthenticatedAuthority(principal, candidate.data);
      enforceLineage(candidate.data);
      await store.updateLineage(candidate.data);
      broadcast("lineage.judged", candidate.data);
      return candidate.data;
    }
  );
  app.post("/api/skills/import", async (request, reply) => {
    authorize(request, "skill.manage");
    return reply
      .status(201)
      .send(
        await skills.importSkillDraft(
          (request.body as { source: string }).source
        )
      );
  });
  app.post("/api/skills/draft", async (request, reply) => {
    authorize(request, "skill.manage");
    const body = request.body as { content: string; harnessId: string };
    return reply
      .status(201)
      .send(await skills.draftSkill(body.content, body.harnessId));
  });
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/approve",
    async (request, reply) => {
      authorize(request, "skill.manage");
      return reply
        .status(201)
        .send(await skills.approve(request.params.id, request.body));
    }
  );
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/install",
    async (request, reply) => {
      authorize(request, "skill.manage");
      return reply.status(201).send(await skills.install(request.params.id));
    }
  );
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/invoke",
    async (request, reply) => {
      authorize(request, "skill.invoke");
      return reply
        .status(201)
        .send(await skills.invoke(request.params.id, request.body));
    }
  );
  app.get<{ Params: { recordId: string } }>(
    "/api/lineage/trace/:recordId",
    async (request, reply) => {
      const principal = authorize(request, "lineage.read");
      const trace = await store.trace(request.params.recordId);
      if (!trace.record || !security.canRead(principal, trace.record))
        return reply.status(404).send({ error: "record not found" });
      return trace;
    }
  );
  app.get<{ Params: { rootId: string } }>(
    "/api/journey/:rootId",
    async (request, reply) => {
      const principal = authorize(request, "lineage.read");
      const root = await store.get(request.params.rootId);
      if (!root || !security.canRead(principal, root))
        return reply.status(404).send({ error: "record not found" });
      const seen = new Set<string>();
      const queue = [request.params.rootId];
      const nodes: OpenorgRecord[] = [];
      const lineage: LineageAssertion[] = [];
      while (queue.length) {
        const id = queue.shift();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const trace = await store.trace(id);
        if (trace.record && security.canRead(principal, trace.record))
          nodes.push(trace.record);
        for (const edge of [...trace.incoming, ...trace.outgoing]) {
          const otherId = edge.from.id === id ? edge.to.id : edge.from.id;
          const other = await store.get(otherId);
          if (!other || !security.canRead(principal, other)) continue;
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
    authorize(request, "record.read");
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
  app.get("/api/providers", async (request) => {
    authorize(request, "provider.read");
    return [...providers.values()];
  });
  app.post("/api/providers", async (request, reply) => {
    authorize(request, "provider.manage");
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
      authorize(request, "provider.manage");
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
  const performExport = async (
    request: FastifyRequest,
    reply: FastifyReply,
    shape: ExportShape,
    exportRequest: ExportRequest
  ) => {
    const principal = principalFor(request);
    const action = `export.${shape}` as const;
    const now = new Date().toISOString();
    const candidateRecords = await scopedRecords(request);
    const organizations = new Set(
      candidateRecords.flatMap((record) => {
        const value = (record as OpenorgRecord & { organizationId?: string })
          .organizationId;
        return value ? [value] : [];
      })
    );
    if (security.mode === "local" && organizations.size > 1)
      throw lawError("organization-boundary", [
        "a governed export cannot combine multiple organizations"
      ]);
    const organizationId =
      principal.organizationId === "*"
        ? ([...organizations][0] ?? "local")
        : principal.organizationId;
    const accessRequest = {
      action,
      organizationId,
      purpose: exportRequest.purpose,
      destination: exportRequest.destination
    } as const;
    security.authorize(principal, accessRequest);

    let consent: ConsentGrant | undefined;
    if (security.consentRequired(principal, accessRequest)) {
      if (!exportRequest.consentRef)
        throw Object.assign(
          new Error("explicit consent is required for this export"),
          { statusCode: 403, invariant: "consent" }
        );
      consent = await requireReadableRecord<ConsentGrant>(
        request,
        exportRequest.consentRef.id,
        "openorg.consent-grant"
      );
    }
    if (exportRequest.destination.kind === "external" && !security.policy)
      throw lawError("egress-policy", [
        "external egress requires enforced security and an access policy"
      ]);

    const authorizedRecords = candidateRecords.filter((record) => {
      const data = record as OpenorgRecord & {
        organizationId?: string;
        recordType?: string;
        access?: {
          classification?:
            "public" | "internal" | "confidential" | "restricted";
          permissions?: string[];
        };
      };
      try {
        security.authorize(principal, {
          ...accessRequest,
          ...(data.recordType ? { recordType: data.recordType } : {}),
          ...(data.access?.classification
            ? { classification: data.access.classification }
            : {}),
          requiredPermissions: data.access?.permissions ?? []
        });
        return true;
      } catch {
        return false;
      }
    });
    const governed = await buildGovernedExport(shape, authorizedRecords, store);
    if (
      exportRequest.destination.kind === "external" &&
      governed.includedRecordRefs.length === 0
    )
      throw lawError("egress-empty", [
        "external egress requires at least one eligible governed record"
      ]);
    if (consent) {
      const result = checkConsent(
        consent,
        principal,
        { ...accessRequest, recordRefs: governed.includedRecordRefs },
        now
      );
      if (!result.valid)
        throw Object.assign(new Error(result.reasons.join("; ")), {
          statusCode: 403,
          invariant: "consent"
        });
    }
    const contentRef = {
      algorithm: "sha256" as const,
      digest: createHash("sha256").update(governed.body).digest("hex"),
      mediaType: "application/x-ndjson"
    };
    const byId = new Map(
      authorizedRecords.map((record) => [record.id, record])
    );
    const manifest = DatasetManifestSchema.parse({
      contract: "olp.dataset-manifest",
      contractVersion: "0.1.0",
      id: `dataset-${shape}-${randomUUID()}`,
      organizationId,
      purpose: shape,
      createdAt: now,
      createdBy: principal.identity.id,
      policyRefs: security.policy ? [security.policy.id] : [],
      recordRefs: governed.includedRecordRefs,
      schemaVersions: [
        ...new Set(
          governed.includedRecordRefs.flatMap((ref) => {
            const version = (
              byId.get(ref.id) as OpenorgRecord & { contractVersion?: string }
            )?.contractVersion;
            return version ? [version] : [];
          })
        )
      ],
      inclusion: [
        `authorized for ${action}`,
        `purpose=${exportRequest.purpose}`,
        `destination=${exportRequest.destination.kind}:${exportRequest.destination.id}`
      ],
      exclusions: governed.exclusions,
      contentRef
    } satisfies DatasetManifest);
    await store.append(manifest);
    broadcast("dataset.exported", manifest);

    let egressId: string | undefined;
    if (exportRequest.destination.kind === "external") {
      const exportConsent = consent;
      const exportPolicy = security.policy;
      if (!exportConsent || !exportPolicy)
        throw lawError("egress-policy", [
          "external egress requires consent and enforced policy"
        ]);
      const receipt = EgressReceiptSchema.parse({
        contract: "openorg.egress-receipt",
        contractVersion: "1.0.0",
        id: `egress-${randomUUID()}`,
        organizationId,
        actor: principal.identity,
        action,
        purpose: exportRequest.purpose,
        destination: exportRequest.destination,
        datasetRef: { id: manifest.id, version: "1" },
        consentRef: { id: exportConsent.id, version: exportConsent.version },
        policyRef: {
          id: exportPolicy.id,
          version: exportPolicy.version
        },
        recordRefs: governed.includedRecordRefs,
        contentRef,
        createdAt: now
      });
      await store.append(receipt);
      broadcast("egress.recorded", receipt);
      egressId = receipt.id;
    }
    reply.header("x-openorg-resolved-content", "true");
    reply.header("x-openorg-dataset-manifest-id", manifest.id);
    if (egressId) reply.header("x-openorg-egress-receipt-id", egressId);
    return reply.type("application/x-ndjson").send(governed.body);
  };
  const exportShape = (value: string): ExportShape | undefined =>
    ["rag", "evaluation", "preference", "sft"].includes(value)
      ? (value as ExportShape)
      : undefined;

  app.get<{ Params: { shape: string } }>(
    "/api/export/:shape",
    async (request, reply) => {
      const shape = exportShape(request.params.shape);
      if (!shape)
        return reply.status(404).send({ error: "unknown export shape" });
      if (security.mode === "enforced")
        return reply.status(405).send({
          error:
            "governed exports require POST with purpose and destination in enforced mode",
          invariant: "explicit-egress"
        });
      return performExport(request, reply, shape, {
        purpose: shape,
        destination: { kind: "same_process", id: "local-runtime" }
      });
    }
  );
  app.post<{ Params: { shape: string } }>(
    "/api/export/:shape",
    async (request, reply) => {
      const shape = exportShape(request.params.shape);
      if (!shape)
        return reply.status(404).send({ error: "unknown export shape" });
      const parsed = ExportRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({
          error: "protocol-validation",
          issues: parsed.error.issues
        });
      return performExport(request, reply, shape, parsed.data);
    }
  );

  app.post("/api/learning/evaluate", async (request, reply) => {
    const body = request.body as { suiteId?: string; providerIds?: string[] };
    if (!body.suiteId || !body.providerIds?.length)
      return reply.status(400).send({
        error: "suiteId and at least one providerId are required"
      });
    const suite = EvaluationSuiteSchema.parse(
      await requireReadableRecord<EvaluationSuite>(
        request,
        body.suiteId,
        "olp.evaluation-suite"
      )
    );
    authorize(request, "learning.evaluate", {
      organizationId: suite.organizationId
    });
    const evaluations: ModelEvaluation[] = [];
    for (const providerId of body.providerIds) {
      const provider = modelProviders.get(providerId);
      if (!provider)
        return reply.status(422).send({
          error: `runtime model provider unavailable: ${providerId}`,
          invariant: "honest-provider-availability"
        });
      const evaluation = await evaluateModel(suite, provider);
      await store.append(evaluation);
      broadcast("model.evaluated", evaluation);
      evaluations.push(evaluation);
    }
    const evidenceRefs = [
      ...new Map(
        evaluations
          .flatMap((evaluation) =>
            evaluation.results.flatMap((result) => result.evidenceRefs)
          )
          .map((ref) => [`${ref.algorithm}:${ref.digest}`, ref])
      ).values()
    ];
    const allPassed = evaluations.every(
      (evaluation) =>
        evaluation.metrics.totalCases > 0 &&
        evaluation.metrics.passedCases === evaluation.metrics.totalCases
    );
    const artifact = await store.get(`artifact-${suite.id}`);
    const receipt = EvaluationReceiptSchema.parse({
      contract: "olp.evaluation-receipt",
      contractVersion: "0.1.0",
      id: `evaluation-receipt-${randomUUID()}`,
      version: "1",
      organizationId: suite.organizationId,
      artifactRef: artifact
        ? {
            id: artifact.id,
            version: (artifact as { version?: string }).version ?? "1"
          }
        : { id: suite.id, version: suite.version },
      evaluationRefs: evaluations.map((evaluation) => ({
        id: evaluation.id,
        version: "1"
      })),
      verdict: allPassed
        ? evidenceRefs.length > 0
          ? "passed"
          : "inconclusive"
        : "failed",
      metrics: {
        providerCount: evaluations.length,
        bestPassRate: Math.max(
          ...evaluations.map((evaluation) => evaluation.metrics.passRate)
        )
      },
      evidenceRefs,
      evaluatedBy: { kind: "service", id: "openorg-evaluation-runtime" },
      independent: !(
        suite.createdBy.kind === "service" &&
        suite.createdBy.id === "openorg-evaluation-runtime"
      ),
      evaluatedAt: new Date().toISOString()
    });
    await store.append(receipt);
    broadcast("learning.evaluated", receipt);
    return reply.status(201).send(evaluations);
  });

  app.post("/api/learning/route", async (request, reply) => {
    const body = request.body as {
      policyId?: string;
      evaluationIds?: string[];
    };
    if (!body.policyId || !body.evaluationIds?.length)
      return reply.status(400).send({
        error: "policyId and at least one evaluationId are required"
      });
    const policy = RoutingPolicySchema.parse(
      await requireReadableRecord<RoutingPolicy>(
        request,
        body.policyId,
        "olp.routing-policy"
      )
    );
    authorize(request, "learning.route", {
      organizationId: policy.organizationId
    });
    const evaluations = await Promise.all(
      body.evaluationIds.map(async (id) =>
        ModelEvaluationSchema.parse(
          await requireReadableRecord<ModelEvaluation>(
            request,
            id,
            "olp.model-evaluation"
          )
        )
      )
    );
    const decision = routeEvaluations(policy, evaluations);
    await store.append(decision);
    broadcast("model.routed", decision);
    return reply.status(201).send(decision);
  });

  app.post("/api/learning/train/local-logistic", async (request, reply) => {
    const body = request.body as {
      datasetId?: string;
      examples?: { features: number[]; label: 0 | 1 }[];
      epochs?: number;
      learningRate?: number;
    };
    if (!body.datasetId || !Array.isArray(body.examples))
      return reply.status(400).send({
        error: "datasetId and labeled numeric examples are required"
      });
    const dataset = DatasetManifestSchema.parse(
      await requireReadableRecord<DatasetManifest>(
        request,
        body.datasetId,
        "olp.dataset-manifest"
      )
    );
    authorize(request, "learning.train", {
      organizationId: dataset.organizationId
    });
    const trainingDigest = createHash(dataset.contentRef.algorithm)
      .update(JSON.stringify(body.examples))
      .digest("hex");
    if (trainingDigest !== dataset.contentRef.digest)
      throw lawError("training-dataset-binding", [
        "training examples do not match the governed dataset manifest digest"
      ]);
    const runId = randomUUID();
    const result = trainLocalLogisticRegression({
      jobId: `training-${runId}`,
      modelId: `model-${runId}`,
      organizationId: dataset.organizationId,
      datasetRef: { id: dataset.id, version: "1" },
      examples: body.examples,
      ...(body.epochs !== undefined ? { epochs: body.epochs } : {}),
      ...(body.learningRate !== undefined
        ? { learningRate: body.learningRate }
        : {})
    });
    await store.append(result.artifact);
    await store.append(result.job);
    broadcast("model.trained", result.job);
    return reply.status(201).send(result);
  });

  app.post<{ Params: { id: string } }>(
    "/api/learning/train-adapter/:id",
    async (request, reply) => {
      const body = request.body as {
        datasetId?: string;
        parameters?: Record<string, unknown>;
      };
      if (!body.datasetId)
        return reply.status(400).send({ error: "datasetId is required" });
      const adapter = trainingAdapters.get(request.params.id);
      if (!adapter)
        return reply.status(422).send({
          error: `runtime training adapter unavailable: ${request.params.id}`,
          invariant: "honest-provider-availability"
        });
      const dataset = DatasetManifestSchema.parse(
        await requireReadableRecord<DatasetManifest>(
          request,
          body.datasetId,
          "olp.dataset-manifest"
        )
      );
      authorize(request, "learning.train", {
        organizationId: dataset.organizationId
      });
      const raw = await adapter.train({
        organizationId: dataset.organizationId,
        datasetRef: { id: dataset.id, version: "1" },
        parameters: body.parameters ?? {}
      });
      const artifact = ModelArtifactSchema.parse(raw.artifact);
      const job = TrainingJobSchema.parse(raw.job);
      if (
        artifact.organizationId !== dataset.organizationId ||
        job.organizationId !== dataset.organizationId ||
        job.adapterId !== adapter.manifest.id ||
        job.executionBoundary !== "organization_vpc" ||
        job.datasetRef.id !== dataset.id ||
        job.inputDigest.algorithm !== dataset.contentRef.algorithm ||
        job.inputDigest.digest !== dataset.contentRef.digest ||
        job.modelRef?.id !== artifact.id
      )
        throw lawError("training-adapter-receipt", [
          "adapter result must preserve organization, dataset, adapter, VPC boundary, and model references"
        ]);
      await store.append(artifact);
      await store.append(job);
      broadcast("model.trained", job);
      return reply.status(201).send({ artifact, job });
    }
  );

  app.post("/api/learning/promote", async (request, reply) => {
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
    };
    const principal = principalFor(request);
    const organizationId =
      principal.organizationId === "*"
        ? body.organizationId
        : principal.organizationId;
    if (!organizationId || !body.workspaceId)
      return reply.status(400).send({
        error: "organizationId and workspaceId are required"
      });
    authorize(request, "learning.promote", { organizationId });
    const availableRecords = await scopedRecords(request);
    const records = availableRecords.filter(
      (record): record is OrgRecord => record.contract === "openorg.org-record"
    );
    const consentGrants = availableRecords.flatMap((record) => {
      if (record.contract !== "openorg.consent-grant") return [];
      const parsed = ConsentGrantSchema.safeParse(record);
      return parsed.success ? [parsed.data] : [];
    });
    const promoted = promoteLearning(
      records,
      organizationId,
      body.workspaceId,
      principal.identity,
      { principal, consentGrants }
    );
    const created: OpenorgRecord[] = [];
    for (const proposal of promoted.proposals)
      if (await appendIfAbsent(proposal)) created.push(proposal);
    for (const receipt of promoted.eligibilityReceipts)
      if (await appendIfAbsent(receipt)) created.push(receipt);
    for (const artifact of promoted.artifacts)
      if (await appendIfAbsent(artifact)) created.push(artifact);
    if (promoted.suite && (await appendIfAbsent(promoted.suite)))
      created.push(promoted.suite);
    for (const policy of promoted.policies)
      if (await appendIfAbsent(policy)) created.push(policy);
    broadcast("learning.promoted", {
      organizationId,
      workspaceId: body.workspaceId,
      recordIds: created.map((record) => record.id)
    });
    return reply.status(201).send({
      ...promoted,
      createdRecordIds: created.map((record) => record.id)
    });
  });

  app.post("/api/learning/promotions", async (request, reply) => {
    const body = request.body as {
      artifactId?: string;
      evaluationReceiptIds?: string[];
      decision?: PromotionReceipt["decision"];
      target?: PromotionReceipt["target"];
      reasons?: string[];
      rollbackOf?: PromotionReceipt["rollbackOf"];
    };
    if (
      !body.artifactId ||
      !body.decision ||
      !body.target ||
      !body.reasons?.length
    )
      return reply.status(400).send({
        error: "artifactId, decision, target, and reasons are required"
      });
    const receipt = await createPromotionReceipt(request, {
      artifactId: body.artifactId,
      evaluationReceiptIds: body.evaluationReceiptIds ?? [],
      decision: body.decision,
      target: body.target,
      reasons: body.reasons,
      ...(body.rollbackOf ? { rollbackOf: body.rollbackOf } : {})
    });
    return reply.status(201).send(receipt);
  });

  app.post<{ Params: { id: string } }>(
    "/api/learning/policies/:id/approve",
    async (request, reply) => {
      const principal = principalFor(request);
      if (principal.identity.kind !== "human")
        throw Object.assign(
          new Error("only an authenticated human may approve reusable policy"),
          { statusCode: 403, invariant: "policy-approval" }
        );
      const current = ReusablePolicySchema.parse(
        await requireReadableRecord<ReusablePolicy>(
          request,
          request.params.id,
          "olp.reusable-policy"
        )
      );
      authorize(request, "policy.approve", {
        organizationId: current.organizationId
      });
      if (current.status === "approved") return current;
      const body = request.body as { evaluationReceiptIds?: string[] };
      if (!body.evaluationReceiptIds?.length)
        return reply.status(400).send({
          error: "at least one evaluationReceiptId is required"
        });
      const promotion = await createPromotionReceipt(request, {
        artifactId: `artifact-${current.id}`,
        evaluationReceiptIds: body.evaluationReceiptIds,
        decision: "approved",
        target: { kind: "policy", id: current.id },
        reasons: ["Human approved independently evaluated reusable policy"]
      });
      const numericVersion = Number(current.version);
      const approved = ReusablePolicySchema.parse({
        ...current,
        version: Number.isFinite(numericVersion)
          ? String(numericVersion + 1)
          : `${current.version}-approved`,
        status: "approved",
        approvedBy: principal.identity,
        approvedAt: new Date().toISOString()
      });
      await store.append(approved);
      broadcast("policy.approved", approved);
      reply.header("x-olp-promotion-receipt-id", promotion.id);
      return reply.status(201).send(approved);
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
