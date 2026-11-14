import { SchemaContractSchema, ListingRulesSchema, CreateListingDtoSchema } from "./listing";

const base = {
  task: "binary_classification" as const,
  features: [
    { name: "age", type: "int" as const },
    { name: "glucose", type: "float" as const },
  ],
  label: "diabetes",
};

describe("SchemaContractSchema", () => {
  it("accepts a well-formed schema", () => {
    expect(() => SchemaContractSchema.parse(base)).not.toThrow();
  });

  it("VA-06: rejects a duplicate feature name and names the column", () => {
    const schema = { ...base, features: [...base.features, { name: "age", type: "int" as const }] };
    const result = SchemaContractSchema.safeParse(schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("age");
    }
  });

  it("rejects a schema with zero features", () => {
    expect(SchemaContractSchema.safeParse({ ...base, features: [] }).success).toBe(false);
  });

  it("rejects a schema with more than 64 features", () => {
    const features = Array.from({ length: 65 }, (_, i) => ({ name: `f${i}`, type: "int" as const }));
    expect(SchemaContractSchema.safeParse({ ...base, features }).success).toBe(false);
  });

  it("rejects a label that also appears as a feature", () => {
    const schema = { ...base, label: "age" };
    expect(SchemaContractSchema.safeParse(schema).success).toBe(false);
  });
});

describe("ListingRulesSchema", () => {
  it("VA-20/21: enforces min_rows floor of 50", () => {
    expect(ListingRulesSchema.safeParse({ min_rows: 50, min_class_count: 10, runs_per_day: 20, lifetime_budget: 200 }).success).toBe(true);
    expect(ListingRulesSchema.safeParse({ min_rows: 49, min_class_count: 10, runs_per_day: 20, lifetime_budget: 200 }).success).toBe(false);
  });

  it("AP-05: rejects price_amount of 0 or negative via the listing DTO regex", () => {
    const base_dto = {
      name: "demo",
      schema: { task: "binary_classification", features: base.features, label: base.label },
      sample_rows: Array.from({ length: 5 }, () => ({ age: 1, glucose: 1 })),
      rules: { min_rows: 50, min_class_count: 10, runs_per_day: 20, lifetime_budget: 200 },
      evaluator_version: "1.0.0",
    };
    expect(CreateListingDtoSchema.safeParse({ ...base_dto, price_amount: "0" }).success).toBe(false);
    expect(CreateListingDtoSchema.safeParse({ ...base_dto, price_amount: "-5" }).success).toBe(false);
    expect(CreateListingDtoSchema.safeParse({ ...base_dto, price_amount: "5" }).success).toBe(true);
  });
});
