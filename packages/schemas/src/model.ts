import { z } from "zod";
import type { SchemaContract } from "./listing";

export const MAX_ABS_WEIGHT = 1e6;

/**
 * Plaintext model.json contract (docs/03 section 9): logistic regression as
 * JSON — features (schema order), weights, bias. This is the shape the
 * browser validates before encrypting, and the shape the evaluator parses
 * inside the TEE. Model is data, never code (no pickle, no neural nets).
 */
export const ModelJsonSchema = z
  .object({
    features: z.array(z.string().min(1)).min(1),
    weights: z.array(z.number()),
    bias: z.number(),
  })
  .strict();
export type ModelJson = z.infer<typeof ModelJsonSchema>;

export type ModelValidationError =
  | { code: "BAD_INPUT"; message: string }
  | { code: "MODEL_UNUSABLE"; message: string; field?: string };

/**
 * Structural + business validation against a listing's schema. Mirrors the
 * evaluator's own checks (docs/03 B8 "Scoring") so the browser rejects a bad
 * model before any upload, and the evaluator independently re-validates
 * since the platform never trusts client-side checks for TEE safety.
 */
export function validateModelJson(
  model: ModelJson,
  schema: SchemaContract,
): ModelValidationError[] {
  const errors: ModelValidationError[] = [];
  const featureNames = schema.features.map((f) => f.name);

  if (model.weights.length !== model.features.length) {
    errors.push({
      code: "MODEL_UNUSABLE",
      message: `weights count (${model.weights.length}) must equal features count (${model.features.length})`,
      field: "weights",
    });
  }

  const sameOrder =
    model.features.length === featureNames.length &&
    model.features.every((name, i) => name === featureNames[i]);
  if (!sameOrder) {
    errors.push({
      code: "MODEL_UNUSABLE",
      message: `features must equal schema order: expected [${featureNames.join(", ")}]`,
      field: "features",
    });
  }

  if (!Number.isFinite(model.bias)) {
    errors.push({ code: "MODEL_UNUSABLE", message: "bias must be finite", field: "bias" });
  }

  const allFinite = model.weights.every((w) => Number.isFinite(w));
  if (!allFinite) {
    errors.push({ code: "MODEL_UNUSABLE", message: "all weights must be finite", field: "weights" });
  } else {
    const tooLarge = model.weights.some((w) => Math.abs(w) > MAX_ABS_WEIGHT);
    if (tooLarge) {
      errors.push({
        code: "MODEL_UNUSABLE",
        message: `weight magnitude exceeds ${MAX_ABS_WEIGHT}`,
        field: "weights",
      });
    }
    const allZero = model.weights.every((w) => w === 0) && model.bias === 0;
    if (allZero) {
      errors.push({ code: "MODEL_UNUSABLE", message: "degenerate model: all weights and bias are zero", field: "weights" });
    }
  }

  return errors;
}

/**
 * JSON.parse loses precision above Number.MAX_SAFE_INTEGER (2^53). Per
 * VA-28, a model value that large must be rejected outright rather than
 * silently rounded, so integer literals are checked against the raw text
 * before parsing.
 */
export function parseModelJsonSafe(raw: string): ModelJson {
  const bigIntLiteral = /-?\b\d{16,}\b(?!\.\d)/g;
  const matches = raw.match(bigIntLiteral) ?? [];
  for (const m of matches) {
    if (BigInt(m) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(m) < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`numeric literal ${m} exceeds safe integer range and would be rounded`);
    }
  }
  const parsed: unknown = JSON.parse(raw);
  return ModelJsonSchema.parse(parsed);
}
