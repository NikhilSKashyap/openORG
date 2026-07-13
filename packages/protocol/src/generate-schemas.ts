import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  CapabilityManifestSchema,
  AccessPolicyManifestSchema,
  ConsentGrantSchema,
  ContextEnvelopeSchema,
  DatasetManifestSchema,
  EligibilityReceiptSchema,
  LineageAssertionSchema,
  EgressReceiptSchema,
  EvaluationReceiptSchema,
  EvaluationSuiteSchema,
  LearningArtifactSchema,
  LearningProposalSchema,
  ModelArtifactSchema,
  ModelEvaluationSchema,
  OrgRecordSchema,
  PromotionReceiptSchema,
  ReusablePolicySchema,
  RoutingDecisionSchema,
  RoutingPolicySchema,
  TrainingJobSchema,
  TrainingRecordSchema,
  VerificationReceiptSchema,
  WorkRecordSchema
} from "./index.js";

const outputDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../schemas"
);
const schemas = {
  "access-policy": AccessPolicyManifestSchema,
  "capability-manifest": CapabilityManifestSchema,
  "consent-grant": ConsentGrantSchema,
  "context-envelope": ContextEnvelopeSchema,
  "dataset-manifest": DatasetManifestSchema,
  "olp-eligibility-receipt": EligibilityReceiptSchema,
  "lineage-assertion": LineageAssertionSchema,
  "egress-receipt": EgressReceiptSchema,
  "evaluation-suite": EvaluationSuiteSchema,
  "olp-evaluation-receipt": EvaluationReceiptSchema,
  "olp-learning-artifact": LearningArtifactSchema,
  "olp-learning-proposal": LearningProposalSchema,
  "model-artifact": ModelArtifactSchema,
  "model-evaluation": ModelEvaluationSchema,
  "org-record": OrgRecordSchema,
  "olp-promotion-receipt": PromotionReceiptSchema,
  "reusable-policy": ReusablePolicySchema,
  "routing-decision": RoutingDecisionSchema,
  "routing-policy": RoutingPolicySchema,
  "training-job": TrainingJobSchema,
  "training-record": TrainingRecordSchema,
  "verification-receipt": VerificationReceiptSchema,
  "work-record": WorkRecordSchema
} as const;

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  Object.entries(schemas).map(async ([name, schema]) => {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
    await writeFile(
      resolve(outputDirectory, `${name}.json`),
      `${JSON.stringify(jsonSchema, null, 2)}\n`
    );
  })
);
