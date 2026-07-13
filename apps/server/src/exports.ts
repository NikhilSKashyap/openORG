import type {
  EvaluationSuite,
  OrgRecord,
  RecordRef,
  VerificationReceipt
} from "@openorg/protocol";
import type { LineageTrace, OpenorgRecord, Store } from "@openorg/sdk";

export type ExportShape = "rag" | "evaluation" | "preference" | "sft";
export type GovernedExport = {
  body: string;
  includedRecordRefs: RecordRef[];
  exclusions: string[];
};

const isOrgRecord = (record: OpenorgRecord | undefined): record is OrgRecord =>
  record?.contract === "openorg.org-record" && "recordType" in record;
const isEvaluationSuite = (
  record: OpenorgRecord | undefined
): record is EvaluationSuite =>
  record?.contract === "olp.evaluation-suite" ||
  record?.contract === "openorg.evaluation-suite";
const asRef = (record: OpenorgRecord): RecordRef => ({
  id: record.id,
  version: (record as OpenorgRecord & { version?: string }).version ?? "1"
});
const resolvedPayload = (record: OpenorgRecord | undefined) =>
  isOrgRecord(record) ? JSON.stringify(record.payload) : undefined;

const verificationRecordsFor = (
  record: OrgRecord,
  trace: LineageTrace,
  byId: ReadonlyMap<string, OpenorgRecord>
) =>
  [...trace.incoming, ...trace.outgoing]
    .filter(
      (edge) =>
        edge.relationship === "verifies" &&
        edge.state === "confirmed" &&
        (edge.from.id === record.id || edge.to.id === record.id)
    )
    .flatMap((edge) => {
      const otherId = edge.from.id === record.id ? edge.to.id : edge.from.id;
      const value = byId.get(otherId);
      return value ? [value] : [];
    });

export function isSftEligible(
  record: OrgRecord,
  trace: LineageTrace,
  byId: ReadonlyMap<string, OpenorgRecord>
): boolean {
  if (
    record.recordType !== "work" ||
    record.payload.workType !== "task" ||
    record.payload.status !== "completed"
  )
    return false;
  return verificationRecordsFor(record, trace, byId).some((related) => {
    if (isOrgRecord(related))
      return (
        related.recordType === "verification" &&
        related.payload.verdict === "passed" &&
        related.payload.independent
      );
    if (related.contract !== "openorg.verification-receipt") return false;
    const receipt = related as unknown as VerificationReceipt;
    return (
      receipt.verdicts.length > 0 &&
      receipt.verdicts.every(
        (verdict) => verdict.status === "passed" && !verdict.selfVerification
      )
    );
  });
}

export async function buildGovernedExport(
  shape: ExportShape,
  all: readonly OpenorgRecord[],
  store: Store
): Promise<GovernedExport> {
  const records = all.filter((record): record is OrgRecord =>
    isOrgRecord(record)
  );
  const byId = new Map(all.map((record) => [record.id, record]));
  const included = new Map<string, RecordRef>();
  const exclusions: string[] = [];
  let lines: unknown[] = [];

  if (shape === "rag") {
    lines = records.map((record) => {
      included.set(record.id, asRef(record));
      return {
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
      };
    });
  } else if (shape === "evaluation") {
    const suites = all.filter((record): record is EvaluationSuite =>
      isEvaluationSuite(record)
    );
    lines = suites.flatMap((suite) => {
      included.set(suite.id, asRef(suite));
      for (const value of suite.cases)
        for (const source of value.sourceRefs) included.set(source.id, source);
      return suite.cases.map((value) => ({
        suiteId: suite.id,
        case: value,
        metadata: {
          organizationId: suite.organizationId,
          workspaceId: suite.workspaceId,
          provenancePreserved: true
        }
      }));
    });
  } else if (shape === "preference") {
    lines = records
      .filter((record) => record.recordType === "correction")
      .map((record) => {
        included.set(record.id, asRef(record));
        included.set(record.payload.originalRef.id, record.payload.originalRef);
        included.set(
          record.payload.correctedRef.id,
          record.payload.correctedRef
        );
        return {
          prompt: record.payload.reason,
          chosen:
            record.payload.preferredContent ??
            resolvedPayload(byId.get(record.payload.correctedRef.id)),
          rejected:
            record.payload.rejectedContent ??
            resolvedPayload(byId.get(record.payload.originalRef.id)),
          metadata: { correctionId: record.id }
        };
      });
  } else {
    const accepted: unknown[] = [];
    for (const record of records) {
      if (record.recordType !== "work" || record.payload.workType !== "task")
        continue;
      const trace = await store.trace(record.id);
      if (!isSftEligible(record, trace, byId)) {
        exclusions.push(
          `${record.id}: requires completed task work and confirmed independent passing verification`
        );
        continue;
      }
      const contextIds = new Set([
        ...trace.incoming.map((edge) => edge.from.id),
        ...record.payload.contextRefs.map((ref) => ref.id),
        ...record.payload.decisionRefs.map((ref) => ref.id)
      ]);
      const context = [...contextIds]
        .map((id) => byId.get(id))
        .filter((value): value is OrgRecord => isOrgRecord(value))
        .map((value) => {
          included.set(value.id, asRef(value));
          return resolvedPayload(value);
        });
      included.set(record.id, asRef(record));
      for (const verifier of verificationRecordsFor(record, trace, byId))
        included.set(verifier.id, asRef(verifier));
      accepted.push({
        messages: [
          {
            role: "system",
            content: "Use only the cited organizational context."
          },
          { role: "user", content: JSON.stringify(context) },
          { role: "assistant", content: resolvedPayload(record) }
        ],
        metadata: {
          recordId: record.id,
          verified: true,
          independentVerification: true
        }
      });
    }
    lines = accepted;
  }
  return {
    body: lines.map((line) => JSON.stringify(line)).join("\n"),
    includedRecordRefs: [...included.values()],
    exclusions
  };
}
