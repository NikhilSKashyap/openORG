import { createHash, createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import type { LineageAssertion, OrgRecord } from "@openorg/protocol";
import { manifest } from "./manifest";

const read = (request: IncomingMessage) =>
  new Promise<Record<string, string>>((resolve, reject) => {
    let value = "";
    request.on("data", (chunk) => (value += chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(value || "{}") as Record<string, string>);
      } catch (error) {
        reject(error);
      }
    });
  });
const send = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};
const contentRef = (value: string) => ({
  algorithm: "sha256" as const,
  digest: createHash("sha256").update(value).digest("hex"),
  mediaType: "application/json"
});
const post = async (baseUrl: string, path: string, body: unknown) => {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok)
    throw Object.assign(new Error(text), {
      status: response.status,
      body: parsed
    });
  return parsed;
};
const safeId = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "unknown";

function api(
  baseUrl: string,
  organizationId: string,
  key: string,
  keyId: string
): Plugin {
  return {
    name: "open-gtm-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "POST" || request.url !== "/api/signals")
          return next();
        try {
          const body = await read(request);
          const now = new Date().toISOString();
          const sourceId = `source-${crypto.randomUUID()}`;
          const signalId = `signal-${crypto.randomUUID()}`;
          const evidence = contentRef(JSON.stringify(body));
          const accountRef = {
            type: "account" as const,
            id: `account-${safeId(body.account ?? "unknown")}`,
            displayName: body.account
          };
          const sourcePointer = {
            system: safeId(body.source ?? "unknown"),
            externalId: body.sourceId,
            contentRef: evidence,
            capturedAt: now
          };
          const access = {
            classification: (body.classification || "confidential") as
              "public" | "internal" | "confidential" | "restricted",
            policyIds: ["customer-data"],
            permissions: ["account:read"]
          };
          const common = {
            contract: "openorg.org-record" as const,
            contractVersion: "0.2.0" as const,
            version: "1",
            organizationId,
            workspaceId: manifest.workspace,
            occurredAt: now,
            recordedAt: now,
            actor: { kind: "human" as const, id: "gtm-user" },
            subjectRefs: [accountRef],
            source: sourcePointer,
            access
          };
          const source: OrgRecord = {
            ...common,
            id: sourceId,
            recordType: "source",
            payload: {
              sourceType: "other",
              title: `${body.source} interaction with ${body.account}`,
              excerpt: body.exactQuote || body.summary,
              contentRef: evidence
            }
          };
          const unsigned: OrgRecord = {
            ...common,
            id: signalId,
            recordType: "signal",
            payload: {
              title: body.summary,
              summary: body.summary,
              exactQuote: body.exactQuote || undefined,
              severity: (body.severity || "medium") as
                "low" | "medium" | "high" | "critical",
              status: "captured",
              desiredOutcome: body.desiredOutcome || undefined,
              urgency: body.urgency || undefined,
              sourceRefs: [{ id: sourceId, version: "1" }]
            }
          };
          const value = createHmac("sha256", key)
            .update(JSON.stringify(unsigned))
            .digest("hex");
          const signal: OrgRecord = {
            ...unsigned,
            integrity: { algorithm: "hmac-sha256", keyId, value }
          };
          await post(baseUrl, "/api/records", source);
          await post(baseUrl, "/api/records", signal);
          const lineage: LineageAssertion = {
            contract: "openorg.lineage-assertion",
            contractVersion: "1.0.0",
            id: `lineage-${sourceId}-${signalId}`,
            from: { id: sourceId, version: "1" },
            to: { id: signalId, version: "1" },
            relationship: "derived_from",
            basis: "observed",
            state: "confirmed",
            authority: {
              kind: "service",
              id: "openGTM-capture",
              version: "1"
            },
            evidenceRefs: [evidence],
            assertedAt: now
          };
          await post(baseUrl, "/api/lineage", lineage);
          send(response, 201, signal);
        } catch (error) {
          const value = error as Error & { status?: number; body?: unknown };
          send(
            response,
            value.status ?? 500,
            value.body ?? { error: value.message }
          );
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.OPENORG_URL || "http://localhost:4700";
  return {
    plugins: [
      api(
        target,
        env.OPENORG_ORG_ID || "local-org",
        env.OPENORG_WORKSPACE_KEY || "gtm-local-development-key",
        env.OPENORG_WORKSPACE_KEY_ID || "gtm-local"
      )
    ],
    server: { port: 4730, strictPort: true, proxy: { "/api": { target } } }
  };
});
