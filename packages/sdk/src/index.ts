import type {
  CapabilityManifest,
  ContentRef,
  DatasetManifest,
  EvaluationSuite,
  ExportRequest,
  LineageAssertion,
  ModelArtifact,
  ModelEvaluation,
  PromotionReceipt,
  RecordRef,
  RoutingDecision,
  TrainingJob,
  WorkRecord
} from "@openorg/protocol";

export type OpenorgRecord = { contract: string; id: string };
export type RecordQuery = {
  kind?: string;
  recordType?: string;
  workspace?: string;
  organizationId?: string;
  actor?: string;
  status?: string;
  workType?: string;
  since?: string;
  history?: "all";
};
export type LineageTrace = {
  record: OpenorgRecord | null;
  incoming: LineageAssertion[];
  outgoing: LineageAssertion[];
};
export type Store = {
  append(record: OpenorgRecord): Promise<void>;
  get(id: string): Promise<OpenorgRecord | null>;
  query(query?: RecordQuery): Promise<OpenorgRecord[]>;
  appendLineage(assertion: LineageAssertion): Promise<void>;
  getLineage(id: string): Promise<LineageAssertion | null>;
  updateLineage(assertion: LineageAssertion): Promise<void>;
  trace(recordId: string): Promise<LineageTrace>;
  close?(): Promise<void>;
};

export type ProviderCheck = {
  healthy: boolean;
  evidenceRef?: CapabilityManifest["evidenceRef"];
  checkedAt?: string;
};
export type StoreProvider = {
  manifest: CapabilityManifest;
  store: Store;
  check?(): Promise<ProviderCheck>;
};
export type MemoryProvider = {
  manifest: CapabilityManifest;
  remember(value: unknown): Promise<string>;
  recall(id: string): Promise<unknown>;
};
export type TraceProvider = {
  manifest: CapabilityManifest;
  emit(event: unknown): Promise<void>;
};
export type HarnessProvider = {
  manifest: CapabilityManifest;
  run(input: unknown): Promise<unknown>;
};
export type SkillProvider = {
  manifest: CapabilityManifest;
  invoke(input: unknown): Promise<unknown>;
};

export type ModelInvocation = {
  caseId: string;
  prompt: string;
};
export type ModelInvocationResult = {
  output: string;
  modelId: string;
  latencyMs?: number;
  cost?: { amount: number; currency: string };
  evidenceRefs?: ContentRef[];
};
export type ModelProvider = {
  manifest: CapabilityManifest;
  modelId: string;
  invoke(input: ModelInvocation): Promise<ModelInvocationResult>;
};

export type TrainingAdapterInput = {
  organizationId: string;
  datasetRef: RecordRef;
  parameters: Record<string, unknown>;
};
export type TrainingAdapter = {
  manifest: CapabilityManifest;
  train(input: TrainingAdapterInput): Promise<{
    artifact: ModelArtifact;
    job: TrainingJob;
  }>;
};

type RequestOptions = { method?: string; body?: unknown };
type ClientOptions = { token?: string };
type EventSourceLike = {
  onmessage: ((event: { data: string }) => void) | null;
  close(): void;
};
type EventSourceFactory = new (url: URL) => EventSourceLike;
export function createOpenorgClient(
  baseUrl: string,
  clientOptions: ClientOptions = {}
) {
  const request = async <T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> => {
    const init: RequestInit = {};
    if (options.method) init.method = options.method;
    const headers: Record<string, string> = {};
    if (clientOptions.token)
      headers.authorization = `Bearer ${clientOptions.token}`;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    if (Object.keys(headers).length > 0) init.headers = headers;
    const response = await fetch(new URL(path, baseUrl), init);
    if (!response.ok)
      throw new Error(`${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  const exportDataset = async (
    shape: "rag" | "evaluation" | "preference" | "sft",
    value: ExportRequest
  ) => {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (clientOptions.token)
      headers.authorization = `Bearer ${clientOptions.token}`;
    const response = await fetch(
      new URL(`/api/export/${encodeURIComponent(shape)}`, baseUrl),
      { method: "POST", headers, body: JSON.stringify(value) }
    );
    if (!response.ok)
      throw new Error(`${response.status}: ${await response.text()}`);
    return {
      body: await response.text(),
      datasetManifestId:
        response.headers.get("x-openorg-dataset-manifest-id") ?? "",
      egressReceiptId:
        response.headers.get("x-openorg-egress-receipt-id") ?? undefined
    };
  };
  return {
    records: {
      create: (record: OpenorgRecord) =>
        request<OpenorgRecord>("/api/records", {
          method: "POST",
          body: record
        }),
      list: (query: RecordQuery = {}) =>
        request<OpenorgRecord[]>(
          `/api/records?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined))}`
        ),
      get: (id: string) =>
        request<OpenorgRecord>(`/api/records/${encodeURIComponent(id)}`)
    },
    lineage: {
      create: (value: LineageAssertion) =>
        request<LineageAssertion>("/api/lineage", {
          method: "POST",
          body: value
        }),
      judge: (id: string, value: unknown) =>
        request<LineageAssertion>(
          `/api/lineage/${encodeURIComponent(id)}/judge`,
          { method: "POST", body: value }
        ),
      trace: (id: string) =>
        request<LineageTrace>(`/api/lineage/trace/${encodeURIComponent(id)}`)
    },
    journey: (id: string) =>
      request<unknown>(`/api/journey/${encodeURIComponent(id)}`),
    providers: {
      list: () => request<CapabilityManifest[]>("/api/providers"),
      register: (manifest: CapabilityManifest) =>
        request<CapabilityManifest>("/api/providers", {
          method: "POST",
          body: manifest
        }),
      check: (id: string) =>
        request<CapabilityManifest>(
          `/api/providers/${encodeURIComponent(id)}/check`,
          { method: "POST" }
        )
    },
    exports: { create: exportDataset },
    learning: {
      evaluate: (suiteId: string, providerIds: string[]) =>
        request<ModelEvaluation[]>("/api/learning/evaluate", {
          method: "POST",
          body: { suiteId, providerIds }
        }),
      route: (policyId: string, evaluationIds: string[]) =>
        request<RoutingDecision>("/api/learning/route", {
          method: "POST",
          body: { policyId, evaluationIds }
        }),
      trainLocalLogistic: (
        datasetId: DatasetManifest["id"],
        examples: { features: number[]; label: 0 | 1 }[]
      ) =>
        request<{ artifact: ModelArtifact; job: TrainingJob }>(
          "/api/learning/train/local-logistic",
          { method: "POST", body: { datasetId, examples } }
        ),
      promote: (organizationId: string, workspaceId: string) =>
        request<{ suite?: EvaluationSuite; createdRecordIds: string[] }>(
          "/api/learning/promote",
          { method: "POST", body: { organizationId, workspaceId } }
        ),
      promoteArtifact: (value: {
        artifactId: string;
        evaluationReceiptIds: string[];
        decision: PromotionReceipt["decision"];
        target: PromotionReceipt["target"];
        reasons: string[];
        rollbackOf?: PromotionReceipt["rollbackOf"];
      }) =>
        request<PromotionReceipt>("/api/learning/promotions", {
          method: "POST",
          body: value
        }),
      approvePolicy: (id: string, evaluationReceiptIds: string[]) =>
        request<OpenorgRecord>(
          `/api/learning/policies/${encodeURIComponent(id)}/approve`,
          { method: "POST", body: { evaluationReceiptIds } }
        )
    },
    subscribe(listener: (event: unknown) => void): () => void {
      if (clientOptions.token)
        throw new Error(
          "authenticated SSE requires an EventSource implementation with header support"
        );
      const EventSourceConstructor = (
        globalThis as unknown as { EventSource?: EventSourceFactory }
      ).EventSource;
      if (!EventSourceConstructor)
        throw new Error("EventSource is unavailable in this runtime");
      const source = new EventSourceConstructor(
        new URL("/api/events/stream", baseUrl)
      );
      source.onmessage = (event) => listener(JSON.parse(event.data) as unknown);
      return () => source.close();
    }
  };
}

export type OpenorgClient = ReturnType<typeof createOpenorgClient>;

export async function signWorkRecord(
  record: WorkRecord,
  key = process.env.OPENORG_WORKSPACE_KEY,
  keyId = process.env.OPENORG_WORKSPACE_KEY_ID ?? "local-workspace"
): Promise<WorkRecord> {
  if (!key) throw new Error("OPENORG_WORKSPACE_KEY is required");
  const unsigned = { ...record, signature: undefined };
  const encoder = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(JSON.stringify(unsigned))
  );
  const value = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { ...record, signature: { algorithm: "hmac-sha256", keyId, value } };
}
