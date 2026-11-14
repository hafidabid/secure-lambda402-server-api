import { z } from "zod";

export const FeatureTypeSchema = z.enum(["int", "float"]);

export const FeatureSchema = z.object({
  name: z.string().min(1).max(128),
  type: FeatureTypeSchema,
});

/**
 * Schema contract per docs/03 section 9 example:
 * {"task":"binary_classification","features":[...],"label":"diabetes"}
 */
export const SchemaContractSchema = z
  .object({
    task: z.literal("binary_classification"),
    features: z
      .array(FeatureSchema)
      .min(1, "schema must declare at least one feature")
      .max(64, "schema may declare at most 64 features"),
    label: z.string().min(1).max(128),
  })
  .superRefine((schema, ctx) => {
    const names = schema.features.map((f) => f.name);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate feature name(s): ${[...new Set(duplicates)].join(", ")}`,
        path: ["features"],
      });
    }
    if (names.includes(schema.label)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "label column must not also appear in features",
        path: ["label"],
      });
    }
  });

export type SchemaContract = z.infer<typeof SchemaContractSchema>;

/** Output rules enforced in the TEE and in the gateway (docs/03 B9, D8). */
export const ListingRulesSchema = z.object({
  min_rows: z.number().int().min(50).max(1_000_000),
  min_class_count: z.number().int().min(1).max(1_000_000),
  round: z.number().int().min(0).max(6).default(2),
  metrics: z
    .array(z.enum(["accuracy", "auc", "f1"]))
    .min(1)
    .default(["accuracy", "auc", "f1"]),
  runs_per_day: z.number().int().min(1).max(1000),
  lifetime_budget: z.number().int().min(1).max(1_000_000),
});

export type ListingRules = z.infer<typeof ListingRulesSchema>;

export const SampleRowSchema = z.record(z.string(), z.union([z.number(), z.string()]));

export const ListingStatusSchema = z.enum(["draft", "published", "paused", "retired"]);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

export const CreateListingDtoSchema = z.object({
  name: z.string().min(1).max(256),
  schema: SchemaContractSchema,
  sample_rows: z.array(SampleRowSchema).length(5, "exactly 5 synthetic sample rows are required"),
  price_amount: z.string().regex(/^[1-9]\d*$/, "price_amount must be a positive integer string (yoctoNEAR or token base units)"),
  price_asset: z.string().min(1).default("near"),
  rules: ListingRulesSchema,
  evaluator_version: z.string().min(1),
});
export type CreateListingDto = z.infer<typeof CreateListingDtoSchema>;

export const PatchListingDtoSchema = CreateListingDtoSchema.partial();
export type PatchListingDto = z.infer<typeof PatchListingDtoSchema>;

export const ListingSchema = z.object({
  id: z.string(),
  seller_id: z.string(),
  name: z.string(),
  schema: SchemaContractSchema,
  sample_rows: z.array(SampleRowSchema),
  price_amount: z.string(),
  price_asset: z.string(),
  rules: ListingRulesSchema,
  evaluator_version: z.string(),
  dataset_asset_id: z.string().nullable(),
  status: ListingStatusSchema,
  created_at: z.string(),
  published_at: z.string().nullable(),
});
export type Listing = z.infer<typeof ListingSchema>;

/** Public catalog view: never includes seller-private fields beyond what docs/03 FR-04 exposes. */
export const ListingCatalogItemSchema = ListingSchema.pick({
  id: true,
  name: true,
  schema: true,
  sample_rows: true,
  price_amount: true,
  price_asset: true,
  evaluator_version: true,
  status: true,
});
export type ListingCatalogItem = z.infer<typeof ListingCatalogItemSchema>;
