import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@openorg/store-memory";
import { MAX_SKILL_SOURCE_BYTES, SkillSpine } from "./index.js";

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "openorg-skill-spine-"));
  const store = new MemoryStore();
  let sequence = 0;
  const spine = new SkillSpine({
    store,
    artifactRoot: join(root, "artifacts"),
    now: () => "2026-07-12T10:00:00Z",
    id: () => String(++sequence)
  });
  return { root, store, spine };
};

describe("skill safe spine", () => {
  it("caps local and fetched sources at 64KB", async () => {
    const { root, spine } = await setup();
    const path = join(root, "large.txt");
    await writeFile(path, "x".repeat(MAX_SKILL_SOURCE_BYTES + 1));
    await expect(spine.importSkillDraft(path)).rejects.toMatchObject({
      invariant: "skill-source-cap",
      statusCode: 413
    });
    const remote = new SkillSpine({
      store: new MemoryStore(),
      artifactRoot: join(root, "remote"),
      fetch: async () => new Response("x".repeat(MAX_SKILL_SOURCE_BYTES + 1))
    });
    await expect(
      remote.importSkillDraft("https://example.test/skill")
    ).rejects.toMatchObject({ invariant: "skill-source-cap" });
  });

  it("snapshots imports under their sha256 content address", async () => {
    const { root, spine } = await setup();
    const path = join(root, "notes.txt");
    await writeFile(path, "safe text");
    const imported = await spine.importSkillDraft(path);
    const expected = createHash("sha256").update("safe text").digest("hex");
    expect(imported.hash).toBe(expected);
    expect(
      await readFile(join(root, "artifacts", "sha256", expected), "utf8")
    ).toBe("safe text");
  });

  it("gates install until a human approval receipt exists", async () => {
    const { spine, store } = await setup();
    const draft = await spine.draftSkill(
      "Do the documented task.",
      "draft-echo"
    );
    expect(
      await store.query({
        kind: "openorg.verification-receipt",
        workspace: "skills"
      })
    ).toHaveLength(0);
    expect(draft.skill).toContain("no LLM was used");
    await expect(spine.install(draft.record.id)).rejects.toMatchObject({
      invariant: "skill-approval-gate",
      statusCode: 403
    });
    const receipt = await spine.approve(draft.record.id, {
      kind: "human",
      id: "alice"
    });
    expect(receipt.humanApprovals[0]?.approver.id).toBe("alice");
    expect(receipt.subject).toEqual({
      id: draft.record.id,
      version: draft.record.version
    });
    expect((await spine.install(draft.record.id)).status).toBe("configured");
  });

  it("rejects agent and service identities at the approval boundary", async () => {
    const { spine } = await setup();
    const draft = await spine.draftSkill("text", "draft-echo");
    await expect(
      spine.approve(draft.record.id, { kind: "agent", id: "bot" })
    ).rejects.toMatchObject({ invariant: "human-only-approval" });
    await expect(
      spine.approve(draft.record.id, { kind: "service", id: "api" })
    ).rejects.toMatchObject({ invariant: "human-only-approval" });
  });

  it("attributes each invocation to the exact approved skill hash", async () => {
    const { spine, store } = await setup();
    const draft = await spine.draftSkill("text", "draft-echo");
    await spine.approve(draft.record.id, { kind: "human", id: "alice" });
    await spine.install(draft.record.id);
    const invocation = await spine.invoke(draft.record.id, {
      outcome: "recorded"
    });
    expect(invocation.components).toContainEqual(
      expect.objectContaining({ kind: "skill", hash: draft.hash })
    );
    expect((await store.get(invocation.id))?.id).toBe(invocation.id);
  });

  it("never executes imported text", async () => {
    const { root, spine } = await setup();
    const marker = join(root, "must-not-exist");
    const source = join(root, "hostile.txt");
    await writeFile(source, `touch ${marker}`);
    const imported = await spine.importSkillDraft(source);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(imported.content).toContain("touch");
  });
});
