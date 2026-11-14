import { ApiError, ERROR_CODES, ERROR_CODE_INFO } from "./error-codes";

describe("error code table", () => {
  it("every error code has HTTP status + retryable info", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CODE_INFO[code]).toBeDefined();
      expect(ERROR_CODE_INFO[code].httpStatus).toBeGreaterThanOrEqual(200);
    }
  });

  it("PAYMENT_REUSED is not retryable (PY-10)", () => {
    expect(ERROR_CODE_INFO.PAYMENT_REUSED.retryable).toBe(false);
  });

  it("RATE_LIMITED is retryable and maps to 429 (AP-14)", () => {
    expect(ERROR_CODE_INFO.RATE_LIMITED).toEqual({ httpStatus: 429, retryable: true });
  });

  it("BUDGET_EXHAUSTED maps to 403 (AP-15)", () => {
    expect(ERROR_CODE_INFO.BUDGET_EXHAUSTED.httpStatus).toBe(403);
  });
});

describe("ApiError", () => {
  it("carries the code's status and retryable flag and serializes to the documented body shape", () => {
    const err = new ApiError("ASSET_TOO_LARGE", "file exceeds 1 MB cap");
    expect(err.httpStatus).toBe(413);
    expect(err.retryable).toBe(false);
    expect(err.toBody()).toEqual({
      error: { code: "ASSET_TOO_LARGE", message: "file exceeds 1 MB cap", retryable: false },
    });
  });
});
