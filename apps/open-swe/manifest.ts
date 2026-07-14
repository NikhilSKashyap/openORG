import { parseRoleManifest } from "@openorg/manifest";

const fields = [
  { id: "intent", label: "Intent" },
  { id: "workType", label: "Work type" },
  { id: "status", label: "Status" },
  { id: "stage", label: "Stage" },
  { id: "components", label: "Tools and agents" }
];
const home = {
  attention: [],
  stages: [
    { id: "discover", label: "Discover" },
    { id: "design", label: "Design" },
    { id: "build", label: "Build" },
    { id: "verify", label: "Verify", policy: "verified-delivery" },
    { id: "outcome", label: "Outcome" }
  ]
};

export const manifest = parseRoleManifest({
  workspace: "delivery",
  title: "openSWE",
  primaryObject: { kind: "work", label: "Customer Mission", fields },
  stations: [
    {
      id: "fde",
      name: "FDE",
      tagline: "Customer missions",
      primaryObject: { kind: "work", label: "Customer Mission", fields },
      defaultQueries: [{ workspace: "fde", kind: "work", workType: "task" }],
      home
    },
    {
      id: "swe",
      name: "SWE",
      tagline: "Software changes",
      primaryObject: { kind: "work", label: "Change", fields },
      defaultQueries: [{ workspace: "swe", kind: "work", workType: "task" }],
      home
    },
    {
      id: "mle",
      name: "MLE",
      tagline: "Machine learning experiments",
      primaryObject: { kind: "work", label: "Experiment", fields },
      defaultQueries: [{ workspace: "mle", kind: "work", workType: "task" }],
      home
    }
  ],
  sources: [{ provider: "local-harness", status: "configured" }],
  council: {
    architect: "human",
    builder: "delivery",
    verifier: "local-harness"
  },
  skills: [],
  gates: { "build->verify": "verified_receipt" },
  home
});
