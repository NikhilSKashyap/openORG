import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import type { LineageAssertion, OrgRecord } from "@openorg/protocol";
import { manifest } from "./manifest";

export function normalizeRoleProductBody(body: Record<string, any>) {
  const signalRefs = Array.isArray(body.signalRefs)
    ? body.signalRefs
    : Array.isArray(body.signalIds)
      ? body.signalIds
      : [];
  const decisionRefs = Array.isArray(body.decisionRefs)
    ? body.decisionRefs
    : body.decisionRef == null
      ? []
      : [body.decisionRef];
  const successMetrics = Array.isArray(body.successMetrics)
    ? body.successMetrics
    : body.metric == null
      ? []
      : [{ name: body.metric, target: body.target, value: body.value ?? 0 }];
  return { ...body, signalRefs, decisionRefs, successMetrics } as Record<
    string,
    any
  > & {
    signalRefs: any[];
    decisionRefs: any[];
    successMetrics: any[];
  };
}

const read = (request: IncomingMessage) =>
  new Promise<Record<string, any>>((resolve, reject) => {
    let value = "";
    request.on("data", (chunk) => (value += chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(value || "{}") as Record<string, any>);
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
const get = async <T>(baseUrl: string, path: string): Promise<T> => {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok)
    throw Object.assign(new Error(await response.text()), {
      status: response.status
    });
  return response.json() as Promise<T>;
};
const post = async <T>(
  baseUrl: string,
  path: string,
  body: unknown
): Promise<T> => {
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
  return parsed as T;
};

function api(baseUrl: string, organizationId: string): Plugin {
  return {
    name: "open-pm-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const approval = request.url?.match(
          /^\/api\/initiatives\/([^/]+)\/approve$/
        );
        if (
          request.method !== "POST" ||
          (request.url !== "/api/initiatives" && !approval)
        )
          return next();
        try {
          const rawBody = await read(request);
          const body = normalizeRoleProductBody(rawBody);
          const now = new Date().toISOString();
          const evidence = contentRef(JSON.stringify(rawBody));
          if (approval) {
            const id = decodeURIComponent(approval[1]!);
            const current = await get<OrgRecord>(
              baseUrl,
              `/api/records/${encodeURIComponent(id)}`
            );
            if (current.recordType !== "decision")
              throw new Error("only decisions can be approved");
            const decision: OrgRecord = {
              ...current,
              version: String(Number(current.version) + 1),
              occurredAt: now,
              recordedAt: now,
              actor: { kind: "human", id: body.approverId || "pm-user" },
              source: {
                system: "openPM",
                externalId: `approval-${id}`,
                contentRef: evidence,
                capturedAt: now
              },
              supersedes: { id: current.id, version: current.version },
              payload: { ...current.payload, status: "approved" }
            };
            await post(baseUrl, "/api/records", decision);
            const verificationId = `verification-${crypto.randomUUID()}`;
            const verification: OrgRecord = {
              contract: "openorg.org-record",
              contractVersion: "0.2.0",
              id: verificationId,
              version: "1",
              organizationId,
              workspaceId: manifest.workspace,
              recordType: "verification",
              occurredAt: now,
              recordedAt: now,
              actor: { kind: "human", id: body.approverId || "pm-user" },
              subjectRefs: current.subjectRefs,
              source: {
                system: "openPM",
                externalId: `approval-${id}`,
                contentRef: evidence,
                capturedAt: now
              },
              access: current.access,
              payload: {
                title: `Approve ${current.payload.title}`,
                policyRef: "pm-decision-approval",
                subjectRefs: [{ id, version: decision.version }],
                verdict: "passed",
                independent: false,
                checks: [],
                humanApprovals: [
                  {
                    approver: {
                      kind: "human",
                      id: body.approverId || "pm-user"
                    },
                    approvedAt: now
                  }
                ]
              }
            };
            await post(baseUrl, "/api/records", verification);
            await post(baseUrl, "/api/lineage", {
              contract: "openorg.lineage-assertion",
              contractVersion: "1.0.0",
              id: `lineage-${verificationId}-${id}`,
              from: { id: verificationId, version: "1" },
              to: { id, version: decision.version },
              relationship: "verifies",
              basis: "asserted",
              state: "confirmed",
              authority: { kind: "human", id: body.approverId || "pm-user" },
              evidenceRefs: [evidence],
              assertedAt: now
            } satisfies LineageAssertion);
            return send(response, 201, { decision, verification });
          }

          const signalRefs = Array.isArray(body.signalRefs)
            ? body.signalRefs.map(String)
            : [];
          if (signalRefs.length === 0)
            return send(response, 400, {
              error: "decision requires customer signals"
            });
          const id = `decision-${crypto.randomUUID()}`;
          const signal = await get<OrgRecord>(
            baseUrl,
            `/api/records/${encodeURIComponent(signalRefs[0]!)}`
          );
          const decision: OrgRecord = {
            contract: "openorg.org-record",
            contractVersion: "0.2.0",
            id,
            version: "1",
            organizationId,
            workspaceId: manifest.workspace,
            recordType: "decision",
            occurredAt: now,
            recordedAt: now,
            actor: {
              kind: "human",
              id: "pm-user",
              displayName: "Product owner"
            },
            subjectRefs: [
              ...signal.subjectRefs,
              { type: "initiative", id, displayName: String(body.title) }
            ],
            source: {
              system: "openPM",
              externalId: id,
              contentRef: evidence,
              capturedAt: now
            },
            access: signal.access,
            payload: {
              title: String(body.title),
              problem: String(body.problem),
              rationale: String(body.rationale),
              alternatives: (body.alternatives ?? []).map((title: string) => ({
                title
              })),
              scope: body.scope ?? [],
              nonGoals: body.nonGoals ?? [],
              successMetrics: body.successMetrics.map(
                (metric: Record<string, any>) => ({
                  name: String(metric.name),
                  value: Number(metric.value),
                  target: Number(metric.target)
                })
              ),
              status: "proposed",
              signalRefs: signalRefs.map((signalId: string) => ({
                id: signalId,
                version: "1"
              })),
              constraintRefs: []
            }
          };
          await post(baseUrl, "/api/records", decision);
          for (const signalId of signalRefs) {
            await post(baseUrl, "/api/lineage", {
              contract: "openorg.lineage-assertion",
              contractVersion: "1.0.0",
              id: `lineage-${signalId}-${id}`,
              from: { id: signalId, version: "1" },
              to: { id, version: "1" },
              relationship: "motivates",
              basis: "asserted",
              state: "confirmed",
              authority: {
                kind: "human",
                id: "pm-user",
                displayName: "Product owner"
              },
              evidenceRefs: [evidence],
              assertedAt: now
            } satisfies LineageAssertion);
          }
          send(response, 201, decision);
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
    plugins: [api(target, env.OPENORG_ORG_ID || "local-org")],
    server: { port: 4720, strictPort: true, proxy: { "/api": { target } } }
  };
});
