import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  CapabilityManifestSchema,
  ContextEnvelopeSchema,
  DatasetManifestSchema,
  LineageAssertionSchema,
  OrgRecordSchema,
  TrainingRecordSchema,
  VerificationReceiptSchema,
  WorkRecordSchema
} from "./index.js";

const outputDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../schemas"
);
const schemas = {
  "capability-manifest": CapabilityManifestSchema,
  "context-envelope": ContextEnvelopeSchema,
  "dataset-manifest": DatasetManifestSchema,
  "lineage-assertion": LineageAssertionSchema,
  "org-record": OrgRecordSchema,
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
