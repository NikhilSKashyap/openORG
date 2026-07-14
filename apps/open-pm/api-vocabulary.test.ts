import { describe, expect, it } from "vitest";
import { normalizeRoleProductBody } from "./vite.config";

describe("role-product API vocabulary", () => {
  it("accepts canonical fields", () => {
    const body = normalizeRoleProductBody({
      signalRefs: ["signal-1"],
      decisionRefs: ["decision-1"],
      successMetrics: [{ name: "adoption", target: 80, value: 45 }]
    });
    expect(body.signalRefs).toEqual(["signal-1"]);
    expect(body.decisionRefs).toEqual(["decision-1"]);
    expect(body.successMetrics).toEqual([
      { name: "adoption", target: 80, value: 45 }
    ]);
  });

  it("normalizes deprecated aliases", () => {
    const body = normalizeRoleProductBody({
      decisionRef: "decision-1",
      metric: "adoption",
      target: 80,
      value: 45
    });
    expect(body.decisionRefs).toEqual(["decision-1"]);
    expect(body.successMetrics).toEqual([
      { name: "adoption", target: 80, value: 45 }
    ]);
  });
});
