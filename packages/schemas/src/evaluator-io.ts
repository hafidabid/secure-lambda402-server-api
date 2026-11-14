import { z } from "zod";
import { SchemaContractSchema } from "./listing";
import { Base64Schema, EnvelopeSchema } from "./envelope";
import { MetricsSchema, RowCountBucketSchema } from "./run";

/** Rules carried into the TEE job input (docs/03 B8). A subset of ListingRules. */
export const EvaluatorRulesSchema = z.object({
  min_rows: z.number().int().min(1),
  min_class_count: z.number().int().min(1),
  round: z.number().int().min(0).max(6),
  metrics: z.array(z.enum(["accuracy", "auc", "f1"])).min(1),
});
export type EvaluatorRules = z.infer<typeof EvaluatorRulesSchema>;

export const EvaluatorFileInputSchema = z.object({
  ct_b64: Base64Schema,
  wrapped_key: EnvelopeSchema,
});
export type EvaluatorFileInput = z.infer<typeof EvaluatorFileInputSchema>;

/** One job object handed to the pinned wasm32-wasip1 program (docs/03 B8 "Input"). */
export const EvaluatorInputSchema = z.object({
  v: z.literal(1),
  run_id: z.string().min(1),
  listing_id: z.string().min(1),
  evaluator_version: z.string().min(1),
  schema: SchemaContractSchema,
  rules: EvaluatorRulesSchema,
  dataset: EvaluatorFileInputSchema,
  model: EvaluatorFileInputSchema,
});
export type EvaluatorInput = z.infer<typeof EvaluatorInputSchema>;

export const EVALUATOR_ERROR_CODES = [
  "BAD_INPUT",
  "UNWRAP_FAILED",
  "DECRYPT_FAILED",
  "DATA_UNUSABLE",
  "MODEL_UNUSABLE",
  "INTERNAL",
] as const;
export type EvaluatorErrorCode = (typeof EVALUATOR_ERROR_CODES)[number];

export const EvaluatorSuccessOutputSchema = z.object({
  v: z.literal(1),
  ok: z.literal(true),
  metrics: MetricsSchema,
  n_bucket: RowCountBucketSchema,
  evaluator_version: z.string(),
});
export type EvaluatorSuccessOutput = z.infer<typeof EvaluatorSuccessOutputSchema>;

export const EvaluatorFailureOutputSchema = z.object({
  v: z.literal(1),
  ok: z.literal(false),
  error: z.enum(EVALUATOR_ERROR_CODES),
});
export type EvaluatorFailureOutput = z.infer<typeof EvaluatorFailureOutputSchema>;

export const EvaluatorOutputSchema = z.union([
  EvaluatorSuccessOutputSchema,
  EvaluatorFailureOutputSchema,
]);
export type EvaluatorOutput = z.infer<typeof EvaluatorOutputSchema>;
