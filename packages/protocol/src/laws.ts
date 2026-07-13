import type { LineageAssertion } from "./lineage-assertion.js";
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
