import type { LineageAssertion } from "./lineage-assertion.js";
import type {
  AccessPolicyManifest,
  AuthenticatedPrincipal,
  ConsentGrant,
  DataAction,
  Destination
} from "./governance.js";
import type { ReusablePolicy } from "./learning.js";
import type {
  EligibilityReceipt,
  EvaluationReceipt,
  LearningArtifact,
  LearningProposal,
  PromotionReceipt
} from "./olp.js";
import type { VerificationReceipt } from "./verification-receipt.js";
import type { WorkRecord } from "./work-record.js";

export type LawResult = { valid: true } | { valid: false; reasons: string[] };

const valid: LawResult = { valid: true };
const invalid = (...reasons: string[]): LawResult => ({
  valid: false,
  reasons
});

export function checkProvenance(
  record: Pick<WorkRecord, "provenance">
): LawResult {
  return record.provenance.source.length > 0 &&
    record.provenance.capturedAt.length > 0
    ? valid
    : invalid("provenance is required");
}

export function checkLineageConfirmation(
  assertion: LineageAssertion,
  grantedPolicyRuleIds: ReadonlySet<string>
): LawResult {
  if (assertion.state !== "confirmed") return valid;
  if (!assertion.authority)
    return invalid("confirmed lineage requires authority");
  if (assertion.evidenceRefs.length === 0)
    return invalid("confirmed lineage requires evidence");
  if (
    assertion.authority.kind === "policy" &&
    !grantedPolicyRuleIds.has(assertion.authority.ruleId)
  ) {
    return invalid("policy authority is not granted by configuration");
  }
  if (assertion.authority.kind === "agent") {
    return invalid("agents may propose lineage but may not confirm it");
  }
  if (assertion.authority.kind === "service") {
    const mechanicallyAttestable = new Set([
      "derived_from",
      "produces",
      "verifies",
      "measures"
    ]);
    if (
      assertion.basis !== "observed" ||
      !mechanicallyAttestable.has(assertion.relationship)
    ) {
      return invalid(
        "services may confirm only observed, mechanically attestable lineage"
      );
    }
  }
  return valid;
}

export function checkVerdictEvidence(receipt: VerificationReceipt): LawResult {
  return receipt.verdicts.every(
    (verdict) =>
      verdict.verifier.id.length > 0 && verdict.evidenceRefs.length > 0
  )
    ? valid
    : invalid("every verdict requires verifier identity and evidence");
}

export function checkSelfVerification(receipt: VerificationReceipt): LawResult {
  const incorrectlyDeclared = receipt.verdicts.some(
    (verdict) =>
      verdict.verifier.id === receipt.actor.id && !verdict.selfVerification
  );
  return incorrectlyDeclared
    ? invalid("actor verification must declare selfVerification")
    : valid;
}

export type GateRequirement = {
  gateId: string;
  requiredApproverIds?: readonly string[];
};

export function checkHumanGates(
  requirements: readonly GateRequirement[],
  approvals: VerificationReceipt["humanApprovals"]
): LawResult {
  const missing = requirements.filter(
    (requirement) =>
      !approvals.some(
        (approval) =>
          approval.gateId === requirement.gateId &&
          (requirement.requiredApproverIds === undefined ||
            requirement.requiredApproverIds.includes(approval.approver.id))
      )
  );
  return missing.length === 0
    ? valid
    : invalid(
        ...missing.map(
          (requirement) => `missing human gate: ${requirement.gateId}`
        )
      );
}

export function checkVerified(receipt: VerificationReceipt): LawResult {
  const verdictsByCheck = new Map(
    receipt.verdicts.map((verdict) => [verdict.checkId, verdict])
  );
  const incomplete = receipt.requiredCheckIds.filter(
    (checkId) => verdictsByCheck.get(checkId)?.status !== "passed"
  );
  return incomplete.length === 0
    ? valid
    : invalid(
        ...incomplete.map(
          (checkId) => `required check did not pass: ${checkId}`
        )
      );
}

export function checkVerificationOutcomeSeparation(
  receipt: VerificationReceipt
): LawResult {
  const verdictKeys = new Set(
    receipt.verdicts.map((verdict) => verdict.checkId)
  );
  const collisions = receipt.measuredOutcomes.filter((outcome) =>
    verdictKeys.has(outcome.metric)
  );
  return collisions.length === 0
    ? valid
    : invalid(
        "verification checks and measured outcomes must use distinct identifiers"
      );
}

export type Supersession<T> = {
  previous: Readonly<T>;
  next: Readonly<T>;
  supersededAt: string;
};

export function supersede<T extends { id: string; version: string }>(
  previous: Readonly<T>,
  next: Readonly<T>,
  supersededAt: string
): Supersession<T> {
  if (previous.id !== next.id || previous.version === next.version) {
    throw new Error("supersession requires the same id and a new version");
  }
  return Object.freeze({ previous, next, supersededAt });
}

export function checkCorrectionPreference(
  assertion: LineageAssertion
): LawResult {
  if (!assertion.correction) return valid;
  const distinct =
    assertion.correction.original.id !== assertion.correction.corrected.id ||
    assertion.correction.original.version !==
      assertion.correction.corrected.version;
  return distinct
    ? valid
    : invalid("correction must link distinct original and corrected versions");
}

export function renderKnown<T>(value: T | undefined): T | "unknown" {
  if (value === undefined) return "unknown";
  return value;
}

export type AccessRequest = {
  action: DataAction;
  organizationId: string;
  recordType?: string;
  classification?: "public" | "internal" | "confidential" | "restricted";
  requiredPermissions?: readonly string[];
  purpose?: string;
  destination?: Destination;
  recordRefs?: readonly { id: string; version: string }[];
};

const includesOrAny = (values: readonly string[], value?: string) =>
  values.length === 0 || (value !== undefined && values.includes(value));
const hasPermission = (principal: AuthenticatedPrincipal, permission: string) =>
  principal.permissions.includes("*") ||
  principal.permissions.includes(permission);

export function checkAccessPolicy(
  policy: AccessPolicyManifest,
  principal: AuthenticatedPrincipal,
  request: AccessRequest
): LawResult {
  if (
    principal.organizationId !== "*" &&
    principal.organizationId !== request.organizationId
  )
    return invalid("principal cannot cross organization boundary");
  if (
    policy.organizationId !== "*" &&
    policy.organizationId !== request.organizationId
  )
    return invalid("policy does not govern the requested organization");
  const matching = policy.rules.filter(
    (rule) =>
      rule.actions.includes(request.action) &&
      includesOrAny(rule.principalIds, principal.identity.id) &&
      includesOrAny(rule.recordTypes, request.recordType) &&
      includesOrAny(rule.classifications, request.classification) &&
      includesOrAny(rule.purposes, request.purpose) &&
      includesOrAny(rule.destinationKinds, request.destination?.kind)
  );
  if (matching.some((rule) => rule.effect === "deny"))
    return invalid("an explicit policy rule denied the request");
  const allowed = matching.filter((rule) => rule.effect === "allow");
  if (allowed.length === 0 && policy.defaultEffect === "deny")
    return invalid("no policy rule allowed the request");
  const required = new Set([
    ...(request.requiredPermissions ?? []),
    ...allowed.flatMap((rule) => rule.requiredPermissions)
  ]);
  const missing = [...required].filter(
    (permission) => !hasPermission(principal, permission)
  );
  return missing.length === 0
    ? valid
    : invalid(...missing.map((value) => `missing permission: ${value}`));
}

export function policyRequiresConsent(
  policy: AccessPolicyManifest,
  principal: AuthenticatedPrincipal,
  request: AccessRequest
): boolean {
  return policy.rules.some(
    (rule) =>
      rule.effect === "allow" &&
      rule.requireConsent &&
      rule.actions.includes(request.action) &&
      includesOrAny(rule.principalIds, principal.identity.id) &&
      includesOrAny(rule.recordTypes, request.recordType) &&
      includesOrAny(rule.classifications, request.classification) &&
      includesOrAny(rule.purposes, request.purpose) &&
      includesOrAny(rule.destinationKinds, request.destination?.kind)
  );
}

export function checkConsent(
  grant: ConsentGrant,
  principal: AuthenticatedPrincipal,
  request: AccessRequest,
  at: string
): LawResult {
  const reasons: string[] = [];
  if (grant.organizationId !== request.organizationId)
    reasons.push("consent belongs to a different organization");
  if (
    !grant.granteeIds.includes("*") &&
    !grant.granteeIds.includes(principal.identity.id)
  )
    reasons.push("principal is not a consent grantee");
  if (!grant.actions.includes(request.action))
    reasons.push("consent does not cover this action");
  if (!request.purpose || !grant.purposes.includes(request.purpose))
    reasons.push("consent does not cover this purpose");
  if (
    !request.destination ||
    (!grant.destinationIds.includes("*") &&
      !grant.destinationIds.includes(request.destination.id))
  )
    reasons.push("consent does not cover this destination");
  if (
    request.recordType &&
    grant.recordTypes.length > 0 &&
    !grant.recordTypes.includes(request.recordType)
  )
    reasons.push("consent does not cover this record type");
  if (request.recordRefs) {
    const granted = new Set(
      grant.recordRefs.map((value) => `${value.id}@${value.version}`)
    );
    const uncovered = request.recordRefs.filter(
      (value) => !granted.has(`${value.id}@${value.version}`)
    );
    if (uncovered.length > 0)
      reasons.push(
        `consent does not cover records: ${uncovered
          .map((value) => `${value.id}@${value.version}`)
          .join(", ")}`
      );
  }
  const evaluatedAt = Date.parse(at);
  if (grant.revokedAt && Date.parse(grant.revokedAt) <= evaluatedAt)
    reasons.push("consent revoked");
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= evaluatedAt)
    reasons.push("consent expired");
  return reasons.length === 0 ? valid : invalid(...reasons);
}

export function checkReusablePolicyApproval(policy: ReusablePolicy): LawResult {
  if (policy.status !== "approved") return valid;
  return policy.approvedBy?.kind === "human" && policy.approvedAt
    ? valid
    : invalid("reusable policy activation requires an authorized human");
}

const bindingKey = (value: LearningProposal["sourceBindings"][number]) =>
  `${value.recordRef.id}@${value.recordRef.version}:${value.contentRef.algorithm}:${value.contentRef.digest}`;

export function checkLearningEligibility(
  proposal: LearningProposal,
  receipt: EligibilityReceipt
): LawResult {
  const reasons: string[] = [];
  if (proposal.status !== "proposed")
    reasons.push("withdrawn proposals cannot become eligible");
  if (
    proposal.organizationId !== receipt.organizationId ||
    proposal.id !== receipt.proposalRef.id ||
    proposal.version !== receipt.proposalRef.version
  )
    reasons.push("eligibility receipt does not bind the proposed version");
  const proposedBindings = proposal.sourceBindings.map(bindingKey).sort();
  const receivedBindings = receipt.sourceBindings.map(bindingKey).sort();
  if (JSON.stringify(proposedBindings) !== JSON.stringify(receivedBindings))
    reasons.push("eligibility source versions or digests differ from proposal");

  const checks = new Map(receipt.checks.map((value) => [value.check, value]));
  const required = new Set<EligibilityReceipt["checks"][number]["check"]>([
    "provenance",
    "access",
    "consent"
  ]);
  if (
    ["evaluation", "preference", "policy", "training"].includes(
      proposal.purpose
    )
  )
    required.add("verification");
  if (["policy", "training"].includes(proposal.purpose))
    required.add("outcome");
  for (const name of required) {
    const check = checks.get(name);
    if (!check) reasons.push(`missing eligibility check: ${name}`);
    else if (check.status === "failed")
      reasons.push(`failed eligibility check: ${name}`);
  }
  if (receipt.decision === "eligible" && reasons.length > 0)
    return invalid(...reasons);
  if (receipt.decision === "blocked" && reasons.length === 0)
    return invalid("blocked eligibility receipt has no blocking reason");
  return valid;
}

export function checkEvaluationIndependence(
  artifact: LearningArtifact,
  receipt: EvaluationReceipt
): LawResult {
  const sameActor =
    artifact.createdBy.kind === receipt.evaluatedBy.kind &&
    artifact.createdBy.id === receipt.evaluatedBy.id;
  return receipt.independent === !sameActor
    ? valid
    : invalid("evaluation independence must be derived from actor identities");
}

export function checkPromotionEvaluations(
  receipt: PromotionReceipt,
  evaluations: EvaluationReceipt[]
): LawResult {
  if (receipt.decision !== "approved") return valid;
  const reasons: string[] = [];
  if (evaluations.length === 0)
    reasons.push("promotion approval requires evaluation evidence");
  if (evaluations.some((evaluation) => evaluation.verdict !== "passed"))
    reasons.push("promotion approval requires passed evaluations");
  if (evaluations.some((evaluation) => !evaluation.independent))
    reasons.push("promotion approval requires independent evaluations");
  return reasons.length === 0 ? valid : invalid(...reasons);
}

export function checkLearningPromotion(
  receipt: PromotionReceipt,
  eligibility: EligibilityReceipt,
  artifact: LearningArtifact
): LawResult {
  const reasons: string[] = [];
  if (
    receipt.organizationId !== eligibility.organizationId ||
    receipt.eligibilityRef.id !== eligibility.id ||
    receipt.eligibilityRef.version !== eligibility.version
  )
    reasons.push("promotion does not bind the eligibility receipt version");
  if (eligibility.decision !== "eligible")
    reasons.push("blocked evidence cannot be promoted");
  if (
    artifact.organizationId !== receipt.organizationId ||
    artifact.id !== receipt.artifactRef.id ||
    artifact.version !== receipt.artifactRef.version ||
    artifact.proposalRef.id !== receipt.proposalRef.id ||
    artifact.proposalRef.version !== receipt.proposalRef.version ||
    artifact.eligibilityRef.id !== receipt.eligibilityRef.id ||
    artifact.eligibilityRef.version !== receipt.eligibilityRef.version
  )
    reasons.push("promotion does not bind the governed learning artifact");
  if (artifact.status !== "active")
    reasons.push("revoked artifacts cannot be promoted");
  if (receipt.decision === "approved" && receipt.evaluationRefs.length === 0)
    reasons.push("promotion approval requires evaluation evidence");
  return reasons.length === 0 ? valid : invalid(...reasons);
}
