import { http, HttpResponse, delay } from "msw";
import {
  CreateListingDtoSchema,
  ERROR_CODE_INFO,
  EvaluateRequestDtoSchema,
  PatchListingDtoSchema,
  type ErrorCode,
  type Listing,
  type Receipt,
  type Run,
  type RunState,
} from "@securelambda/schemas";
import { API_URL } from "@/lib/api";
import { EVALUATOR, LISTINGS } from "./fixtures";

export type Scenario = "happy" | "slow" | "fail" | "local" | "rejected" | "ratelimited";

const SCENARIOS: Scenario[] = ["happy", "slow", "fail", "local", "rejected", "ratelimited"];

export function scenarioFrom(search: string): Scenario {
  const s = new URLSearchParams(search).get("scenario");
  return SCENARIOS.find((x) => x === s) ?? "happy";
}

const base = `${API_URL}/v1`;
const listings = new Map<string, Listing>(LISTINGS.map((l) => [l.id, l]));
const runs = new Map<string, { run: Run; startedAt: number; scenario: Scenario }>();

function apiError(code: ErrorCode, message: string = code) {
  const info = ERROR_CODE_INFO[code];
  return HttpResponse.json({ error: { code, message, retryable: info.retryable } }, { status: info.httpStatus });
}

// Each step: [ms since start, state]. "slow" stalls in EXECUTING past the 30 s slow threshold.
const TIMELINES: Record<"happy" | "slow" | "fail" | "local", [number, RunState][]> = {
  happy: [[0, "PAYMENT_VERIFIED"], [1500, "SUBMITTED"], [3000, "EXECUTING"], [6000, "RESULT_READY"], [8000, "SETTLED"]],
  slow: [[0, "PAYMENT_VERIFIED"], [1500, "SUBMITTED"], [3000, "EXECUTING"], [38000, "RESULT_READY"], [40000, "SETTLED"]],
  fail: [[0, "PAYMENT_VERIFIED"], [1500, "SUBMITTED"], [3000, "EXECUTING"], [7000, "FAILED_NOT_CHARGED"]],
  local: [[0, "PAYMENT_VERIFIED"], [1500, "EXECUTING"], [3500, "RESULT_READY"], [5000, "SETTLED"]],
};

function timelineFor(scenario: Scenario) {
  if (scenario === "slow" || scenario === "fail" || scenario === "local") return TIMELINES[scenario];
  return TIMELINES.happy;
}

function current(id: string): { run: Run; receipt: Receipt } | null {
  const entry = runs.get(id);
  if (!entry) return null;
  const elapsed = Date.now() - entry.startedAt;
  const reached = timelineFor(entry.scenario).filter(([t]) => elapsed >= t);
  const state: RunState = reached[reached.length - 1]?.[1] ?? "REQUESTED";
  const hasResult = state === "RESULT_READY" || state === "SETTLE_PENDING" || state === "SETTLED";
  const run: Run = {
    ...entry.run,
    state,
    updated_at: new Date().toISOString(),
    exec_tx_hash: hasResult ? "9bR2cT7wXk4mJp8sNq1vLd6fHz3yGa5eLq3vM8eK" : null,
    result: hasResult ? { metrics: { accuracy: 0.83, auc: 0.9, f1: 0.8 }, n_bucket: "500-999" } : null,
  };
  const receipt: Receipt = {
    exec_tx: run.exec_tx_hash ?? "",
    settle_tx: state === "SETTLED" ? "4Gk9xQ2mVt7bRw3nPy6cJs8dLh1aHf7sP1aZ" : null,
    wasm_hash: hasResult ? EVALUATOR.wasm_hash : "",
    attested: hasResult && entry.scenario !== "local",
  };
  return { run, receipt };
}

export function handlers(scenario: Scenario) {
  return [
    http.get(`${base}/evaluator`, () => HttpResponse.json(EVALUATOR)),

    http.get(`${base}/listings`, async ({ request }) => {
      await delay(250);
      const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
      const items = [...listings.values()].filter(
        (l) => l.status === "published" && (l.name.toLowerCase().includes(q) || l.schema.features.some((f) => f.name.includes(q))),
      );
      return HttpResponse.json({ items, next_cursor: null });
    }),

    http.get(`${base}/listings/:id`, async ({ params }) => {
      await delay(150);
      const l = listings.get(String(params.id));
      return l ? HttpResponse.json(l) : apiError("LISTING_NOT_FOUND");
    }),

    http.post(`${base}/listings`, async ({ request }) => {
      const account = request.headers.get("x-account-id");
      if (!account) return apiError("FORBIDDEN");
      const dto = CreateListingDtoSchema.safeParse(await request.json());
      if (!dto.success) return apiError("VALIDATION_FAILED", dto.error.message);
      const id = `lst_${Math.random().toString(36).slice(2, 8)}`;
      const listing: Listing = {
        ...dto.data,
        id,
        seller_id: account,
        dataset_asset_id: null,
        status: "draft",
        created_at: new Date().toISOString(),
        published_at: null,
      };
      listings.set(id, listing);
      return HttpResponse.json(listing, { status: 201 });
    }),

    http.patch(`${base}/listings/:id`, async ({ params, request }) => {
      const l = listings.get(String(params.id));
      if (!l) return apiError("LISTING_NOT_FOUND");
      const dto = PatchListingDtoSchema.safeParse(await request.json());
      if (!dto.success) return apiError("VALIDATION_FAILED", dto.error.message);
      const next = { ...l, ...dto.data };
      listings.set(l.id, next);
      return HttpResponse.json(next);
    }),

    http.post(`${base}/listings/:id/dataset`, async ({ params }) => {
      await delay(1200);
      const l = listings.get(String(params.id));
      if (!l) return apiError("LISTING_NOT_FOUND");
      listings.set(l.id, { ...l, dataset_asset_id: `ast_${l.id}` });
      return HttpResponse.json({ asset_id: `ast_${l.id}` });
    }),

    http.post(`${base}/listings/:id/models`, async () => {
      await delay(900);
      return HttpResponse.json({ asset_id: `mdl_${Math.random().toString(36).slice(2, 6)}` });
    }),

    http.post(`${base}/listings/:id/publish`, ({ params }) => {
      const l = listings.get(String(params.id));
      if (!l) return apiError("LISTING_NOT_FOUND");
      if (!l.dataset_asset_id) return apiError("CONFLICT", "Add the dataset first");
      const next: Listing = { ...l, status: "published", published_at: new Date().toISOString() };
      listings.set(l.id, next);
      return HttpResponse.json(next);
    }),

    http.post(`${base}/listings/:id/evaluate`, async ({ params, request }) => {
      await delay(300);
      const listing = listings.get(String(params.id));
      if (!listing) return apiError("LISTING_NOT_FOUND");
      if (!request.headers.get("x-payment")) {
        return HttpResponse.json(
          {
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "near:testnet",
                asset: "near",
                maxAmountRequired: listing.price_amount,
                payTo: listing.seller_id,
                resource: request.url,
                validUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
                nonce: crypto.randomUUID(),
              },
            ],
          },
          { status: 402 },
        );
      }
      if (scenario === "rejected") return apiError("PAYMENT_INVALID");
      if (scenario === "ratelimited") return apiError("RATE_LIMITED");

      const body = EvaluateRequestDtoSchema.parse(await request.json());
      const id = `run_01HZX${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const created = new Date().toISOString();
      runs.set(id, {
        startedAt: Date.now(),
        scenario,
        run: {
          id,
          listing_id: listing.id,
          buyer_id: request.headers.get("x-account-id") ?? "",
          model_id: body.model_id,
          state: "PAYMENT_VERIFIED",
          payment_nonce: "n",
          attempt: 0,
          exec_tx_hash: null,
          result: null,
          error_code: null,
          mode: scenario === "local" ? "local" : "enclave",
          created_at: created,
          updated_at: created,
        },
      });
      return HttpResponse.json({ run_id: id, location: `/v1/runs/${id}` }, { status: 202 });
    }),

    http.get(`${base}/runs/:id/receipt`, ({ params }) => {
      const c = current(String(params.id));
      return c ? HttpResponse.json(c.receipt) : apiError("LISTING_NOT_FOUND");
    }),

    http.get(`${base}/runs/:id`, ({ params }) => {
      const c = current(String(params.id));
      return c ? HttpResponse.json(c.run) : new HttpResponse(null, { status: 404 });
    }),

    http.get(`${base}/seller/runs`, ({ request }) => {
      const account = request.headers.get("x-account-id");
      const mine = new Set([...listings.values()].filter((l) => l.seller_id === account).map((l) => l.id));
      const rows = [...runs.keys()]
        .map((id) => current(id)?.run)
        .filter((r): r is Run => !!r && mine.has(r.listing_id))
        .map((r) => ({ id: r.id, buyer_id: r.buyer_id, state: r.state, created_at: r.created_at }));
      return HttpResponse.json(rows);
    }),
  ];
}
