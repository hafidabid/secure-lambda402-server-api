/**
 * Error codes per docs/03 (Backend PRD) section B4 and B8, plus the
 * run-lifecycle terminal codes from B5. Each carries the HTTP status an API
 * response should use and whether an agent may safely retry the same call.
 */
export const ERROR_CODES = [
  "LISTING_NOT_FOUND",
  "LISTING_NOT_PUBLISHED",
  "MODEL_NOT_FOUND",
  "MODEL_BOUND_TO_OTHER_LISTING",
  "PAYMENT_REQUIRED",
  "PAYMENT_INVALID",
  "PAYMENT_EXPIRED",
  "PAYMENT_REUSED",
  "RATE_LIMITED",
  "BUDGET_EXHAUSTED",
  "ASSET_TOO_LARGE",
  "ASSET_HASH_MISMATCH",
  "ENVELOPE_INVALID",
  "EVALUATOR_MISMATCH",
  "RUN_TIMEOUT_UNKNOWN",
  "RUN_FAILED_NOT_CHARGED",
  "DATA_UNUSABLE",
  "MODEL_UNUSABLE",
  "BAD_INPUT",
  "UNWRAP_FAILED",
  "DECRYPT_FAILED",
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_OWNER",
  "CONFLICT",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorCodeInfo {
  readonly httpStatus: number;
  readonly retryable: boolean;
}

export const ERROR_CODE_INFO: Record<ErrorCode, ErrorCodeInfo> = {
  LISTING_NOT_FOUND: { httpStatus: 404, retryable: false },
  LISTING_NOT_PUBLISHED: { httpStatus: 409, retryable: false },
  MODEL_NOT_FOUND: { httpStatus: 404, retryable: false },
  MODEL_BOUND_TO_OTHER_LISTING: { httpStatus: 409, retryable: false },
  PAYMENT_REQUIRED: { httpStatus: 402, retryable: true },
  PAYMENT_INVALID: { httpStatus: 402, retryable: false },
  PAYMENT_EXPIRED: { httpStatus: 402, retryable: true },
  PAYMENT_REUSED: { httpStatus: 409, retryable: false },
  RATE_LIMITED: { httpStatus: 429, retryable: true },
  BUDGET_EXHAUSTED: { httpStatus: 403, retryable: false },
  ASSET_TOO_LARGE: { httpStatus: 413, retryable: false },
  ASSET_HASH_MISMATCH: { httpStatus: 409, retryable: false },
  ENVELOPE_INVALID: { httpStatus: 422, retryable: false },
  EVALUATOR_MISMATCH: { httpStatus: 409, retryable: false },
  RUN_TIMEOUT_UNKNOWN: { httpStatus: 202, retryable: true },
  RUN_FAILED_NOT_CHARGED: { httpStatus: 200, retryable: false },
  DATA_UNUSABLE: { httpStatus: 200, retryable: false },
  MODEL_UNUSABLE: { httpStatus: 200, retryable: false },
  BAD_INPUT: { httpStatus: 400, retryable: false },
  UNWRAP_FAILED: { httpStatus: 422, retryable: false },
  DECRYPT_FAILED: { httpStatus: 422, retryable: false },
  VALIDATION_FAILED: { httpStatus: 422, retryable: false },
  UNAUTHENTICATED: { httpStatus: 401, retryable: false },
  FORBIDDEN: { httpStatus: 403, retryable: false },
  NOT_OWNER: { httpStatus: 403, retryable: false },
  CONFLICT: { httpStatus: 409, retryable: false },
  INTERNAL: { httpStatus: 500, retryable: true },
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = ERROR_CODE_INFO[code].httpStatus;
    this.retryable = ERROR_CODE_INFO[code].retryable;
  }

  toBody(): ApiErrorBody {
    return {
      error: { code: this.code, message: this.message, retryable: this.retryable },
    };
  }
}
