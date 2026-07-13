import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RoleManifestSchema, type RoleManifest } from "@openorg/manifest";
import type { LineageAssertion, VerificationReceipt } from "@openorg/protocol";
import type {
  LineageTrace,
  OpenorgClient,
  OpenorgRecord,
  RecordQuery
} from "@openorg/sdk";
import "./styles.css";

type DataRecord = OpenorgRecord & Record<string, unknown>;
type Identity = { kind: "human"; id: string; displayName?: string };
type Client = Pick<OpenorgClient, "records" | "lineage" | "subscribe">;
type WorkbenchProps = {
  manifest: unknown;
  client: Client;
  identity?: Identity;
};
type MountOptions = WorkbenchProps;
type LiveEvent = { type?: string; value?: unknown };

const data = (value: OpenorgRecord): DataRecord => value as DataRecord;
const payloadOf = (record: DataRecord): Record<string, unknown> =>
  record.payload && typeof record.payload === "object"
    ? (record.payload as Record<string, unknown>)
    : {};
const text = (value: unknown, fallback = "Unknown") =>
  typeof value === "string" && value.length > 0 ? value : fallback;
const display = (value: unknown, fallback = "Not provided") => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return fallback;
    return value
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object" && "id" in item
            ? String((item as { id: unknown }).id)
            : JSON.stringify(item)
      )
      .join(", ");
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return fallback;
};
const versionOf = (record: DataRecord) => text(record.version, "1");
const recordTitle = (record: DataRecord) =>
  text(
    payloadOf(record).title ??
      payloadOf(record).summary ??
      payloadOf(record).name ??
      record.title ??
      record.name ??
      record.label ??
      record.action,
    record.id
  );
const fieldValue = (record: DataRecord, field: string) =>
  payloadOf(record)[field] ?? record[field];
const recordStage = (record: DataRecord) =>
  text(
    payloadOf(record).stage ?? payloadOf(record).status ?? record.stage,
    "Captured"
  );
const gateKey = (from: string, to: string) => `${from}->${to}`;

function environmentIdentity(): Identity {
  const configured = (
    globalThis as typeof globalThis & { OPENORG_USER_ID?: string }
  ).OPENORG_USER_ID;
  return {
    kind: "human",
    id: configured ?? "local-user",
    displayName: configured ?? "Local user"
  };
}

function ErrorPanel({ error }: { error: unknown }) {
  const detail =
    error instanceof Error ? error.message : "The role manifest is invalid.";
  return (
    <main className="ow-shell">
      <section className="ow-empty" role="alert">
        <h1>Workbench unavailable</h1>
        <p>The role manifest could not be validated.</p>
        <code>{detail}</code>
        <p>Fix the manifest and reload this workspace.</p>
      </section>
    </main>
  );
}

function Evidence({ record }: { record: DataRecord }) {
  const payload = payloadOf(record);
  const checks = Array.isArray(payload.checks)
    ? (payload.checks as Array<{ id?: unknown; status?: unknown }>)
    : [];
  const references = ["sourceRefs", "signalRefs", "contextRefs", "decisionRefs"]
    .flatMap((key) =>
      Array.isArray(payload[key]) ? (payload[key] as Array<unknown>) : []
    )
    .map((reference) =>
      reference && typeof reference === "object" && "id" in reference
        ? String((reference as { id: unknown }).id)
        : display(reference)
    );
  const values =
    checks.length > 0
      ? checks.map(
          (check) => `${display(check.id, "check")}: ${display(check.status)}`
        )
      : references.length > 0
        ? references
        : Array.isArray(record.evidence)
          ? record.evidence
          : Array.isArray(record.evidenceRefs)
            ? record.evidenceRefs
            : [];
  if (values.length === 0)
    return <span className="ow-chip ow-muted">No evidence</span>;
  return (
    <>
      {values.map((value, index) => (
        <span className="ow-chip" key={index}>
          {typeof value === "string" ? value : `Evidence ${index + 1}`}
        </span>
      ))}
    </>
  );
}

function Home({
  manifest,
  records,
  onOpen
}: {
  manifest: RoleManifest;
  records: DataRecord[];
  onOpen: (record: DataRecord) => void;
}) {
  const attention = records.filter(
    (record) =>
      record.gateState === "failed" ||
      record.approval === "pending" ||
      record.lineageState === "proposed" ||
      payloadOf(record).status === "proposed"
  );
  return (
    <div className="ow-layout">
      <main className="ow-main">
        <div className="ow-heading">
          <div>
            <p className="ow-eyebrow">Current work</p>
            <h1>{manifest.primaryObject.label}s</h1>
          </div>
          <span className="ow-muted">{manifest.workspace}</span>
        </div>
        {records.length === 0 ? (
          <section className="ow-empty">
            <h2>No current {manifest.primaryObject.label.toLowerCase()}s</h2>
            <p>Create one to begin work in this workspace.</p>
          </section>
        ) : (
          <div className="ow-list">
            {records.map((record) => (
              <article className="ow-row" key={record.id}>
                <button className="ow-row-title" onClick={() => onOpen(record)}>
                  {recordTitle(record)}
                </button>
                <span>{recordStage(record)}</span>
                <span>
                  {text(
                    record.actor && typeof record.actor === "object"
                      ? ((
                          record.actor as {
                            displayName?: unknown;
                            id?: unknown;
                          }
                        ).displayName ?? (record.actor as { id?: unknown }).id)
                      : record.actor,
                    "Unassigned"
                  )}
                </span>
                <span className="ow-why">
                  {text(
                    payloadOf(record).rationale ??
                      payloadOf(record).desiredOutcome ??
                      payloadOf(record).intent ??
                      payloadOf(record).summary ??
                      (record.decisionRef &&
                      typeof record.decisionRef === "object"
                        ? (record.decisionRef as { id?: unknown }).id
                        : record.decisionRef),
                    "No rationale recorded"
                  )}
                </span>
                <div>
                  <Evidence record={record} />
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <aside className="ow-attention">
        <h2>Needs attention</h2>
        {attention.length === 0 ? (
          <p className="ow-muted">Nothing needs attention.</p>
        ) : (
          attention.map((record) => (
            <button key={record.id} onClick={() => onOpen(record)}>
              <strong>{recordTitle(record)}</strong>
              <span>
                {record.gateState === "failed"
                  ? "Failing gate"
                  : record.approval === "pending"
                    ? "Approval pending"
                    : "Lineage unconfirmed"}
              </span>
            </button>
          ))
        )}
      </aside>
    </div>
  );
}

function ObjectView({
  manifest,
  record,
  receipts,
  client,
  identity,
  onTrace,
  onBack
}: {
  manifest: RoleManifest;
  record: DataRecord;
  receipts: DataRecord[];
  client: Client;
  identity: Identity;
  onTrace: () => void;
  onBack: () => void;
}) {
  const [notice, setNotice] = useState("");
  const stages = manifest.home.stages;
  const stageValue = recordStage(record);
  const currentIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === stageValue)
  );
  const next = stages[currentIndex + 1];
  const transition = next
    ? gateKey(stages[currentIndex]?.id ?? "", next.id)
    : undefined;
  const gate = transition ? (manifest.gates[transition] ?? "none") : undefined;
  const policy = next?.policy ?? transition ?? "workspace policy";
  const greenReceipt = receipts.some((item) => {
    if (
      item.contract === "openorg.org-record" &&
      item.recordType === "verification"
    ) {
      const payload = payloadOf(item);
      const subjects = Array.isArray(payload.subjectRefs)
        ? (payload.subjectRefs as Array<{ id?: unknown }>)
        : [];
      return (
        payload.verdict === "passed" &&
        subjects.some((subject) => subject.id === record.id)
      );
    }
    const subject = item.subject as { id?: unknown } | undefined;
    const verdicts = item.verdicts as { status?: unknown }[] | undefined;
    return (
      item.contract === "openorg.verification-receipt" &&
      subject?.id === record.id &&
      Array.isArray(verdicts) &&
      verdicts.length > 0 &&
      verdicts.every((verdict) => verdict.status === "passed")
    );
  });
  const approve = async () => {
    if (!transition) return;
    const now = new Date().toISOString();
    const receipt: VerificationReceipt = {
      contract: "openorg.verification-receipt",
      contractVersion: "1.0.0",
      id: `approval-${record.id}-${Date.now()}`,
      workspace: manifest.workspace,
      subject: { id: record.id, version: versionOf(record) },
      actor: identity,
      policyRef: policy,
      requiredCheckIds: [],
      verdicts: [],
      humanApprovals: [
        { gateId: transition, approver: identity, approvedAt: now }
      ],
      rejectedAlternatives: [],
      measuredOutcomes: [],
      recordedAt: now
    };
    await client.records.create(receipt);
    setNotice("Approval receipt recorded.");
  };
  return (
    <main className="ow-main ow-object">
      <div className="ow-actions">
        <button onClick={onBack}>Back</button>
        <button onClick={onTrace}>Trace</button>
      </div>
      <p className="ow-eyebrow">{manifest.primaryObject.label}</p>
      <h1>{recordTitle(record)}</h1>
      <dl>
        {manifest.primaryObject.fields.map((field) => (
          <div key={field.id}>
            <dt>{field.label}</dt>
            <dd>{display(fieldValue(record, field.id))}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h2>Stage timeline</h2>
        <ol className="ow-timeline">
          {stages.map((stage, index) => (
            <li
              className={index <= currentIndex ? "is-complete" : ""}
              key={stage.id}
            >
              <span>{stage.label}</span>
              {index === currentIndex + 1 && gate && gate !== "none" ? (
                <small>
                  Locked by{" "}
                  {stage.policy ??
                    gateKey(stages[currentIndex]?.id ?? "", stage.id)}
                </small>
              ) : null}
            </li>
          ))}
        </ol>
        {next && gate === "human_approval" ? (
          <div className="ow-gate">
            <p>
              Human approval required by <strong>{policy}</strong>.
            </p>
            <button className="ow-primary" onClick={() => void approve()}>
              Approve and record receipt
            </button>
          </div>
        ) : null}
        {next && gate === "verified_receipt" && !greenReceipt ? (
          <div className="ow-gate">
            <p>
              Locked by <strong>{policy}</strong>.
            </p>
            <p>A green verification receipt for this record is missing.</p>
          </div>
        ) : null}
        {next &&
        (gate === "none" || (gate === "verified_receipt" && greenReceipt)) ? (
          <button className="ow-primary">Advance to {next.label}</button>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
      </section>
      <section>
        <h2>Linked records</h2>
        <p className="ow-muted">
          Open Trace to inspect confirmed and proposed lineage.
        </p>
      </section>
    </main>
  );
}

function TraceView({
  trace,
  identity,
  client,
  onBack
}: {
  trace: LineageTrace;
  identity: Identity;
  client: Client;
  onBack: () => void;
}) {
  const edges = [...trace.incoming, ...trace.outgoing];
  const judge = async (
    edge: LineageAssertion,
    state: "confirmed" | "rejected"
  ) => {
    await client.lineage.judge(edge.id, {
      state,
      authority: identity,
      evidenceRefs: edge.evidenceRefs
    });
  };
  return (
    <main className="ow-main">
      <div className="ow-actions">
        <button onClick={onBack}>Back to record</button>
      </div>
      <p className="ow-eyebrow">Contextual trace</p>
      <h1>{trace.record ? recordTitle(data(trace.record)) : "Record trace"}</h1>
      {edges.length === 0 ? (
        <section className="ow-empty">
          <h2>No linked records</h2>
          <p>Add lineage to make this record’s origin and impact visible.</p>
        </section>
      ) : (
        <ol className="ow-trace">
          {edges.map((edge) => {
            const other =
              edge.from.id === trace.record?.id ? edge.to : edge.from;
            return (
              <li className={`is-${edge.state}`} key={edge.id}>
                <span className="ow-glyph" aria-hidden="true">
                  ◇
                </span>
                <div>
                  <strong>{other.id}</strong>
                  <span>
                    {edge.basis} link · {edge.state}
                  </span>
                </div>
                {edge.state === "proposed" ? (
                  <div className="ow-actions">
                    <button onClick={() => void judge(edge, "confirmed")}>
                      Confirm
                    </button>
                    <button onClick={() => void judge(edge, "rejected")}>
                      Reject
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

export function Workbench(props: WorkbenchProps) {
  const parsed = useMemo(
    () => RoleManifestSchema.safeParse(props.manifest),
    [props.manifest]
  );
  if (!parsed.success) return <ErrorPanel error={parsed.error} />;
  return <ValidatedWorkbench {...props} manifest={parsed.data} />;
}

function ValidatedWorkbench({
  manifest: initial,
  client,
  identity = environmentIdentity()
}: {
  manifest: RoleManifest;
  client: Client;
  identity?: Identity;
}) {
  const [stationId, setStationId] = useState(initial.stations?.[0]?.id);
  const station = initial.stations?.find((value) => value.id === stationId);
  const manifest = useMemo(
    (): RoleManifest => ({
      ...initial,
      primaryObject: station?.primaryObject ?? initial.primaryObject,
      home: station?.home ?? initial.home
    }),
    [initial, station]
  );
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [receipts, setReceipts] = useState<DataRecord[]>([]);
  const [selected, setSelected] = useState<DataRecord>();
  const [trace, setTrace] = useState<LineageTrace>();
  const load = useCallback(async () => {
    const configuredQuery = station?.defaultQueries[0];
    const query: RecordQuery = configuredQuery
      ? Object.fromEntries(
          Object.entries(configuredQuery).filter(
            (entry): entry is [string, string] => entry[1] !== undefined
          )
        )
      : {
          workspace: manifest.workspace,
          kind: manifest.primaryObject.kind
        };
    const [items, legacyReceiptItems, verificationItems] = await Promise.all([
      client.records.list(query),
      client.records.list({ kind: "openorg.verification-receipt" }),
      client.records.list({ kind: "verification" })
    ]);
    const traced = await Promise.all(
      items.map(async (item) => {
        const itemTrace = await client.lineage.trace(item.id);
        const unconfirmed = [...itemTrace.incoming, ...itemTrace.outgoing].some(
          (edge) => edge.state === "proposed"
        );
        return unconfirmed
          ? { ...data(item), lineageState: "proposed" }
          : data(item);
      })
    );
    setRecords(traced);
    setReceipts([...legacyReceiptItems, ...verificationItems].map(data));
  }, [client, manifest, station]);
  useEffect(() => {
    void load();
    return client.subscribe((raw) => {
      const event = raw as LiveEvent;
      if (!event.value || typeof event.value !== "object") return;
      if (event.type === "record.accepted") {
        const record = event.value as DataRecord;
        if (
          record.contract === "openorg.verification-receipt" ||
          record.recordType === "verification"
        )
          setReceipts((old) =>
            old.some((item) => item.id === record.id) ? old : [record, ...old]
          );
        else if (
          (!record.workspaceId || record.workspaceId === manifest.workspace) &&
          (!record.recordType ||
            record.recordType === manifest.primaryObject.kind)
        )
          setRecords((old) =>
            old.some((item) => item.id === record.id)
              ? old.map((item) => (item.id === record.id ? record : item))
              : [record, ...old]
          );
      }
      if (
        event.type === "lineage.accepted" ||
        event.type === "lineage.judged"
      ) {
        const edge = event.value as Partial<LineageAssertion>;
        const affected = new Set([edge.from?.id, edge.to?.id]);
        setRecords((old) =>
          old.map((item) =>
            affected.has(item.id)
              ? {
                  ...item,
                  lineageState:
                    edge.state === "proposed" ? "proposed" : "confirmed"
                }
              : item
          )
        );
      }
    });
  }, [client, load, manifest]);
  const openTrace = async () => {
    if (selected) setTrace(await client.lineage.trace(selected.id));
  };
  return (
    <div className="ow-shell">
      <header className="ow-header">
        <div>
          <strong>{manifest.title}</strong>
          <span>{manifest.workspace}</span>
        </div>
        {initial.stations?.length ? (
          <label>
            Station
            <select
              value={stationId}
              onChange={(event) => {
                setStationId(event.target.value);
                setSelected(undefined);
                setTrace(undefined);
              }}
            >
              {initial.stations.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      {trace ? (
        <TraceView
          trace={trace}
          identity={identity}
          client={client}
          onBack={() => setTrace(undefined)}
        />
      ) : selected ? (
        <ObjectView
          manifest={manifest}
          record={selected}
          receipts={receipts}
          client={client}
          identity={identity}
          onTrace={() => void openTrace()}
          onBack={() => setSelected(undefined)}
        />
      ) : (
        <Home manifest={manifest} records={records} onOpen={setSelected} />
      )}
    </div>
  );
}

export function mountWorkbench(
  element: Element,
  options: MountOptions
): () => void {
  const root: Root = createRoot(element);
  root.render(<Workbench {...options} />);
  return () => root.unmount();
}

export type { Client as WorkbenchClient, MountOptions, WorkbenchProps };
