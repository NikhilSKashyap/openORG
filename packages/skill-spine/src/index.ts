import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type {
  CapabilityManifest,
  VerificationReceipt,
  WorkRecord
} from "@openorg/protocol";
import { HumanIdentitySchema } from "@openorg/protocol";
import type { Store } from "@openorg/sdk";

export const MAX_SKILL_SOURCE_BYTES = 64 * 1024;
export type DraftHarness = { id: string; argv: string[] };
export type SkillSpineOptions = {
  store: Store;
  artifactRoot?: string;
  workspace?: string;
  harnesses?: DraftHarness[];
  fetch?: typeof globalThis.fetch;
  now?: () => string;
  id?: () => string;
};
type ImportedSkill = {
  content: string;
  hash: string;
  artifact: {
    algorithm: "sha256";
    digest: string;
    mediaType: string;
    uri: string;
  };
};
type DraftResult = {
  record: WorkRecord;
  skill: string;
  hash: string;
  permissions: string[];
  files: string[];
};

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const fail = (message: string, statusCode: number, invariant: string) =>
  Object.assign(new Error(message), { statusCode, invariant });

export class SkillSpine {
  private readonly root: string;
  private readonly workspace: string;
  private readonly harnesses: Map<string, DraftHarness>;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(private readonly options: SkillSpineOptions) {
    this.root = resolve(options.artifactRoot ?? ".openorg/artifacts");
    this.workspace = options.workspace ?? "skills";
    this.harnesses = new Map((options.harnesses ?? []).map((x) => [x.id, x]));
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
  }

  async importSkillDraft(source: string): Promise<ImportedSkill> {
    let bytes: Buffer;
    if (/^https?:\/\//i.test(source)) {
      const response = await this.fetcher(source);
      if (!response.ok)
        throw fail(
          `source fetch failed: ${response.status}`,
          400,
          "skill-import"
        );
      const declared = Number(response.headers.get("content-length"));
      if (declared > MAX_SKILL_SOURCE_BYTES)
        throw fail("skill source exceeds 64KB", 413, "skill-source-cap");
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      const info = await stat(source);
      if (info.size > MAX_SKILL_SOURCE_BYTES)
        throw fail("skill source exceeds 64KB", 413, "skill-source-cap");
      bytes = await readFile(source);
    }
    if (bytes.byteLength > MAX_SKILL_SOURCE_BYTES)
      throw fail("skill source exceeds 64KB", 413, "skill-source-cap");
    const content = bytes.toString("utf8");
    const artifact = await this.putArtifact(content, "text/plain");
    return { content, hash: artifact.digest, artifact };
  }

  async draftSkill(content: string, harnessId: string): Promise<DraftResult> {
    const imported = await this.snapshotText(content);
    const skill =
      harnessId === "draft-echo"
        ? `---\nname: imported-skill\ndescription: Deterministic draft-echo test skill; no LLM was used.\n---\n\n# Imported skill draft\n\n${content.trim()}\n`
        : await this.runHarness(harnessId, content);
    const artifact = await this.putArtifact(skill, "text/markdown");
    const recordedAt = this.now();
    const record: WorkRecord = {
      contract: "openorg.work-record",
      contractVersion: "1.0.0",
      id: `skill-draft-${this.id()}`,
      version: "1",
      workspace: this.workspace,
      recordedAt,
      actor: { kind: "agent", id: harnessId },
      action: "skill.draft",
      decisionRef: { id: "skill-extension-flow", version: "1" },
      components: [
        {
          kind: "tool",
          id: harnessId,
          version: "configured",
          hash: sha256(
            JSON.stringify(
              this.harnesses.get(harnessId)?.argv ?? ["built-in", "draft-echo"]
            )
          )
        }
      ],
      contextRef: { id: imported.digest, version: "sha256" },
      changes: [{ target: "SKILL.md", operation: "create", after: artifact }],
      artifacts: [imported, artifact],
      provenance: { source: "skill-spine", capturedAt: recordedAt }
    };
    await this.options.store.append(record);
    return {
      record,
      skill,
      hash: artifact.digest,
      permissions: [],
      files: ["SKILL.md"]
    };
  }

  async approve(id: string, identity: unknown): Promise<VerificationReceipt> {
    const human = HumanIdentitySchema.safeParse(identity);
    if (!human.success)
      throw fail(
        "skill approval requires a human identity",
        422,
        "human-only-approval"
      );
    const draft = await this.requireDraft(id);
    const recordedAt = this.now();
    const receipt: VerificationReceipt = {
      contract: "openorg.verification-receipt",
      contractVersion: "1.0.0",
      id: `skill-approval-${this.id()}`,
      workspace: this.workspace,
      subject: { id: draft.id, version: draft.version },
      actor: human.data,
      policyRef: "skill-human-approval",
      requiredCheckIds: [],
      verdicts: [],
      humanApprovals: [
        {
          gateId: "skill-install",
          approver: human.data,
          approvedAt: recordedAt
        }
      ],
      rejectedAlternatives: [],
      measuredOutcomes: [],
      recordedAt
    };
    await this.options.store.append(receipt);
    return receipt;
  }

  async install(id: string): Promise<CapabilityManifest> {
    const draft = await this.requireApproved(id);
    const skill = this.requireSkillArtifact(draft);
    const manifest: CapabilityManifest = {
      contract: "openorg.capability-manifest",
      contractVersion: "1.0.0",
      id: `skill-${skill.digest.slice(0, 16)}`,
      version: "1",
      kind: "skill",
      capabilities: [
        {
          id: "invoke",
          description: `Approved SKILL.md ${skill.digest}`,
          permissionsRequired: [],
          inputTypes: ["unknown"],
          outputTypes: ["unknown"]
        }
      ],
      status: "configured",
      evidenceRef: skill
    };
    await this.options.store.append(manifest);
    return manifest;
  }

  async invoke(id: string, outcome: unknown): Promise<WorkRecord> {
    const draft = await this.requireApproved(id);
    const skill = this.requireSkillArtifact(draft);
    const installed = (
      await this.options.store.query({ kind: "openorg.capability-manifest" })
    ).some(
      (raw) =>
        (raw as CapabilityManifest).kind === "skill" &&
        (raw as CapabilityManifest).evidenceRef?.digest === skill.digest &&
        (raw as CapabilityManifest).status === "configured"
    );
    if (!installed)
      throw fail(
        "skill must be installed before invocation",
        409,
        "skill-install-required"
      );
    const recordedAt = this.now();
    const outcomeArtifact = await this.putArtifact(
      JSON.stringify(outcome ?? null),
      "application/json"
    );
    const record: WorkRecord = {
      contract: "openorg.work-record",
      contractVersion: "1.0.0",
      id: `skill-invocation-${this.id()}`,
      version: "1",
      workspace: this.workspace,
      recordedAt,
      actor: { kind: "service", id: "skill-spine" },
      action: "skill.invoke.recorded",
      decisionRef: { id: draft.id, version: draft.version },
      components: [
        {
          kind: "skill",
          id: `skill-${skill.digest.slice(0, 16)}`,
          version: "1",
          hash: skill.digest
        }
      ],
      contextRef: { id: draft.id, version: draft.version },
      changes: [],
      artifacts: [skill, outcomeArtifact],
      provenance: { source: "skill-spine", capturedAt: recordedAt }
    };
    await this.options.store.append(record);
    return record;
  }

  private async requireDraft(id: string): Promise<WorkRecord> {
    const value = (await this.options.store.get(id)) as WorkRecord | null;
    if (
      value?.contract !== "openorg.work-record" ||
      value.action !== "skill.draft"
    )
      throw fail("skill draft not found", 404, "skill-draft-required");
    return value;
  }
  private requireSkillArtifact(draft: WorkRecord) {
    const skill = draft.artifacts.at(-1);
    if (!skill)
      throw fail(
        "skill draft artifact is missing",
        409,
        "skill-draft-artifact"
      );
    return skill;
  }
  private async requireApproved(id: string): Promise<WorkRecord> {
    const draft = await this.requireDraft(id);
    const receipts = await this.options.store.query({
      kind: "openorg.verification-receipt",
      workspace: this.workspace
    });
    const approved = receipts.some((raw) => {
      const receipt = raw as VerificationReceipt;
      return (
        receipt.subject.id === id &&
        receipt.subject.version === draft.version &&
        receipt.humanApprovals.some(
          (x) => x.gateId === "skill-install" && x.approver.kind === "human"
        )
      );
    });
    if (!approved)
      throw fail(
        "skill requires human approval before install or invocation",
        403,
        "skill-approval-gate"
      );
    return draft;
  }
  private async snapshotText(content: string) {
    const bytes = Buffer.from(content);
    if (bytes.byteLength > MAX_SKILL_SOURCE_BYTES)
      throw fail("skill source exceeds 64KB", 413, "skill-source-cap");
    return this.putArtifact(content, "text/plain");
  }
  private async putArtifact(content: string, mediaType: string) {
    const digest = sha256(content);
    const directory = join(this.root, "sha256");
    await mkdir(directory, { recursive: true });
    const path = join(directory, digest);
    await writeFile(path, content, { flag: "wx" }).catch((error: unknown) => {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    });
    return {
      algorithm: "sha256" as const,
      digest,
      mediaType,
      uri: `urn:sha256:${digest}`
    };
  }
  private runHarness(harnessId: string, content: string): Promise<string> {
    const harness = this.harnesses.get(harnessId);
    if (!harness?.argv.length)
      throw fail(
        `draft harness is not configured: ${harnessId}`,
        503,
        "harness-absence"
      );
    const [command, ...args] = harness.argv;
    if (!command)
      throw fail(
        `draft harness is not configured: ${harnessId}`,
        503,
        "harness-absence"
      );
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      child.stdout.on("data", (x: Buffer) => stdout.push(x));
      child.stderr.on("data", (x: Buffer) => stderr.push(x));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolvePromise(Buffer.concat(stdout).toString("utf8"))
          : reject(
              fail(
                `draft harness failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`,
                502,
                "harness-failure"
              )
            )
      );
      child.stdin.end(content);
    });
  }
}
