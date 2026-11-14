import { z } from "zod";
import {
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
  X402QuoteSchema,
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
  ) {
    super(code);
  }
}

async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init: RequestInit & { account?: string | null } = {},
): Promise<z.output<S>> {
  const headers = new Headers(init.headers);
  if (init.account) headers.set("x-account-id", init.account);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiRequestError("NETWORK", 0);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorBodySchema.safeParse(body);
    throw new ApiRequestError(parsed.success ? parsed.data.error.code : "INTERNAL", res.status);
  }
  return schema.parse(body);
}

const json = (data: unknown): RequestInit => ({
  body: JSON.stringify(data),
  headers: { "Content-Type": "application/json" },
});

const ListingPageSchema = z.object({ items: z.array(ListingCatalogItemSchema), next_cursor: z.string().nullable() });
const SellerRunSchema = z.object({ id: z.string(), buyer_id: z.string(), state: RunStateSchema, created_at: z.string() });

export const api = {
  listListings: (q?: string) => request(`/listings${q ? `?q=${encodeURIComponent(q)}` : ""}`, ListingPageSchema),
  getListing: (id: string, account?: string | null) => request(`/listings/${id}`, ListingCatalogItemSchema, { account }),
  getEvaluator: () => request("/evaluator", EvaluatorMetadataSchema),
  getRun: (id: string) => request(`/runs/${id}`, RunSchema),
  getReceipt: (id: string) => request(`/runs/${id}/receipt`, ReceiptSchema),
  getSellerRuns: (account: string) => request("/seller/runs", z.array(SellerRunSchema), { account }),

  createListing: (dto: CreateListingDto, account: string) =>
    request("/listings", ListingSchema, { method: "POST", account, ...json(dto) }),
  patchListing: (id: string, dto: PatchListingDto, account: string) =>
    request(`/listings/${id}`, ListingSchema, { method: "PATCH", account, ...json(dto) }),
  publishListing: (id: string, account: string) =>
    request(`/listings/${id}/publish`, ListingSchema, { method: "POST", account }),

  uploadAsset: (listingId: string, role: "dataset" | "model", ciphertext: Blob, envelope: Envelope, account: string) => {
    const form = new FormData();
    form.set("ciphertext", ciphertext);
    form.set("wrapped_key", JSON.stringify(envelope));
    const path = role === "dataset" ? "dataset" : "models";
    return request(`/listings/${listingId}/${path}`, UploadAssetResponseSchema, { method: "POST", account, body: form });
  },
};

export type EvaluateOutcome =
  | { kind: "quote"; quote: z.infer<typeof X402QuoteSchema> }
  | { kind: "pending"; runId: string }
  | { kind: "done"; runId: string };

export async function evaluate(
  listingId: string,
  modelId: string,
  account: string,
  payment?: SignedPayment,
): Promise<EvaluateOutcome> {
  const headers = new Headers({ "Content-Type": "application/json", "x-account-id": account });
  if (payment) headers.set("x-payment", btoa(JSON.stringify(payment)));

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/listings/${listingId}/evaluate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model_id: modelId }),
    });
  } catch {
    throw new ApiRequestError("NETWORK", 0);
  }
  const body: unknown = await res.json().catch(() => null);

  if (res.status === 402 && !payment) return { kind: "quote", quote: X402QuoteSchema.parse(body) };
  if (res.status === 202) return { kind: "pending", runId: EvaluatePendingResponseSchema.parse(body).run_id };
  if (res.ok) return { kind: "done", runId: EvaluateSuccessResponseSchema.parse(body).run_id };

  const parsed = ApiErrorBodySchema.safeParse(body);
  throw new ApiRequestError(parsed.success ? parsed.data.error.code : "INTERNAL", res.status);
}
