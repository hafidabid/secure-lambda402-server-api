import { z } from "zod";
import {
  AuthChallengeResponseSchema,
  AuthLoginResponseSchema,
  ERROR_CODES,
  EvaluateSuccessResponseSchema,
  EvaluatePendingResponseSchema,
  EvaluatorMetadataSchema,
  ListingCatalogItemSchema,
  ListingSchema,
  ReceiptSchema,
  RunSchema,
  RunStateSchema,
  UploadAssetResponseSchema,
  UploadModelResponseSchema,
  X402QuoteSchema,
  type AuthLoginRequest,
  type CreateListingDto,
  type Envelope,
  type ErrorCode,
  type PatchListingDto,
  type SignedPayment,
} from "@securelambda/schemas";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string(), retryable: z.boolean() }),
});

export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK",
    readonly status: number,
    readonly detail?: string,
  ) {
    super(code);
  }
}

let onUnauthenticated: () => void = () => {};

export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler;
}

function errorFrom(res: Response, body: unknown): ApiRequestError {
  const parsed = ApiErrorBodySchema.safeParse(body);
  const error = parsed.success
    ? new ApiRequestError(parsed.data.error.code, res.status, parsed.data.error.message)
    : new ApiRequestError("INTERNAL", res.status);
  if (error.code === "UNAUTHENTICATED") onUnauthenticated();
  return error;
}

async function send(path: string, init: RequestInit & { token?: string | null }): Promise<{ res: Response; body: unknown }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  try {
    const res = await fetch(`${API_URL}/v1${path}`, { ...init, headers });
    const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    return { res, body };
  } catch {
    throw new ApiRequestError("NETWORK", 0);
  }
}

async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init: RequestInit & { token?: string | null } = {},
): Promise<z.output<S>> {
  const { res, body } = await send(path, init);
  if (!res.ok) throw errorFrom(res, body);
  return schema.parse(body);
}

const json = (data: unknown): RequestInit => ({
  body: JSON.stringify(data),
  headers: { "Content-Type": "application/json" },
});

function sealedForm(ciphertext: Uint8Array, envelope: Envelope, filename: string): FormData {
  const form = new FormData();
  form.set("ciphertext", new Blob([new Uint8Array(ciphertext)]), filename);
  form.set("wrapped_key", JSON.stringify(envelope));
  return form;
}

export const LISTINGS_PAGE_SIZE = 20;

const ListingPageSchema = z.object({ items: z.array(ListingCatalogItemSchema), next_cursor: z.string().nullable() });
const SellerRunSchema = z.object({ id: z.string(), buyer_id: z.string(), state: RunStateSchema, created_at: z.string() });

function listingsQuery(q: string, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(LISTINGS_PAGE_SIZE) });
  if (q) params.set("q", q);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export const api = {
  challenge: (accountId: string) =>
    request("/auth/challenge", AuthChallengeResponseSchema, { method: "POST", ...json({ account_id: accountId }) }),
  login: (body: AuthLoginRequest) => request("/auth/login", AuthLoginResponseSchema, { method: "POST", ...json(body) }),
  logout: (token: string) => request("/auth/logout", z.null(), { method: "POST", token }),

  getEvaluator: () => request("/evaluator", EvaluatorMetadataSchema),
  listListings: (q: string, cursor: string | null) => request(`/listings?${listingsQuery(q, cursor)}`, ListingPageSchema),
  getListing: (id: string, token: string | null) => request(`/listings/${id}`, ListingCatalogItemSchema, { token }),

  createListing: (dto: CreateListingDto, token: string) =>
    request("/listings", ListingSchema, { method: "POST", token, ...json(dto) }),
  patchListing: (id: string, dto: PatchListingDto, token: string) =>
    request(`/listings/${id}`, ListingSchema, { method: "PATCH", token, ...json(dto) }),
  publishListing: (id: string, token: string) => request(`/listings/${id}/publish`, ListingSchema, { method: "POST", token }),
  uploadDataset: (listingId: string, ciphertext: Uint8Array, envelope: Envelope, token: string) =>
    request(`/listings/${listingId}/dataset`, UploadAssetResponseSchema, {
      method: "POST",
      token,
      body: sealedForm(ciphertext, envelope, "dataset.bin"),
    }),
  getSellerRuns: (token: string) => request("/seller/runs", z.array(SellerRunSchema), { token }),

  uploadModel: (listingId: string, ciphertext: Uint8Array, envelope: Envelope, token: string) =>
    request(`/listings/${listingId}/models`, UploadModelResponseSchema, {
      method: "POST",
      token,
      body: sealedForm(ciphertext, envelope, "model.bin"),
    }),
  getRun: (id: string, token: string) => request(`/runs/${id}`, RunSchema, { token }),
  getReceipt: (id: string, token: string) => request(`/runs/${id}/receipt`, ReceiptSchema, { token }),
};

export type EvaluateOutcome =
  | { kind: "quote"; quote: z.infer<typeof X402QuoteSchema> }
  | { kind: "pending"; runId: string }
  | { kind: "done"; runId: string };

export async function evaluate(listingId: string, modelId: string, token: string, payment?: SignedPayment): Promise<EvaluateOutcome> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (payment) headers.set("X-Payment", btoa(JSON.stringify(payment)));

  const { res, body } = await send(`/listings/${listingId}/evaluate`, {
    method: "POST",
    token,
    headers,
    body: JSON.stringify({ model_id: modelId }),
  });

  if (res.status === 402 && !payment) return { kind: "quote", quote: X402QuoteSchema.parse(body) };
  if (res.status === 202) return { kind: "pending", runId: EvaluatePendingResponseSchema.parse(body).run_id };
  if (res.ok) return { kind: "done", runId: EvaluateSuccessResponseSchema.parse(body).run_id };
  throw errorFrom(res, body);
}
