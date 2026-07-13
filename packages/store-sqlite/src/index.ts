import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { CapabilityManifest, LineageAssertion } from "@openorg/protocol";
import type {
  LineageTrace,
  OpenorgRecord,
  RecordQuery,
  Store,
  StoreProvider
} from "@openorg/sdk";

const fields = (record: OpenorgRecord) =>
  record as OpenorgRecord & Record<string, unknown>;
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

export class SqliteStore implements Store {
  private readonly db: Database.Database;
  constructor(path = process.env.OPENORG_DB_PATH ?? ".openorg/records.db") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL, workspace TEXT, actor TEXT, status TEXT, recorded_at TEXT, body TEXT NOT NULL, PRIMARY KEY(id, version)); CREATE TABLE IF NOT EXISTS lineage (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL)"
    );
  }
  async append(record: OpenorgRecord) {
    const data = fields(record);
    const actor = (data.actor as { id?: string } | undefined)?.id;
    this.db
      .prepare("INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        record.id,
        String(data.version ?? "1"),
        recordKind(record),
        recordWorkspace(record) ?? null,
        actor ?? null,
        data.status ??
          (data.payload as { status?: unknown } | undefined)?.status ??
          null,
        data.recordedAt ?? data.createdAt ?? null,
        JSON.stringify(record)
      );
  }
  async get(id: string) {
    const row = this.db
      .prepare(
        "SELECT body FROM records WHERE id=? ORDER BY rowid DESC LIMIT 1"
      )
      .get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as OpenorgRecord) : null;
  }
  async query(query: RecordQuery = {}) {
    const clauses: string[] = [];
    const values: string[] = [];
    const add = (column: string, value?: string) => {
      if (value) {
        clauses.push(`${column}=?`);
        values.push(value);
      }
    };
    if (query.kind) {
      clauses.push("(kind=? OR kind=? OR json_extract(body, '$.contract')=?)");
      values.push(query.kind, `openorg.${query.kind}`, query.kind);
    }
    if (query.recordType) {
      clauses.push("kind=?");
      values.push(query.recordType);
    }
    add("workspace", query.workspace);
    if (query.organizationId) {
      clauses.push("json_extract(body, '$.organizationId')=?");
      values.push(query.organizationId);
    }
    add("actor", query.actor);
    add("status", query.status);
    if (query.workType) {
      clauses.push("json_extract(body, '$.payload.workType')=?");
      values.push(query.workType);
    }
    if (query.since) {
      clauses.push("recorded_at>=?");
      values.push(query.since);
    }
    const rows = this.db
      .prepare(
        `SELECT body FROM records${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY rowid`
      )
      .all(...values) as { body: string }[];
    const records = rows.map((row) => JSON.parse(row.body) as OpenorgRecord);
    return query.history === "all"
      ? records
      : [...new Map(records.map((record) => [record.id, record])).values()];
  }
  async appendLineage(value: LineageAssertion) {
    this.db
      .prepare("INSERT INTO lineage VALUES (?, ?, ?, ?)")
      .run(value.id, value.from.id, value.to.id, JSON.stringify(value));
  }
  async getLineage(id: string) {
    const row = this.db
      .prepare("SELECT body FROM lineage WHERE id=?")
      .get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as LineageAssertion) : null;
  }
  async updateLineage(value: LineageAssertion) {
    const result = this.db
      .prepare("UPDATE lineage SET from_id=?, to_id=?, body=? WHERE id=?")
      .run(value.from.id, value.to.id, JSON.stringify(value), value.id);
    if (!result.changes) throw new Error(`lineage not found: ${value.id}`);
  }
  async trace(recordId: string): Promise<LineageTrace> {
    const rows = this.db
      .prepare(
        "SELECT body FROM lineage WHERE from_id=? OR to_id=? ORDER BY rowid"
      )
      .all(recordId, recordId) as { body: string }[];
    const all = rows.map((row) => JSON.parse(row.body) as LineageAssertion);
    return {
      record: await this.get(recordId),
      incoming: all.filter((x) => x.to.id === recordId),
      outgoing: all.filter((x) => x.from.id === recordId)
    };
  }
  async close() {
    this.db.close();
  }
}

export const createSqliteStoreProvider = (path?: string): StoreProvider => ({
  manifest: {
    contract: "openorg.capability-manifest",
    contractVersion: "1.0.0",
    id: "store-sqlite",
    version: "1",
    kind: "store",
    capabilities: [
      {
        id: "records",
        description: "SQLite append-only records and lineage",
        permissionsRequired: [],
        inputTypes: ["openorg.*"],
        outputTypes: ["openorg.*"]
      }
    ],
    status: "available"
  } satisfies CapabilityManifest,
  store: path === undefined ? new SqliteStore() : new SqliteStore(path),
  async check() {
    return {
      healthy: true,
      checkedAt: new Date().toISOString(),
      evidenceRef: { algorithm: "sha256" as const, digest: "sqlite-check" }
    };
  }
});
