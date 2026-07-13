import type {
  CapabilityManifest,
  LineageAssertion,
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

type RequestOptions = { method?: string; body?: unknown };
type EventSourceLike = {
  onmessage: ((event: { data: string }) => void) | null;
  close(): void;
};
type EventSourceFactory = new (url: URL) => EventSourceLike;
export function createOpenorgClient(baseUrl: string) {
  const request = async <T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> => {
    const init: RequestInit = {};
    if (options.method) init.method = options.method;
    if (options.body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(new URL(path, baseUrl), init);
    if (!response.ok)
      throw new Error(`${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
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
    subscribe(listener: (event: unknown) => void): () => void {
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
