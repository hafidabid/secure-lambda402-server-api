import { ModelJsonSchema, parseModelJsonSafe, validateModelJson, type ModelJson } from "./model";
import type { SchemaContract } from "./listing";

const schema: SchemaContract = {
  task: "binary_classification",
  features: [
    { name: "age", type: "int" },
    { name: "glucose", type: "float" },
  ],
  label: "diabetes",
};

function validModel(): ModelJson {
  return { features: ["age", "glucose"], weights: [0.5, -0.2], bias: 0.1 };
}

describe("ModelJsonSchema (VA-19)", () => {
  it("accepts a well-formed model", () => {
    expect(() => ModelJsonSchema.parse(validModel())).not.toThrow();
  });

  it("rejects a missing bias field", () => {
    const { bias, ...withoutBias } = validModel();
    expect(() => ModelJsonSchema.parse(withoutBias)).toThrow();
  });

  it("rejects extra unknown fields (strict schema)", () => {
    expect(() => ModelJsonSchema.parse({ ...validModel(), extra: 1 })).toThrow();
  });

  it("rejects malformed JSON text with BAD_INPUT-shaped failure", () => {
    expect(() => parseModelJsonSafe("{not json")).toThrow();
  });
});

describe("validateModelJson (VA-05, VA-15..18, VA-27)", () => {
  it("VA-05: a valid model against its schema has no errors", () => {
    expect(validateModelJson(validModel(), schema)).toEqual([]);
  });

  it("VA-15: weights count differing from features count is rejected and names the expected count", () => {
    const model = { ...validModel(), weights: [0.5] };
    const errors = validateModelJson(model, schema);
    expect(errors).toContainEqual(
      expect.objectContaining({ field: "weights", message: expect.stringContaining("2") }),
    );
  });

  it("VA-16: features in a different order are rejected and show the expected order", () => {
    const model = { ...validModel(), features: ["glucose", "age"] };
    const errors = validateModelJson(model, schema);
    expect(errors).toContainEqual(
      expect.objectContaining({ field: "features", message: expect.stringContaining("age, glucose") }),
    );
  });

  it("VA-17: all-zero weights and bias is rejected as degenerate", () => {
    const model = { ...validModel(), weights: [0, 0], bias: 0 };
    const errors = validateModelJson(model, schema);
    expect(errors).toContainEqual(expect.objectContaining({ message: expect.stringContaining("degenerate") }));
  });

  it("VA-18: a weight larger than 1e6 is rejected", () => {
    const model = { ...validModel(), weights: [1e7, 0.1] };
    const errors = validateModelJson(model, schema);
    expect(errors).toContainEqual(expect.objectContaining({ field: "weights" }));
  });

  it("VA-27: a weight of exactly 1e6 is accepted", () => {
    const model = { ...validModel(), weights: [1e6, 0.1] };
    expect(validateModelJson(model, schema)).toEqual([]);
  });

  it("rejects non-finite weights (NaN/Infinity) distinctly from the magnitude check", () => {
    const model = { ...validModel(), weights: [Number.POSITIVE_INFINITY, 0.1] };
    const errors = validateModelJson(model, schema);
    expect(errors).toContainEqual(expect.objectContaining({ message: expect.stringContaining("finite") }));
  });
});

describe("parseModelJsonSafe (VA-28)", () => {
  it("accepts ordinary numbers", () => {
    const parsed = parseModelJsonSafe(JSON.stringify(validModel()));
    expect(parsed).toEqual(validModel());
  });

  it("VA-28: rejects a weight literal larger than 2^53 instead of silently rounding it", () => {
    const raw = `{"features":["age","glucose"],"weights":[99999999999999999999,0.1],"bias":0}`;
    expect(() => parseModelJsonSafe(raw)).toThrow(/exceeds safe integer range/);
  });

  it("accepts a large but safe integer literal", () => {
    const raw = `{"features":["age","glucose"],"weights":[9007199254740991,0.1],"bias":0}`;
    expect(() => parseModelJsonSafe(raw)).not.toThrow();
  });
});
