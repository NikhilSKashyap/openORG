import { createHash } from "node:crypto";
import {
  EvaluationSuiteSchema,
  EligibilityReceiptSchema,
  LearningArtifactSchema,
  LearningProposalSchema,
  ModelArtifactSchema,
  ModelEvaluationSchema,
  RoutingDecisionSchema,
  TrainingJobSchema,
  checkConsent,
  type AuthenticatedPrincipal,
  type ConsentGrant,
  type Destination,
  type EvaluationCase,
  type EvaluationSuite,
  type EligibilityCheck,
  type EligibilityReceipt,
  type Identity,
  type LearningProposal,
  type LearningArtifact,
  type LearningPurpose,
  type ModelArtifact,
  type ModelEvaluation,
  type OrgRecord,
  type RecordRef,
  type ReusablePolicy,
  type RoutingDecision,
  type RoutingPolicy,
  type TrainingJob
} from "@openorg/protocol";
import type { ModelProvider } from "@openorg/sdk";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const contentRef = (value: unknown) => ({
  algorithm: "sha256" as const,
  digest: digest(value),
  mediaType: "application/json"
});
const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export async function evaluateModel(
  suiteInput: EvaluationSuite,
  provider: ModelProvider,
  clock: () => string = () => new Date().toISOString()
): Promise<ModelEvaluation> {
  const suite = EvaluationSuiteSchema.parse(suiteInput);
  const cases = suite.cases.filter((value) => value.kind === "model_output");
  if (cases.length === 0)
    throw new Error("model evaluation requires at least one model_output case");
  const startedAt = clock();
  const results: ModelEvaluation["results"] = [];
  for (const value of cases) {
    const started = performance.now();
    try {
      const result = await provider.invoke({
        caseId: value.id,
        prompt: value.input
      });
      if (result.modelId !== provider.modelId)
        throw new Error(
          `provider reported model ${result.modelId}, expected ${provider.modelId}`
        );
      const latencyMs = result.latencyMs ?? performance.now() - started;
      const passed =
        normalize(result.output) === normalize(value.expectedOutput ?? "");
      results.push({
        caseId: value.id,
        status: passed ? "passed" : "failed",
        output: result.output,
        latencyMs,
        ...(result.cost ? { cost: result.cost } : {}),
        evidenceRefs: result.evidenceRefs ?? []
      });
    } catch (error) {
      results.push({
        caseId: value.id,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        latencyMs: performance.now() - started,
        evidenceRefs: []
      });
    }
  }
  const costs = results.flatMap((value) => (value.cost ? [value.cost] : []));
  const currencies = new Set(costs.map((value) => value.currency));
  const passedCases = results.filter(
    (value) => value.status === "passed"
  ).length;
  const totalCost =
    costs.length === results.length && currencies.size === 1
      ? {
          amount: costs.reduce((total, value) => total + value.amount, 0),
          currency: costs[0]?.currency ?? "USD"
        }
      : undefined;
  return ModelEvaluationSchema.parse({
    contract: "olp.model-evaluation",
    contractVersion: "0.1.0",
    id: `evaluation-${suite.id}-${provider.manifest.id}-${digest(results).slice(0, 12)}`,
    organizationId: suite.organizationId,
    suiteRef: { id: suite.id, version: suite.version },
    providerId: provider.manifest.id,
    modelId: provider.modelId,
    startedAt,
    completedAt: clock(),
    results,
    metrics: {
      totalCases: results.length,
      passedCases,
      passRate: passedCases / results.length,
      averageLatencyMs:
        results.reduce((total, value) => total + value.latencyMs, 0) /
        results.length,
      ...(totalCost ? { totalCost } : {}),
      costCoverage: costs.length / results.length
    }
  });
}

export function routeEvaluations(
  policy: RoutingPolicy,
  evaluations: readonly ModelEvaluation[],
  clock: () => string = () => new Date().toISOString()
): RoutingDecision {
  const rejected: string[] = [];
  const eligible = evaluations.filter((evaluation) => {
    if (!policy.candidateProviderIds.includes(evaluation.providerId))
      return false;
    if (evaluation.organizationId !== policy.organizationId) {
      rejected.push(`${evaluation.providerId}: organization mismatch`);
      return false;
    }
    if (evaluation.metrics.passRate < policy.minimumPassRate) {
      rejected.push(`${evaluation.providerId}: quality below minimum`);
      return false;
    }
    if (
      policy.maximumAverageLatencyMs !== undefined &&
      evaluation.metrics.averageLatencyMs > policy.maximumAverageLatencyMs
    ) {
      rejected.push(`${evaluation.providerId}: latency above maximum`);
      return false;
    }
    if (policy.maximumTotalCost) {
      if (!evaluation.metrics.totalCost) {
        rejected.push(`${evaluation.providerId}: cost is unknown`);
        return false;
      }
      if (
        evaluation.metrics.totalCost.currency !==
          policy.maximumTotalCost.currency ||
        evaluation.metrics.totalCost.amount > policy.maximumTotalCost.amount
      ) {
        rejected.push(
          `${evaluation.providerId}: cost above maximum or wrong currency`
        );
        return false;
      }
    }
    if (policy.objective === "lowest_cost" && !evaluation.metrics.totalCost) {
      rejected.push(`${evaluation.providerId}: cost is unknown`);
      return false;
    }
    return true;
  });
  eligible.sort((left, right) => {
    if (policy.objective === "highest_quality")
      return (
        right.metrics.passRate - left.metrics.passRate ||
        left.metrics.averageLatencyMs - right.metrics.averageLatencyMs
      );
    if (policy.objective === "lowest_latency")
      return left.metrics.averageLatencyMs - right.metrics.averageLatencyMs;
    return (
      (left.metrics.totalCost?.amount ?? Number.POSITIVE_INFINITY) -
      (right.metrics.totalCost?.amount ?? Number.POSITIVE_INFINITY)
    );
  });
  const selected = eligible[0];
  return RoutingDecisionSchema.parse({
    contract: "olp.routing-decision",
    contractVersion: "0.1.0",
    id: `route-${policy.id}-${digest(evaluations.map((value) => value.id)).slice(0, 12)}`,
    organizationId: policy.organizationId,
    policyRef: { id: policy.id, version: policy.version },
    evaluationRefs: evaluations.map((value) => ({
      id: value.id,
      version: "1"
    })),
    status: selected ? "selected" : "blocked",
    ...(selected ? { selectedProviderId: selected.providerId } : {}),
    reasons: selected
      ? [
          `${selected.providerId} met the measured quality floor`,
          `${policy.objective} selected from ${eligible.length} eligible provider(s)`
        ]
      : rejected.length > 0
        ? rejected
        : ["no candidate provider had evaluation evidence"],
    decidedAt: clock()
  });
}

export type LabeledExample = { features: number[]; label: 0 | 1 };
export type LocalTrainingRequest = {
  jobId: string;
  modelId: string;
  organizationId: string;
  datasetRef: RecordRef;
  examples: LabeledExample[];
  epochs?: number;
  learningRate?: number;
};

const probability = (weights: number[], bias: number, features: number[]) => {
  const score = weights.reduce(
    (total, weight, index) => total + weight * (features[index] ?? 0),
    bias
  );
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, score))));
};
const accuracy = (
  weights: number[],
  bias: number,
  examples: readonly LabeledExample[]
) =>
  examples.length === 0
    ? 0
    : examples.filter(
        (value) =>
          (probability(weights, bias, value.features) >= 0.5 ? 1 : 0) ===
          value.label
      ).length / examples.length;

export function trainLocalLogisticRegression(
  request: LocalTrainingRequest,
  clock: () => string = () => new Date().toISOString()
): { artifact: ModelArtifact; job: TrainingJob } {
  const startedAt = clock();
  if (request.examples.length < 5)
    throw new Error("local logistic training requires at least five examples");
  const featureCount = request.examples[0]?.features.length ?? 0;
  if (featureCount === 0)
    throw new Error("training examples require numeric features");
  if (
    request.examples.some(
      (value) =>
        value.features.length !== featureCount ||
        value.features.some((feature) => !Number.isFinite(feature))
    )
  )
    throw new Error(
      "all training examples must have the same finite feature shape"
    );
  const validationCount = Math.max(
    1,
    Math.floor(request.examples.length * 0.2)
  );
  const training = request.examples.slice(0, -validationCount);
  const validation = request.examples.slice(-validationCount);
  const weights = Array.from({ length: featureCount }, () => 0);
  let bias = 0;
  const epochs = request.epochs ?? 500;
  const learningRate = request.learningRate ?? 0.1;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = Array.from({ length: featureCount }, () => 0);
    let biasGradient = 0;
    for (const example of training) {
      const error =
        probability(weights, bias, example.features) - example.label;
      for (let index = 0; index < featureCount; index += 1)
        gradient[index] =
          (gradient[index] ?? 0) + error * (example.features[index] ?? 0);
      biasGradient += error;
    }
    for (let index = 0; index < featureCount; index += 1)
      weights[index] =
        (weights[index] ?? 0) -
        (learningRate * (gradient[index] ?? 0)) / training.length;
    bias -= (learningRate * biasGradient) / training.length;
  }
  const modelBody = {
    modelType: "logistic_regression" as const,
    featureCount,
    weights,
    bias,
    threshold: 0.5
  };
  const artifact = ModelArtifactSchema.parse({
    contract: "olp.model-artifact",
    contractVersion: "0.1.0",
    id: request.modelId,
    organizationId: request.organizationId,
    ...modelBody,
    contentRef: contentRef(modelBody),
    createdAt: clock()
  });
  const job = TrainingJobSchema.parse({
    contract: "olp.training-job",
    contractVersion: "0.1.0",
    id: request.jobId,
    organizationId: request.organizationId,
    adapterId: "openorg.local-logistic-regression",
    method: "local_logistic_regression",
    executionBoundary: "same_process",
    datasetRef: request.datasetRef,
    status: "completed",
    modelRef: { id: artifact.id, version: "1" },
    inputDigest: contentRef(request.examples),
    metrics: {
      trainingAccuracy: accuracy(weights, bias, training),
      validationAccuracy: accuracy(weights, bias, validation),
      trainingExamples: training.length,
      validationExamples: validation.length
    },
    startedAt,
    completedAt: clock()
  });
  return { artifact, job };
}

export function predictLocalModel(
  artifact: ModelArtifact,
  features: number[]
): 0 | 1 {
  if (
    artifact.modelType !== "logistic_regression" ||
    artifact.featureCount === undefined ||
    artifact.weights === undefined ||
    artifact.bias === undefined ||
    artifact.threshold === undefined
  )
    throw new Error("artifact is not a complete local logistic model");
  if (features.length !== artifact.featureCount)
    throw new Error("feature count does not match model artifact");
  return probability(artifact.weights, artifact.bias, features) >=
    artifact.threshold
    ? 1
    : 0;
}

export function promoteLearning(
  records: readonly OrgRecord[],
  organizationId: string,
  workspaceId: string,
  actor: Identity,
  clockOrOptions:
    | (() => string)
    | {
        clock?: () => string;
        consentGrants?: readonly ConsentGrant[];
        principal?: AuthenticatedPrincipal;
        destination?: Destination;
      } = () => new Date().toISOString()
): {
  proposals: LearningProposal[];
  eligibilityReceipts: EligibilityReceipt[];
  artifacts: LearningArtifact[];
  suite?: EvaluationSuite;
  policies: ReusablePolicy[];
} {
  const options =
    typeof clockOrOptions === "function"
      ? { clock: clockOrOptions }
      : clockOrOptions;
  const clock = options.clock ?? (() => new Date().toISOString());
  const principal = options.principal ?? {
    identity: actor,
    organizationId,
    permissions: []
  };
  const destination = options.destination ?? {
    kind: "same_process" as const,
    id: "openorg-learning"
  };
  const consentGrants = new Map(
    (options.consentGrants ?? []).map((grant) => [
      `${grant.id}@${grant.version}`,
      grant
    ])
  );
  const byId = new Map(records.map((value) => [value.id, value]));
  const cases: EvaluationCase[] = [];
  const policies: ReusablePolicy[] = [];
  for (const record of records) {
    if (
      record.organizationId !== organizationId ||
      record.workspaceId !== workspaceId
    )
      continue;
    if (
      record.recordType === "verification" &&
      record.payload.verdict === "failed" &&
      record.payload.independent
    ) {
      for (const subject of record.payload.subjectRefs) {
        const work = byId.get(subject.id);
        if (work?.recordType !== "work") continue;
        for (const check of record.payload.checks.filter(
          (value) => value.status === "failed"
        ))
          cases.push({
            id: `eval-${record.id}-${check.id}`,
            kind: "verification_check",
            input: work.payload.intent,
            requiredCheckId: check.id,
            sourceRefs: [
              { id: work.id, version: work.version },
              { id: record.id, version: record.version }
            ],
            permissions: [
              ...new Set([
                ...work.access.permissions,
                ...record.access.permissions
              ])
            ]
          });
      }
    }
    if (record.recordType === "correction" && record.payload.preferredContent) {
      cases.push({
        id: `eval-${record.id}-preference`,
        kind: "model_output",
        input: record.payload.reason,
        expectedOutput: record.payload.preferredContent,
        sourceRefs: [{ id: record.id, version: record.version }],
        permissions: record.access.permissions
      });
      const evidence = contentRef(record.payload);
      policies.push({
        contract: "olp.reusable-policy",
        contractVersion: "0.1.0",
        id: `policy-${record.id}`,
        version: "1",
        organizationId,
        status: "proposed",
        scope: [workspaceId, "correction"],
        instruction: record.payload.preferredContent,
        sourceRefs: [{ id: record.id, version: record.version }],
        evidenceRefs: [evidence],
        createdBy: actor,
        createdAt: clock()
      });
    }
  }
  const uniqueCases = [
    ...new Map(cases.map((value) => [value.id, value])).values()
  ];
  const proposals: LearningProposal[] = [];
  const eligibilityReceipts: EligibilityReceipt[] = [];
  const artifacts: LearningArtifact[] = [];
  const selectedPolicies: ReusablePolicy[] = [];
  const sourceRecords = (refs: readonly RecordRef[]) =>
    refs.flatMap((ref) => {
      const record = byId.get(ref.id);
      return record?.version === ref.version ? [record] : [];
    });
  const propose = (
    purpose: LearningPurpose,
    sourceRefs: readonly RecordRef[],
    suffix: string
  ) => {
    const sources = sourceRecords(sourceRefs);
    const evaluatedAt = clock();
    const sourceBindings = sources.map((record) => ({
      recordRef: { id: record.id, version: record.version },
      contentRef: contentRef(record),
      permissions: record.access.permissions
    }));
    if (sourceBindings.length !== sourceRefs.length) return undefined;
    const proposal = LearningProposalSchema.parse({
      contract: "olp.learning-proposal",
      contractVersion: "0.1.0",
      id: `learning-${purpose}-${suffix}`,
      version: "1",
      organizationId,
      workspaceId,
      purpose,
      status: "proposed",
      sourceBindings,
      policyRefs: [
        ...new Map(
          sources.flatMap((record) =>
            record.access.policyIds.map((id) => [
              `${id}@1`,
              { id, version: "1" }
            ])
          )
        ).values()
      ],
      consentRefs: [
        ...new Map(
          sources.flatMap((record) =>
            record.access.consentRef
              ? [
                  [
                    `${record.access.consentRef.id}@${record.access.consentRef.version}`,
                    record.access.consentRef
                  ] as const
                ]
              : []
          )
        ).values()
      ],
      rationale: `Reuse governed ${workspaceId} evidence for ${purpose}`,
      requestedBy: actor,
      proposedAt: clock()
    });
    const hasVerifiedSource = sources.some(
      (record) =>
        record.recordType === "correction" ||
        (record.recordType === "verification" &&
          record.payload.independent &&
          record.payload.verdict !== "inconclusive")
    );
    const outcomeSources = records.filter(
      (record) =>
        record.organizationId === organizationId &&
        record.workspaceId === workspaceId &&
        record.recordType === "outcome" &&
        record.payload.measurementSourceRefs.some((ref) =>
          sourceRefs.some(
            (source) => source.id === ref.id && source.version === ref.version
          )
        )
    );
    const expiredRetention = sources.filter(
      (record) =>
        record.access.retention?.deleteAfter &&
        Date.parse(record.access.retention.deleteAfter) <=
          Date.parse(evaluatedAt)
    );
    const consentReasons: string[] = [];
    for (const consentRef of proposal.consentRefs) {
      const grant = consentGrants.get(`${consentRef.id}@${consentRef.version}`);
      if (!grant) {
        consentReasons.push(
          `consent grant not found: ${consentRef.id}@${consentRef.version}`
        );
        continue;
      }
      const coveredSources = sources.filter(
        (record) =>
          record.access.consentRef?.id === consentRef.id &&
          record.access.consentRef.version === consentRef.version
      );
      for (const source of coveredSources) {
        const result = checkConsent(
          grant,
          principal,
          {
            action: "learning.promote",
            organizationId,
            purpose,
            destination,
            recordType: source.recordType,
            recordRefs: [{ id: source.id, version: source.version }]
          },
          evaluatedAt
        );
        if (!result.valid) consentReasons.push(...result.reasons);
      }
    }
    const checks: EligibilityCheck[] = [
      {
        check: "provenance",
        status: "passed",
        evidenceRefs: [...sourceRefs],
        reasons: []
      },
      {
        check: "access",
        status: expiredRetention.length === 0 ? "passed" : "failed",
        evidenceRefs: [...sourceRefs],
        reasons: expiredRetention.map(
          (record) => `source retention expired: ${record.id}@${record.version}`
        )
      },
      proposal.consentRefs.length > 0
        ? {
            check: "consent",
            status: consentReasons.length === 0 ? "passed" : "failed",
            evidenceRefs: proposal.consentRefs,
            reasons: [...new Set(consentReasons)]
          }
        : {
            check: "consent",
            status: "not_applicable",
            evidenceRefs: [],
            reasons: ["same-boundary reuse; no external destination requested"]
          }
    ];
    if (["evaluation", "preference", "policy", "training"].includes(purpose))
      checks.push({
        check: "verification",
        status: hasVerifiedSource ? "passed" : "failed",
        evidenceRefs: [...sourceRefs],
        reasons: hasVerifiedSource
          ? []
          : ["no human correction or independent verification evidence"]
      });
    if (["policy", "training"].includes(purpose))
      checks.push({
        check: "outcome",
        status: outcomeSources.length > 0 ? "passed" : "failed",
        evidenceRefs: outcomeSources.map((record) => ({
          id: record.id,
          version: record.version
        })),
        reasons:
          outcomeSources.length > 0
            ? []
            : ["no measured outcome binds this evidence"]
      });
    const decision = checks.some((check) => check.status === "failed")
      ? "blocked"
      : "eligible";
    const receipt = EligibilityReceiptSchema.parse({
      contract: "olp.eligibility-receipt",
      contractVersion: "0.1.0",
      id: `eligibility-${proposal.id}`,
      version: "1",
      organizationId,
      proposalRef: { id: proposal.id, version: proposal.version },
      sourceBindings,
      decision,
      checks,
      evaluatedBy: { kind: "service", id: "openorg-learning" },
      evaluatedAt
    });
    proposals.push(proposal);
    eligibilityReceipts.push(receipt);
    return receipt;
  };

  let suite: EvaluationSuite | undefined;
  if (uniqueCases.length > 0) {
    const suiteId = `suite-${digest(uniqueCases.map((value) => value.id)).slice(0, 16)}`;
    const refs = [
      ...new Map(
        uniqueCases
          .flatMap((value) => value.sourceRefs)
          .map((ref) => [`${ref.id}@${ref.version}`, ref])
      ).values()
    ];
    const eligibility = propose("evaluation", refs, suiteId);
    if (eligibility?.decision === "eligible") {
      suite = EvaluationSuiteSchema.parse({
        contract: "olp.evaluation-suite",
        contractVersion: "0.1.0",
        id: suiteId,
        version: "1",
        organizationId,
        workspaceId,
        title: `Promoted evidence for ${workspaceId}`,
        createdAt: clock(),
        createdBy: actor,
        cases: uniqueCases
      });
      artifacts.push(
        LearningArtifactSchema.parse({
          contract: "olp.learning-artifact",
          contractVersion: "0.1.0",
          id: `artifact-${suite.id}`,
          version: "1",
          organizationId,
          artifactType: "evaluation_suite",
          status: "active",
          proposalRef: eligibility.proposalRef,
          eligibilityRef: { id: eligibility.id, version: eligibility.version },
          sourceBindings: eligibility.sourceBindings,
          contentRef: contentRef(suite),
          createdBy: actor,
          createdAt: clock()
        })
      );
    }
  }

  for (const policy of policies) {
    const eligibility = propose("policy", policy.sourceRefs, policy.id);
    if (eligibility?.decision === "eligible") {
      selectedPolicies.push(policy);
      artifacts.push(
        LearningArtifactSchema.parse({
          contract: "olp.learning-artifact",
          contractVersion: "0.1.0",
          id: `artifact-${policy.id}`,
          version: "1",
          organizationId,
          artifactType: "policy_candidate",
          status: "active",
          proposalRef: eligibility.proposalRef,
          eligibilityRef: { id: eligibility.id, version: eligibility.version },
          sourceBindings: eligibility.sourceBindings,
          contentRef: contentRef(policy),
          createdBy: actor,
          createdAt: clock()
        })
      );
    }
  }
  if (!suite)
    return {
      proposals,
      eligibilityReceipts,
      artifacts,
      policies: selectedPolicies
    };
  return {
    proposals,
    eligibilityReceipts,
    artifacts,
    suite,
    policies: selectedPolicies
  };
}
