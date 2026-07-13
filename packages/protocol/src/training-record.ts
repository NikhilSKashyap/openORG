import { z } from "zod";
import {
  ContentRefSchema,
  IdentifierSchema,
  RecordRefSchema,
  TimestampSchema
} from "./common.js";

export const TrainingRecordSchema = z
  .object({
    contract: z.literal("openorg.training-record"),
    contractVersion: z.literal("1.0.0"),
    id: IdentifierSchema,
    context: RecordRefSchema,
    action: RecordRefSchema,
    correction: z
      .object({
        original: RecordRefSchema,
        corrected: RecordRefSchema,
        reason: z.string().min(1)
      })
      .strict()
      .optional(),
    evidence: z.array(ContentRefSchema),
    outcome: z
      .object({
        description: z.string().min(1),
        metrics: z.record(z.string(), z.number())
      })
      .strict()
      .optional(),
    exportedAt: TimestampSchema
  })
  .strict();

export type TrainingRecord = z.infer<typeof TrainingRecordSchema>;

export type SftExport = {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
};
export type PreferenceExport = {
  prompt: string;
  chosen: string;
  rejected: string;
};
export type RagExport = {
  id: string;
  text: string;
  metadata: Record<string, string>;
};

export function toJsonl(records: readonly unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

export function toSft(record: TrainingRecord): SftExport {
  return {
    messages: [
      { role: "user", content: JSON.stringify(record.context) },
      { role: "assistant", content: JSON.stringify(record.action) }
    ]
  };
}

export function toPreference(
  record: TrainingRecord
): PreferenceExport | undefined {
  if (!record.correction) return undefined;
  return {
    prompt: JSON.stringify(record.context),
    chosen: JSON.stringify(record.correction.corrected),
    rejected: JSON.stringify(record.correction.original)
  };
}

export function toRag(record: TrainingRecord): RagExport {
  return {
    id: record.id,
    text: JSON.stringify({
      context: record.context,
      action: record.action,
      correction: record.correction,
      evidence: record.evidence,
      outcome: record.outcome
    }),
    metadata: {
      contractVersion: record.contractVersion,
      exportedAt: record.exportedAt
    }
  };
}

export const exportSftJsonl = (records: readonly TrainingRecord[]): string =>
  toJsonl(records.map(toSft));
export const exportPreferenceJsonl = (
  records: readonly TrainingRecord[]
): string =>
  toJsonl(
    records.flatMap((record) => {
      const exported = toPreference(record);
      return exported ? [exported] : [];
    })
  );
export const exportRagJsonl = (records: readonly TrainingRecord[]): string =>
  toJsonl(records.map(toRag));
