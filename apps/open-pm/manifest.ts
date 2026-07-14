import { parseRoleManifest } from "@openorg/manifest";

export const manifest = parseRoleManifest({
  workspace: "pm",
  title: "openPM",
  primaryObject: {
    kind: "decision",
    label: "Decision",
    fields: [
      { id: "problem", label: "Problem" },
      { id: "rationale", label: "Rationale" },
      { id: "scope", label: "Scope" },
      { id: "nonGoals", label: "Non-goals" },
      { id: "successMetrics", label: "Success metrics" },
      { id: "status", label: "Status" }
    ]
  },
  sources: [{ provider: "openorg", status: "configured" }],
  council: { architect: "human", builder: "pm", verifier: "human" },
  skills: [],
  gates: { "proposed->approved": "human_approval" },
  home: {
    attention: [
      { id: "new-signals", label: "Customer context", query: "workspace=gtm" }
    ],
    stages: [
      { id: "proposed", label: "Proposed" },
      { id: "approved", label: "Approved" },
      { id: "rejected", label: "Rejected" },
      { id: "superseded", label: "Superseded" }
    ]
  }
});
