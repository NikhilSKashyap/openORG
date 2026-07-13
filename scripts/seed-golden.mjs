import { OrgRecordSchema } from "../packages/protocol/dist/index.js";

const post = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok)
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
};
const get = async (url) => {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
};

const stamp = Date.now();
const signal = OrgRecordSchema.parse(
  await post("http://localhost:4730/api/signals", {
    account: "Northstar Health",
    source: "customer-call",
    sourceId: `call-${stamp}`,
    summary: "Support leads cannot tell which escalations threaten renewals",
    exactQuote: "We find the risky accounts after the renewal is already lost.",
    desiredOutcome:
      "Surface renewal-risk escalations before the weekly account review",
    urgency: "Before next quarter's renewal cycle",
    severity: "high",
    classification: "confidential"
  })
);

const proposedDecision = OrgRecordSchema.parse(
  await post("http://localhost:4720/api/initiatives", {
    title: "Prioritize renewal-risk escalations",
    problem:
      "Account teams cannot connect urgent support escalation patterns to renewal risk in time to intervene.",
    rationale:
      "The customer quote and desired outcome establish a time-sensitive, revenue-linked problem.",
    alternatives: [
      "Add a weekly manual spreadsheet review",
      "Buy another support dashboard"
    ],
    scope: [
      "Risk signals",
      "Account-level triage",
      "Human review before outreach"
    ],
    nonGoals: ["Automatically contact customers", "Replace the CRM"],
    metric: "high-risk escalations reviewed before account meeting",
    target: 90,
    signalRefs: [signal.id]
  })
);

const approval = await post(
  `http://localhost:4720/api/initiatives/${proposedDecision.id}/approve`,
  { approverId: "product-owner" }
);
const decision = OrgRecordSchema.parse(approval.decision);
const approvalReceipt = OrgRecordSchema.parse(approval.verification);

const work = OrgRecordSchema.parse(
  await post("http://localhost:4710/api/work", {
    station: "fde",
    decisionRef: decision.id,
    title: "Deliver a renewal-risk escalation review",
    intent:
      "Give account teams a verified queue of risky escalations before each account review.",
    constraints: [
      "Customer content remains confidential",
      "A human approves any customer-facing action"
    ],
    components: [
      "support-connector",
      "crm-connector",
      "risk-policy",
      "review-queue"
    ]
  })
);

const action = OrgRecordSchema.parse(
  await post(`http://localhost:4710/api/work/${work.id}/actions`, {
    action:
      "Mapped the support escalation fields to account records and the review policy"
  })
);
const artifact = OrgRecordSchema.parse(
  await post(`http://localhost:4710/api/work/${work.id}/artifacts`, {
    artifactTitle: "Renewal-risk review specification",
    text: "Join support escalations to account records, apply the approved risk policy, and require human review before outreach."
  })
);
const verificationResponse = await post(
  `http://localhost:4710/api/work/${work.id}/verify`,
  {}
);
const verification = OrgRecordSchema.parse(verificationResponse.verification);
const verifiedWork = OrgRecordSchema.parse(verificationResponse.work);
const outcomeResponse = await post(
  `http://localhost:4710/api/work/${work.id}/outcomes`,
  {
    outcome:
      "The first account review queue was produced with traceable source and decision evidence.",
    metricValue: 1
  }
);
const outcome = OrgRecordSchema.parse(outcomeResponse.outcome);
const settledWork = OrgRecordSchema.parse(outcomeResponse.work);

const expectedLists = {
  gtm: await get("http://localhost:4730/api/records?workspace=gtm&kind=signal"),
  pm: await get("http://localhost:4720/api/records?workspace=pm&kind=decision"),
  fde: await get(
    "http://localhost:4710/api/records?workspace=fde&kind=work&workType=task"
  )
};
const expectedIds = { gtm: signal.id, pm: decision.id, fde: work.id };
for (const [workspace, records] of Object.entries(expectedLists)) {
  if (!records.some(({ id }) => id === expectedIds[workspace])) {
    throw new Error(
      `seeded ${workspace} record is missing from its workspace list`
    );
  }
}

console.log(
  JSON.stringify(
    {
      signalId: signal.id,
      decisionId: decision.id,
      approvalReceiptId: approvalReceipt.id,
      workId: work.id,
      actionId: action.id,
      artifactId: artifact.id,
      verificationId: verification.id,
      verificationVerdict: verification.payload.verdict,
      verifiedWorkStatus: verifiedWork.payload.status,
      outcomeId: outcome.id,
      settledWorkStage: settledWork.payload.stage,
      expectedLists: Object.fromEntries(
        Object.entries(expectedLists).map(([workspace, records]) => [
          workspace,
          records.map(({ id }) => id)
        ])
      ),
      journey: `http://localhost:4700/journey/${signal.id}`
    },
    null,
    2
  )
);
