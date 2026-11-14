import { z } from "zod";
import { RUN_STATES } from "./run-states";
import { ReceiptSchema } from "./attestation";

export const RunModeSchema = z.enum(["enclave", "local"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RowCountBucketSchema = z.enum(["<100", "100-199", "200-499", "500-999", "1000+"]);
export type RowCountBucket = z.infer<typeof RowCountBucketSchema>;

export function bucketForRowCount(rows: number): RowCountBucket {
  if (rows < 100) return "<100";
  if (rows < 200) return "100-199";
  if (rows < 500) return "200-499";
  if (rows < 1000) return "500-999";
  return "1000+";
}

export const MetricsSchema = z.object({
  accuracy: z.number().min(0).max(1),
  auc: z.number().min(0).max(1).nullable(),
  f1: z.number().min(0).max(1),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const RunResultSchema = z.object({
  metrics: MetricsSchema,
  n_bucket: RowCountBucketSchema,
});
export type RunResult = z.infer<typeof RunResultSchema>;

export const RunStateSchema = z.enum(RUN_STATES);

export const RunSchema = z.object({
  id: z.string(),
  listing_id: z.string(),
  buyer_id: z.string(),
  model_id: z.string(),
  state: RunStateSchema,
  payment_nonce: z.string(),
  attempt: z.number().int().min(0),
  exec_tx_hash: z.string().nullable(),
  result: RunResultSchema.nullable(),
  error_code: z.string().nullable(),
  mode: RunModeSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Run = z.infer<typeof RunSchema>;

export const EvaluateRequestDtoSchema = z.object({
  model_id: z.string().min(1),
});
export type EvaluateRequestDto = z.infer<typeof EvaluateRequestDtoSchema>;

/** 200 response body after a run settles successfully (docs/03 B4). */
export const EvaluateSuccessResponseSchema = z.object({
  run_id: z.string(),
  mode: RunModeSchema,
  result: RunResultSchema,
  receipt: ReceiptSchema,
});
export type EvaluateSuccessResponse = z.infer<typeof EvaluateSuccessResponseSchema>;

/** 202 response body when the run has not finished inside the HTTP timeout. */
export const EvaluatePendingResponseSchema = z.object({
  run_id: z.string(),
  location: z.string(),
});
export type EvaluatePendingResponse = z.infer<typeof EvaluatePendingResponseSchema>;
