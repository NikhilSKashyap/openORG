import type { CapabilityManifest, LineageAssertion } from "@openorg/protocol";
import type {
  OpenorgRecord,
  RecordQuery,
  Store,
  StoreProvider
} from "@openorg/sdk";

const fields = (record: OpenorgRecord) =>
  record as OpenorgRecord & Record<string, unknown>;
const actorId = (record: OpenorgRecord): string | undefined =>
  (fields(record).actor as { id?: string } | undefined)?.id;
const recordKind = (record: OpenorgRecord): string =>
  String(
    fields(record).recordType ??
      fields(record).kind ??
      record.id.split("-", 1)[0] ??
      record.contract
  );
const recordWorkspace = (record: OpenorgRecord): string | undefined => {
  const data = fields(record);
  if (typeof data.workspaceId === "string") return data.workspaceId;
  if (typeof data.workspace === "string") return data.workspace;
  const source = (data.provenance as { source?: string } | undefined)?.source;
  return source?.replace(/^open/i, "").toLowerCase();
};
export class MemoryStore implements Store {
  private readonly records = new Map<string, OpenorgRecord>();
  private readonly lineage = new Map<string, LineageAssertion>();
  async append(record: OpenorgRecord) {
    const key = `${record.id}@${String(fields(record).version ?? "1")}`;
    if (this.records.has(key)) throw new Error(`append-only violation: ${key}`);
    this.records.set(key, structuredClone(record));
  }
  async get(id: string) {
    const values = [...this.records.values()].filter(
      (value) => value.id === id
    );
    const value = values.at(-1);
    return value ? structuredClone(value) : null;
  }
  async query(query: RecordQuery = {}) {
    const matches = [...this.records.values()].filter(
      (record) =>
        (!query.kind ||
          record.contract === query.kind ||
          record.contract === `openorg.${query.kind}` ||
          recordKind(record) === query.kind) &&
        (!query.recordType || recordKind(record) === query.recordType) &&
        (!query.workspace || recordWorkspace(record) === query.workspace) &&
        (!query.organizationId ||
          fields(record).organizationId === query.organizationId) &&
        (!query.actor || actorId(record) === query.actor) &&
        (!query.status ||
          fields(record).status === query.status ||
          (fields(record).payload as { status?: unknown } | undefined)
            ?.status === query.status) &&
        (!query.workType ||
          (fields(record).payload as { workType?: unknown } | undefined)
            ?.workType === query.workType) &&
        (!query.since ||
          String(fields(record).recordedAt ?? fields(record).createdAt ?? "") >=
            query.since)
    );
    const visible =
      query.history === "all"
        ? matches
        : [...new Map(matches.map((record) => [record.id, record])).values()];
    return visible.map((value) => structuredClone(value));
  }
  async appendLineage(value: LineageAssertion) {
    if (this.lineage.has(value.id))
      throw new Error(`append-only violation: ${value.id}`);
    this.lineage.set(value.id, structuredClone(value));
  }
  async getLineage(id: string) {
    const value = this.lineage.get(id);
    return value ? structuredClone(value) : null;
  }
  async updateLineage(value: LineageAssertion) {
    if (!this.lineage.has(value.id))
      throw new Error(`lineage not found: ${value.id}`);
    this.lineage.set(value.id, structuredClone(value));
  }
  async trace(recordId: string) {
    return {
      record: await this.get(recordId),
      incoming: [...this.lineage.values()]
        .filter((x) => x.to.id === recordId)
        .map((value) => structuredClone(value)),
      outgoing: [...this.lineage.values()]
        .filter((x) => x.from.id === recordId)
        .map((value) => structuredClone(value))
    };
  }
}

export const createMemoryStoreProvider = (): StoreProvider => ({
  manifest: {
    contract: "openorg.capability-manifest",
    contractVersion: "1.0.0",
    id: "store-memory",
    version: "1",
    kind: "store",
    capabilities: [
      {
        id: "records",
        description: "In-process append-only records and lineage",
        permissionsRequired: [],
        inputTypes: ["openorg.*"],
        outputTypes: ["openorg.*"]
      }
    ],
    status: "available"
  } satisfies CapabilityManifest,
  store: new MemoryStore(),
  async check() {
    return {
      healthy: true,
      checkedAt: new Date().toISOString(),
      evidenceRef: { algorithm: "sha256" as const, digest: "in-process-check" }
    };
  }
});
