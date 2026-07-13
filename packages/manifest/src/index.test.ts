import { describe, expect, it } from "vitest";
import { parseRoleManifest, roleManifestJsonSchema } from "./index.js";

const minimal = {
  workspace: "launch",
  title: "Launch room",
  primaryObject: { kind: "task", label: "Task" },
  sources: [{ provider: "local" }],
  council: { architect: "a", builder: "b", verifier: "v" },
  home: {
    stages: [
      { id: "todo", label: "To do" },
      { id: "done", label: "Done" }
    ]
  },
  gates: { "todo->done": "human_approval" }
};

describe("RoleManifest", () => {
  it("applies safe defaults", () => {
    const value = parseRoleManifest(minimal);
    expect(value.contractVersion).toBe("1.0.0");
    expect(value.primaryObject.fields).toEqual([]);
    expect(value.sources[0]?.status).toBe("unknown");
  });
  it("rejects gates naming unknown stages", () => {
    expect(() =>
      parseRoleManifest({ ...minimal, gates: { "todo->missing": "none" } })
    ).toThrow();
  });
  it("emits JSON Schema", () => {
    expect(roleManifestJsonSchema()).toMatchObject({ type: "object" });
  });
});
