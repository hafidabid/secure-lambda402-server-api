import { http, HttpResponse, delay } from "msw";
import {
  AuthChallengeRequestSchema,
  AuthLoginRequestSchema,
  CreateListingDtoSchema,
  ERROR_CODE_INFO,
  EnvelopeSchema,
  EvaluateRequestDtoSchema,
  ListingCatalogItemSchema,
  MAX_UPLOAD_BYTES_TONIGHT,
  PatchListingDtoSchema,
  SignedPaymentSchema,
  type ErrorCode,
  type Listing,
  type Receipt,
  type Run,
  type RunState,
  type SignedPayment,
  type X402Accept,
} from "@securelambda/schemas";
import { API_URL } from "@/lib/api";
import { EVALUATOR, LISTINGS, SELLER_ALLOW_LIST } from "./fixtures";

export type Scenario = "happy" | "instant" | "slow" | "fail" | "enclave" | "rejected" | "ratelimited";

const SCENARIOS: Scenario[] = ["happy", "instant", "slow", "fail", "enclave", "rejected", "ratelimited"];

export function scenarioFrom(search: string): Scenario {
  const s = new URLSearchParams(search).get("scenario");
  return SCENARIOS.find((x) => x === s) ?? "happy";
}

const base = `${API_URL}/v1`;
const listings = new Map<string, Listing>(LISTINGS.map((l) => [l.id, l]));
const challenges = new Map<string, string>();
const sessions = new Map<string, string>();
const models = new Map<string, { listingId: string; owner: string }>();
const quotes = new Map<string, X402Accept>();
const paidRuns = new Map<string, { runId: string; payment: string }>();
const runs = new Map<string, { run: Run; startedAt: number; scenario: Scenario }>();

function apiError(code: ErrorCode, message: string = code) {
  const info = ERROR_CODE_INFO[code];
  return HttpResponse.json({ error: { code, message, retryable: info.retryable } }, { status: info.httpStatus });
}

const randomId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

type Caller = { account: string | null } | { error: Response };

function caller(request: Request): Caller {
  const header = request.headers.get("authorization");
  if (!header) return { account: null };
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const account = token ? sessions.get(token) : undefined;
  return account ? { account } : { error: apiError("UNAUTHENTICATED", "session is invalid or expired; log in again") };
}

function signedIn(request: Request): { account: string } | { error: Response } {
  const c = caller(request);
  if ("error" in c) return c;
  return c.account ? { account: c.account } : { error: apiError("UNAUTHENTICATED", "log in first") };
}

function seller(request: Request): { account: string } | { error: Response } {
  const c = signedIn(request);
  if ("error" in c) return c;
  return SELLER_ALLOW_LIST.includes(c.account) ? c : { error: apiError("FORBIDDEN", "account is not on the seller allow-list") };
}

function ownedListing(id: string, account: string): { listing: Listing } | { error: Response } {
  const listing = listings.get(id);
  if (!listing) return { error: apiError("LISTING_NOT_FOUND") };
  return listing.seller_id === account ? { listing } : { error: apiError("NOT_OWNER") };
}

function isEnvelope(raw: FormDataEntryValue | null): boolean {
  try {
    return EnvelopeSchema.safeParse(JSON.parse(String(raw))).success;
  } catch {
    return false;
  }
}

async function sealedUpload(request: Request): Promise<{ bytes: number } | { error: Response }> {
  const form = await request.formData();
  const ciphertext = form.get("ciphertext");
  if (!(ciphertext instanceof Blob) || !isEnvelope(form.get("wrapped_key"))) return { error: apiError("ENVELOPE_INVALID") };
  if (ciphertext.size > MAX_UPLOAD_BYTES_TONIGHT) return { error: apiError("ASSET_TOO_LARGE") };
  return { bytes: ciphertext.size };
}

const STEP_MS = 1500;

// Each step: [ms since start, state]. "slow" stalls in EXECUTING past the 30 s "taking longer" threshold.
const TIMELINES: Record<"happy" | "slow" | "fail", [number, RunState][]> = {
  happy: [[0, "PAYMENT_VERIFIED"], [STEP_MS, "QUEUED"], [STEP_MS * 2, "EXECUTING"], [STEP_MS * 4, "RESULT_READY"], [STEP_MS * 5, "SETTLED"]],
  slow: [[0, "PAYMENT_VERIFIED"], [STEP_MS, "QUEUED"], [STEP_MS * 2, "EXECUTING"], [38000, "RESULT_READY"], [40000, "SETTLED"]],
  fail: [[0, "PAYMENT_VERIFIED"], [STEP_MS, "QUEUED"], [STEP_MS * 2, "EXECUTING"], [STEP_MS * 4, "FAILED_NOT_CHARGED"]],
};

function timelineFor(scenario: Scenario) {
  if (scenario === "slow" || scenario === "fail") return TIMELINES[scenario];
  return TIMELINES.happy;
}

function current(id: string): { run: Run; receipt: Receipt } | null {
  const entry = runs.get(id);
  if (!entry) return null;
  const elapsed = entry.scenario === "instant" ? Infinity : Date.now() - entry.startedAt;
  const reached = timelineFor(entry.scenario).filter(([t]) => elapsed >= t);
  const state: RunState = reached[reached.length - 1]?.[1] ?? "REQUESTED";
  const hasResult = state === "RESULT_READY" || state === "SETTLE_PENDING" || state === "SETTLED";
  const started = state !== "PAYMENT_VERIFIED" && state !== "QUEUED";
  const run: Run = {
    ...entry.run,
    state,
    updated_at: new Date().toISOString(),
    exec_tx_hash: started ? "9bR2cT7wXk4mJp8sNq1vLd6fHz3yGa5eLq3vM8eK" : null,
    result: hasResult ? { metrics: { accuracy: 0.83, auc: 0.9, f1: 0.8 }, n_bucket: "500-999" } : null,
    error_code: state === "FAILED_NOT_CHARGED" ? "MODEL_UNUSABLE" : null,
  };
  const receipt: Receipt = {
    exec_tx: run.exec_tx_hash ?? "",
    settle_tx: state === "SETTLED" ? "67fYJJ4Gk9xQ2mVt7bRw3nPy6cJs8dLh1aHf7sP1aZ" : null,
    wasm_hash: started ? EVALUATOR.wasm_hash : "",
    pinned_wasm_hash: EVALUATOR.wasm_hash,
    attested: hasResult && entry.run.mode === "enclave",
  };
  return { run, receipt };
}

function decodePayment(header: string): SignedPayment | null {
  try {
    return SignedPaymentSchema.safeParse(JSON.parse(atob(header))).data ?? null;
  } catch {
    return null;
  }
}

function startRun(listing: Listing, buyer: string, modelId: string, payment: SignedPayment, scenario: Scenario): string {
  const id = `run_01HZX${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const created = new Date().toISOString();
  runs.set(id, {
    startedAt: Date.now(),
    scenario,
    run: {
      id,
      listing_id: listing.id,
      buyer_id: buyer,
      model_id: modelId,
      state: "PAYMENT_VERIFIED",
      payment_nonce: payment.nonce,
      attempt: 0,
      exec_tx_hash: null,
      result: null,
      error_code: null,
      mode: scenario === "enclave" ? "enclave" : "local",
      created_at: created,
      updated_at: created,
    },
  });
  return id;
}

export function handlers(scenario: Scenario) {
  return [
    http.get(`${base}/evaluator`, () => HttpResponse.json(EVALUATOR)),

    http.post(`${base}/auth/challenge`, async ({ request }) => {
      const body = AuthChallengeRequestSchema.safeParse(await request.json());
      if (!body.success) return apiError("VALIDATION_FAILED", body.error.message);
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      challenges.set(nonce, body.data.account_id);
      return HttpResponse.json({
        nonce,
        message: `Log in to SecureLambda as ${body.data.account_id}`,
        recipient: "securelambda-api",
        expires_in: 300,
      });
    }),

    http.post(`${base}/auth/login`, async ({ request }) => {
      await delay(200);
      const body = AuthLoginRequestSchema.safeParse(await request.json());
      if (!body.success) return apiError("VALIDATION_FAILED", body.error.message);
      if (challenges.get(body.data.nonce) !== body.data.account_id) return apiError("UNAUTHENTICATED", "unknown or used challenge");
      challenges.delete(body.data.nonce);
      const token = randomId("tok");
      sessions.set(token, body.data.account_id);
      return HttpResponse.json({ token, account_id: body.data.account_id, expires_in: 3600 });
    }),

    http.post(`${base}/auth/logout`, ({ request }) => {
      const c = signedIn(request);
      if ("error" in c) return c.error;
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (token) sessions.delete(token);
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(`${base}/listings`, async ({ request }) => {
      await delay(250);
      const c = caller(request);
      if ("error" in c) return c.error;
      const url = new URL(request.url);
      const q = url.searchParams.get("q")?.toLowerCase() ?? "";
      const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 20)), 100);
      const cursor = url.searchParams.get("cursor");
      const all = [...listings.values()]
        .filter((l) => l.status === "published" && l.name.toLowerCase().includes(q))
        .sort((a, b) => a.id.localeCompare(b.id));
      const start = cursor ? all.findIndex((l) => l.id === atob(cursor)) + 1 : 0;
      const page = all.slice(start, start + limit);
      const next = all[start + limit];
      return HttpResponse.json({
        items: page.map((l) => ListingCatalogItemSchema.parse(l)),
        next_cursor: next && page.length ? btoa(page[page.length - 1]!.id) : null,
      });
    }),

    http.get(`${base}/listings/:id`, async ({ params, request }) => {
      await delay(150);
      const c = caller(request);
      if ("error" in c) return c.error;
      const l = listings.get(String(params.id));
      if (l?.status === "published") return HttpResponse.json(ListingCatalogItemSchema.parse(l));
      if (l && l.seller_id === c.account) return HttpResponse.json(l);
      return apiError("LISTING_NOT_FOUND");
    }),

    http.post(`${base}/listings`, async ({ request }) => {
      const c = seller(request);
      if ("error" in c) return c.error;
      const dto = CreateListingDtoSchema.safeParse(await request.json());
      if (!dto.success) return apiError("VALIDATION_FAILED", dto.error.message);
      const listing: Listing = {
        ...dto.data,
        id: randomId("lst"),
        seller_id: c.account,
        dataset_asset_id: null,
        status: "draft",
        created_at: new Date().toISOString(),
        published_at: null,
      };
      listings.set(listing.id, listing);
      return HttpResponse.json(listing, { status: 201 });
    }),

    http.patch(`${base}/listings/:id`, async ({ params, request }) => {
      const c = seller(request);
      if ("error" in c) return c.error;
      const owned = ownedListing(String(params.id), c.account);
      if ("error" in owned) return owned.error;
      if (owned.listing.status === "published") return apiError("CONFLICT", "pause the listing before editing it");
      const dto = PatchListingDtoSchema.safeParse(await request.json());
      if (!dto.success) return apiError("VALIDATION_FAILED", dto.error.message);
      const next = { ...owned.listing, ...dto.data };
      listings.set(next.id, next);
      return HttpResponse.json(next);
    }),

    http.post(`${base}/listings/:id/dataset`, async ({ params, request }) => {
      await delay(900);
      const c = seller(request);
      if ("error" in c) return c.error;
      const owned = ownedListing(String(params.id), c.account);
      if ("error" in owned) return owned.error;
      const upload = await sealedUpload(request);
      if ("error" in upload) return upload.error;
      const assetId = `ast_${owned.listing.id}`;
      listings.set(owned.listing.id, { ...owned.listing, dataset_asset_id: assetId });
      return HttpResponse.json({ asset_id: assetId }, { status: 201 });
    }),

    http.post(`${base}/listings/:id/publish`, ({ params, request }) => {
      const c = seller(request);
      if ("error" in c) return c.error;
      const owned = ownedListing(String(params.id), c.account);
      if ("error" in owned) return owned.error;
      if (!owned.listing.dataset_asset_id) return apiError("CONFLICT", "upload the dataset first");
      const next: Listing = { ...owned.listing, status: "published", published_at: new Date().toISOString() };
      listings.set(next.id, next);
      return HttpResponse.json(next);
    }),

    http.get(`${base}/seller/runs`, ({ request }) => {
      const c = signedIn(request);
      if ("error" in c) return c.error;
      const mine = new Set([...listings.values()].filter((l) => l.seller_id === c.account).map((l) => l.id));
      const rows = [...runs.keys()]
        .map((id) => current(id)?.run)
        .filter((r): r is Run => !!r && mine.has(r.listing_id))
        .reverse()
        .map((r) => ({ id: r.id, buyer_id: r.buyer_id, state: r.state, created_at: r.created_at }));
      return HttpResponse.json(rows);
    }),

    http.post(`${base}/listings/:id/models`, async ({ params, request }) => {
      await delay(700);
      const c = signedIn(request);
      if ("error" in c) return c.error;
      const listing = listings.get(String(params.id));
      if (!listing) return apiError("LISTING_NOT_FOUND");
      if (listing.status !== "published") return apiError("LISTING_NOT_PUBLISHED");
      const upload = await sealedUpload(request);
      if ("error" in upload) return upload.error;
      const modelId = randomId("mdl");
      models.set(modelId, { listingId: listing.id, owner: c.account });
      return HttpResponse.json({ model_id: modelId }, { status: 201 });
    }),

    http.post(`${base}/listings/:id/evaluate`, async ({ params, request }) => {
      await delay(300);
      const c = signedIn(request);
      if ("error" in c) return c.error;
      const listing = listings.get(String(params.id));
      if (!listing) return apiError("LISTING_NOT_FOUND");
      if (listing.status !== "published") return apiError("LISTING_NOT_PUBLISHED");
      const body = EvaluateRequestDtoSchema.safeParse(await request.json());
      if (!body.success) return apiError("VALIDATION_FAILED", body.error.message);
      const model = models.get(body.data.model_id);
      if (!model || model.owner !== c.account) return apiError("MODEL_NOT_FOUND");
      if (model.listingId !== listing.id) return apiError("MODEL_BOUND_TO_OTHER_LISTING");

      const header = request.headers.get("x-payment");
      if (!header) {
        const accept: X402Accept = {
          scheme: "exact",
          network: "near:testnet",
          asset: "near",
          maxAmountRequired: listing.price_amount,
          payTo: listing.seller_id,
          assetContract: "wrap.testnet",
          resource: `/v1/listings/${listing.id}/evaluate`,
          validUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
          nonce: crypto.randomUUID(),
        };
        quotes.set(accept.nonce, accept);
        return HttpResponse.json({ x402Version: 1, accepts: [accept] }, { status: 402 });
      }

      if (scenario === "ratelimited") return apiError("RATE_LIMITED");
      const payment = decodePayment(header);
      const quote = payment && quotes.get(payment.nonce);
      if (!payment || !quote || payment.amount !== quote.maxAmountRequired || payment.payTo !== quote.payTo) {
        return apiError("PAYMENT_INVALID", "payment does not match the quote");
      }
      if (scenario === "rejected") return apiError("PAYMENT_INVALID", "insufficient wNEAR balance");
      const replay = paidRuns.get(payment.nonce);
      if (replay && replay.payment !== header) return apiError("PAYMENT_REUSED");

      const runId = replay?.runId ?? startRun(listing, c.account, body.data.model_id, payment, scenario);
      paidRuns.set(payment.nonce, { runId, payment: header });

      const done = current(runId);
      if (scenario === "instant" && done?.run.result) {
        return HttpResponse.json({ run_id: runId, mode: done.run.mode, result: done.run.result, receipt: done.receipt });
      }
      return HttpResponse.json({ run_id: runId, location: `/v1/runs/${runId}` }, { status: 202, headers: { Location: `/v1/runs/${runId}` } });
    }),

    http.get(`${base}/runs/:id/receipt`, ({ params, request }) => {
      const c = signedIn(request);
      if ("error" in c) return c.error;
      const found = current(String(params.id));
      if (!found || found.run.buyer_id !== c.account) return HttpResponse.json({ statusCode: 404, message: "Not Found" }, { status: 404 });
      return HttpResponse.json(found.receipt);
    }),

    http.get(`${base}/runs/:id`, ({ params, request }) => {
      const c = signedIn(request);
      if ("error" in c) return c.error;
      const found = current(String(params.id));
      if (!found || found.run.buyer_id !== c.account) return HttpResponse.json({ statusCode: 404, message: "Not Found" }, { status: 404 });
      return HttpResponse.json(found.run);
    }),
  ];
}
