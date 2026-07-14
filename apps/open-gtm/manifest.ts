import { parseRoleManifest } from "@openorg/manifest";

export const manifest = parseRoleManifest({
  workspace: "gtm",
  title: "openGTM",
  primaryObject: {
    kind: "signal",
    label: "Signal",
    fields: [
      { id: "summary", label: "Customer signal" },
      { id: "exactQuote", label: "Exact words" },
      { id: "desiredOutcome", label: "Desired outcome" },
      { id: "severity", label: "Severity" },
      { id: "status", label: "Status" }
    ]
  },
  sources: [{ provider: "openorg", status: "configured" }],
  council: { architect: "human", builder: "gtm", verifier: "human" },
  skills: [],
  gates: {
    "captured->qualified": "human_approval",
    "qualified->handed_off": "human_approval"
  },
  home: {
    attention: [],
    stages: [
      { id: "captured", label: "Captured" },
      { id: "qualified", label: "Qualified" },
      { id: "handed_off", label: "Handed off" }
    ]
  }
});
