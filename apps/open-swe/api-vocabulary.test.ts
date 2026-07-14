import { describe, expect, it } from "vitest";
import { normalizeRoleProductBody } from "./vite.config";

describe("role-product API vocabulary", () => {
  it("accepts canonical fields and normalizes deprecated aliases", () => {
    expect(
      normalizeRoleProductBody({
        decisionRefs: ["decision-1"],
        successMetrics: [{ name: "latency", target: 100, value: 125 }]
      })
    ).toMatchObject({
      decisionRefs: ["decision-1"],
      successMetrics: [{ name: "latency", target: 100, value: 125 }]
    });
    expect(
      normalizeRoleProductBody({ decisionRef: "decision-2" })
    ).toMatchObject({ decisionRefs: ["decision-2"] });
  });
});
