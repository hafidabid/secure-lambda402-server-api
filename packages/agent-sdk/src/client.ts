import {
  X402Accept,
  X402QuoteSchema,
  SignedPayment,
  SignedPaymentSchema,
  EvaluateSuccessResponseSchema,
  EvaluateSuccessResponse,
  EvaluatePendingResponseSchema,
  RunSchema,
  ReceiptSchema,
  isTerminal,
} from "@securelambda/schemas";
import { z } from "zod";

const ApiErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Reads the gateway's `{ error: { code, message } }` body as " CODE - message", or "" when absent. */
export async function apiErrorDetail(response: Response): Promise<string> {
  const body = ApiErrorBodySchema.safeParse(await response.json().catch(() => null));
  return body.success ? ` ${body.data.error.code} - ${body.data.error.message}` : "";
}

/**
 * Injected signer function that takes a payment quote and returns a signed payment.
 * In production, this would sign a real NEAR transaction; in tests, it can be mocked.
 */
export type PaymentSigner = (quote: X402Accept) => Promise<SignedPayment> | SignedPayment;

export interface BuyerAgentClientOptions {
  baseUrl: string;
  signer: PaymentSigner;
  /**
   * Extra headers sent on every request. A function is called per request, so a session token can be refreshed
   * (see `createNearLogin`). Not for `x-account-id`: the API ignores it unless it runs in dev header mode.
   */
  headers?: Record<string, string> | (() => Promise<Record<string, string>>);
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/**
 * Client for interacting with the SecureLambda gateway API using x402 payment protocol.
 * Handles the full flow: request → 402 quote → payment signing → retry → result/polling.
 */
export class BuyerAgentClient {
  private readonly baseUrl: string;
  private readonly signer: PaymentSigner;
  private readonly extraHeaders: NonNullable<BuyerAgentClientOptions["headers"]>;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: BuyerAgentClientOptions) {
    this.baseUrl = options.baseUrl;
    this.signer = options.signer;
    this.extraHeaders = options.headers ?? {};
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 180000;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return typeof this.extraHeaders === "function" ? this.extraHeaders() : this.extraHeaders;
  }

  /** Fetches the 402 payment quote for a run without signing or paying. */
  async quote(listingId: string, modelId: string): Promise<X402Accept> {
    const response = await fetch(`${this.baseUrl}/v1/listings/${listingId}/evaluate`, {
      method: "POST",
      headers: { ...(await this.authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: modelId }),
    });
    if (response.status !== 402) {
      throw new Error(`quote failed: ${response.status}${await apiErrorDetail(response)}`);
    }
    const accept = X402QuoteSchema.parse(await response.json()).accepts[0];
    if (!accept) throw new Error("No payment accepts in 402 response");
    return accept;
  }

  /**
   * Evaluate a model against a listing, handling x402 payment protocol.
   * Returns the evaluation result once available or settled.
   */
  async evaluate(listingId: string, modelId: string): Promise<EvaluateSuccessResponse> {
    const url = `${this.baseUrl}/v1/listings/${listingId}/evaluate`;
    const body = JSON.stringify({ model_id: modelId });
    const authHeaders = await this.authHeaders();

    // First request without payment
    let response = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body,
    });

    // If 402, we need to get a quote and retry with payment
    if (response.status === 402) {
      const quote = X402QuoteSchema.parse(await response.json());
      const accept = quote.accepts[0];
      if (!accept) {
        throw new Error("No payment accepts in 402 response");
      }

      // Sign the payment using the injected signer
      const signedPayment = await this.signer(accept);
      SignedPaymentSchema.parse(signedPayment); // Validate it

      // Encode payment as base64
      const paymentHeader = Buffer.from(JSON.stringify(signedPayment)).toString("base64");

      // Retry with X-Payment header
      response = await fetch(url, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          "X-Payment": paymentHeader,
        },
        body,
      });

      // Check if we got another 402 (payment rejected)
      if (response.status === 402) {
        // The gateway says why (e.g. PAYMENT_INVALID: insufficient balance); pass that on instead of a bare "rejected".
        const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
        const detail = body.error ? `: ${body.error.code} - ${body.error.message}` : "";
        throw new Error(`payment rejected${detail}`);
      }
    }

    // Handle 200 (immediate success)
    if (response.status === 200) {
      const result = EvaluateSuccessResponseSchema.parse(await response.json());
      return result;
    }

    // Handle 202 (pending - need to poll)
    if (response.status === 202) {
      const pending = EvaluatePendingResponseSchema.parse(await response.json());
      return this.pollUntilSettled(pending.location);
    }

    // Unexpected status
    throw new Error(`Unexpected response status: ${response.status}`);
  }

  /**
   * Poll a location endpoint until the run reaches a terminal state.
   */
  private async pollUntilSettled(location: string): Promise<EvaluateSuccessResponse> {
    const url = `${this.baseUrl}${location}`;
    const startTime = Date.now();

    while (true) {
      // Check timeout
      if (Date.now() - startTime > this.pollTimeoutMs) {
        throw new Error("Polling timeout exceeded");
      }

      // Poll the location
      const response = await fetch(url, { headers: await this.authHeaders() });
      if (!response.ok) {
        throw new Error(`Poll request failed: ${response.status}`);
      }

      const run = RunSchema.parse(await response.json());

      // Check if terminal
      if (isTerminal(run.state)) {
        if (run.state === "SETTLED") {
          // Build success response from the run
          if (!run.result) {
            throw new Error("SETTLED run missing result field");
          }
          // The run object has no payment/attestation data, so ask the receipt endpoint for the real values.
          const receiptResponse = await fetch(`${url}/receipt`, { headers: await this.authHeaders() });
          const receipt = receiptResponse.ok
            ? ReceiptSchema.parse(await receiptResponse.json())
            : { exec_tx: run.exec_tx_hash ?? "", settle_tx: null, wasm_hash: "", attested: false };
          return EvaluateSuccessResponseSchema.parse({
            run_id: run.id,
            mode: run.mode,
            result: run.result,
            receipt,
          });
        }

        // Terminal but not settled - error state
        const errorMsg = run.error_code
          ? `error code ${run.error_code}`
          : run.state;
        throw new Error(`Run failed: ${errorMsg} (not charged)`);
      }

      // Not terminal yet - wait and retry
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }
}
