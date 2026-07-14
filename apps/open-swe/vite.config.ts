import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { defineConfig, loadEnv, type Plugin } from "vite";
import type { LineageAssertion, OrgRecord } from "@openorg/protocol";

const run = promisify(execFile);

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
const contentRef = (value: string, mediaType = "application/json") => ({
  algorithm: "sha256" as const,
  digest: createHash("sha256").update(value).digest("hex"),
  mediaType
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
const edge = (
  id: string,
  from: string,
  to: string,
  relationship: LineageAssertion["relationship"],
  now: string,
  evidence: ReturnType<typeof contentRef>,
  authority: NonNullable<LineageAssertion["authority"]>,
  basis: LineageAssertion["basis"] = "observed",
  fromVersion = "1",
  toVersion = "1"
): LineageAssertion => ({
  contract: "openorg.lineage-assertion",
  contractVersion: "1.0.0",
  id,
  from: { id: from, version: fromVersion },
  to: { id: to, version: toVersion },
  relationship,
  basis,
  state: "confirmed",
  authority,
  evidenceRefs: [evidence],
  assertedAt: now
});

function api(
  baseUrl: string,
  organizationId: string,
  harnessCwd: string
): Plugin {
  return {
    name: "open-fde-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const operation = request.url?.match(
          /^\/api\/work\/([^/]+)\/(actions|artifacts|verify|outcomes)$/
        );
        if (
          request.method !== "POST" ||
          (!operation && request.url !== "/api/work")
        )
          return next();
        try {
          const rawBody = await read(request);
          const body = operation ? rawBody : normalizeRoleProductBody(rawBody);
          const now = new Date().toISOString();
          if (!operation) {
            const decision = await get<OrgRecord>(
              baseUrl,
              `/api/records/${encodeURIComponent(String(body.decisionRefs[0]))}`
            );
            if (
              decision.recordType !== "decision" ||
              decision.payload.status !== "approved"
            ) {
              return send(response, 409, {
                error: "delivery work requires an approved PM decision"
              });
            }
            const workId = `work-${crypto.randomUUID()}`;
            const evidence = contentRef(JSON.stringify(rawBody));
            const workspaceId = ["fde", "swe", "mle"].includes(body.station)
              ? body.station
              : "fde";
            const common = {
              contract: "openorg.org-record" as const,
              contractVersion: "0.2.0" as const,
              version: "1",
              organizationId,
              workspaceId,
              occurredAt: now,
              recordedAt: now,
              actor: { kind: "human" as const, id: `${workspaceId}-user` },
              subjectRefs: decision.subjectRefs,
              source: {
                system: "openSWE",
                externalId: workId,
                contentRef: evidence,
                capturedAt: now
              },
              access: decision.access
            };
            const work: OrgRecord = {
              ...common,
              id: workId,
              recordType: "work",
              payload: {
                title: String(body.title),
                intent: String(body.intent),
                workType: "task",
                status: "in_progress",
                stage: "build",
                decisionRefs: [{ id: decision.id, version: decision.version }],
                contextRefs: decision.payload.signalRefs,
                components: (body.components ?? []).map((id: string) => ({
                  kind: "tool",
                  id
                })),
                changes: []
              }
            };
            await post(baseUrl, "/api/records", work);
            await post(
              baseUrl,
              "/api/lineage",
              edge(
                `lineage-${decision.id}-${workId}`,
                decision.id,
                workId,
                "authorizes",
                now,
                evidence,
                common.actor,
                "asserted",
                decision.version
              )
            );
            for (const description of body.constraints ?? []) {
              const constraintId = `constraint-${crypto.randomUUID()}`;
              const constraint: OrgRecord = {
                ...common,
                id: constraintId,
                recordType: "constraint",
                payload: {
                  title: String(description),
                  description: String(description),
                  category: "other",
                  hard: true
                }
              };
              await post(baseUrl, "/api/records", constraint);
              await post(
                baseUrl,
                "/api/lineage",
                edge(
                  `lineage-${constraintId}-${workId}`,
                  constraintId,
                  workId,
                  "constrains",
                  now,
                  evidence,
                  common.actor,
                  "asserted"
                )
              );
            }
            return send(response, 201, work);
          }

          const workId = decodeURIComponent(operation[1]!);
          const kind = operation[2]!;
          const work = await get<OrgRecord>(
            baseUrl,
            `/api/records/${encodeURIComponent(workId)}`
          );
          if (work.recordType !== "work")
            return send(response, 400, {
              error: "operation requires a work record"
            });
          const workspaceId = work.workspaceId;
          const evidence = contentRef(JSON.stringify(body));
          const common = {
            contract: "openorg.org-record" as const,
            contractVersion: "0.2.0" as const,
            version: "1",
            organizationId,
            workspaceId,
            occurredAt: now,
            recordedAt: now,
            actor: { kind: "human" as const, id: `${workspaceId}-user` },
            subjectRefs: work.subjectRefs,
            source: {
              system: "openSWE",
              externalId: `${kind}-${workId}`,
              contentRef: evidence,
              capturedAt: now
            },
            access: work.access
          };

          if (kind === "actions") {
            const id = `action-${crypto.randomUUID()}`;
            const action: OrgRecord = {
              ...common,
              id,
              recordType: "work",
              payload: {
                title: String(body.action || "Recorded delivery action"),
                intent: String(body.action || "Record delivery progress"),
                workType: "human_action",
                status: "completed",
                stage: "build",
                decisionRefs: work.payload.decisionRefs,
                contextRefs: [{ id: workId, version: work.version }],
                components: work.payload.components,
                changes: []
              }
            };
            await post(baseUrl, "/api/records", action);
            await post(
              baseUrl,
              "/api/lineage",
              edge(
                `lineage-${workId}-${id}`,
                workId,
                id,
                "implements",
                now,
                evidence,
                common.actor,
                "observed",
                work.version
              )
            );
            return send(response, 201, action);
          }

          if (kind === "artifacts") {
            const text = String(body.text || "");
            if (!text)
              return send(response, 400, {
                error: "artifact content is required"
              });
            const artifactEvidence = contentRef(text, "text/plain");
            const id = `artifact-${crypto.randomUUID()}`;
            const artifact: OrgRecord = {
              ...common,
              id,
              source: {
                system: "openSWE",
                externalId: id,
                contentRef: artifactEvidence,
                capturedAt: now
              },
              recordType: "artifact",
              payload: {
                title: String(body.artifactTitle || "Delivery artifact"),
                artifactType: "other",
                contentRefs: [artifactEvidence],
                producedByRefs: [{ id: workId, version: work.version }]
              }
            };
            await post(baseUrl, "/api/records", artifact);
            await post(
              baseUrl,
              "/api/lineage",
              edge(
                `lineage-${workId}-${id}`,
                workId,
                id,
                "produces",
                now,
                artifactEvidence,
                common.actor,
                "observed",
                work.version
              )
            );
            return send(response, 201, artifact);
          }

          if (kind === "outcomes") {
            if (!body.outcome)
              return send(response, 400, {
                error: "outcome description is required"
              });
            const id = `outcome-${crypto.randomUUID()}`;
            const outcome: OrgRecord = {
              ...common,
              id,
              recordType: "outcome",
              payload: {
                title: "Measured delivery outcome",
                description: String(body.outcome),
                outcomeType: "customer",
                metrics: Number.isFinite(body.metricValue)
                  ? [
                      {
                        name: "reported_value",
                        value: Number(body.metricValue)
                      }
                    ]
                  : [],
                measuredAt: now,
                measurementSourceRefs: [{ id: workId, version: work.version }]
              }
            };
            await post(baseUrl, "/api/records", outcome);
            await post(
              baseUrl,
              "/api/lineage",
              edge(
                `lineage-${id}-${workId}`,
                id,
                workId,
                "measures",
                now,
                evidence,
                common.actor,
                "asserted",
                "1",
                work.version
              )
            );
            const settledWork: OrgRecord = {
              ...work,
              version: String(Number(work.version) + 1),
              occurredAt: now,
              recordedAt: now,
              actor: common.actor,
              source: common.source,
              supersedes: { id: work.id, version: work.version },
              payload: {
                ...work.payload,
                status: "completed",
                stage: "outcome"
              }
            };
            await post(baseUrl, "/api/records", settledWork);
            return send(response, 201, { outcome, work: settledWork });
          }

          let output = "";
          let exitCode = 0;
          try {
            const result = await run("pnpm", ["test"], {
              cwd: harnessCwd,
              timeout: 120000,
              maxBuffer: 1024 * 1024
            });
            output = (result.stdout + result.stderr).slice(-4000);
          } catch (error: any) {
            exitCode = Number(error.code) || 1;
            output =
              `${String(error.stdout || "")}${String(error.stderr || "")}`.slice(
                -4000
              );
          }
          const checkEvidence = contentRef(
            output || `exit ${exitCode}`,
            "text/plain"
          );
          const id = `verification-${crypto.randomUUID()}`;
          const verification: OrgRecord = {
            ...common,
            id,
            source: {
              system: "local-harness",
              externalId: `pnpm-test-${workId}`,
              contentRef: checkEvidence,
              capturedAt: now
            },
            actor: { kind: "service", id: "local-harness", version: "1" },
            recordType: "verification",
            payload: {
              title: `Verify ${work.payload.title}`,
              policyRef: "verified-delivery",
              subjectRefs: [{ id: workId, version: work.version }],
              verdict: exitCode === 0 ? "passed" : "failed",
              independent: true,
              checks: [
                {
                  id: "repo-test",
                  status: exitCode === 0 ? "passed" : "failed",
                  evidenceRefs: [checkEvidence]
                }
              ],
              humanApprovals: []
            }
          };
          await post(baseUrl, "/api/records", verification);
          await post(
            baseUrl,
            "/api/lineage",
            edge(
              `lineage-${id}-${workId}`,
              id,
              workId,
              "verifies",
              now,
              checkEvidence,
              verification.actor,
              "observed",
              "1",
              work.version
            )
          );
          const verifiedWork: OrgRecord = {
            ...work,
            version: String(Number(work.version) + 1),
            occurredAt: now,
            recordedAt: now,
            actor: verification.actor,
            source: verification.source,
            supersedes: { id: work.id, version: work.version },
            payload: {
              ...work.payload,
              status: exitCode === 0 ? "completed" : "blocked",
              stage: "verify"
            }
          };
          await post(baseUrl, "/api/records", verifiedWork);
          send(response, 201, {
            verification,
            work: verifiedWork,
            exitCode,
            outputExcerpt: output
          });
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
        env.OPENORG_HARNESS_CWD || process.cwd()
      )
    ],
    server: { port: 4710, strictPort: true, proxy: { "/api": { target } } }
  };
});
