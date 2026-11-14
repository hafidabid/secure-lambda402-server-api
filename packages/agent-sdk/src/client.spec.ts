import {
  createServer,
  IncomingMessage,
  ServerResponse,
} from "http";
import { AddressInfo } from "net";
import { BuyerAgentClient, PaymentSigner } from "./client";
import {
  SignedPaymentSchema,
  X402Accept,
  SignedPayment,
} from "@securelambda/schemas";

/**
 * Test suite for the agent SDK ↔ gateway seam (I8).
 * Tests all payment protocol flows: 402 quote, payment signing, retry, polling.
 */

// Helper: create a test quote
function makeTestQuote(resource: string): {
  x402Version: number;
  accepts: X402Accept[];
} {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact" as const,
        network: "near:testnet",
        asset: "near" as const,
        maxAmountRequired: "2000000000000000000000000",
        payTo: "hospital.testnet",
        resource,
        validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        nonce: "test_nonce_123",
      },
    ],
  };
}

// Helper: create a test signed payment
function makeTestSignedPayment(quote: X402Accept): SignedPayment {
  return {
    nonce: quote.nonce,
    payerId: "buyer.testnet",
    payerPublicKey:
      "ed25519:99c2c04c66c3d6df7f91b1bbe28ff5d1f1dab5c7e8e9a0b1c2d3e4f5a6b7c8d",
    payTo: quote.payTo,
    asset: quote.asset,
    amount: "1000000000000000000000000",
    validUntil: quote.validUntil,
    maxBlockHeight: 100000,
    signedDelegate: "base64_encoded_signed_delegate_action",
  };
}

describe("BuyerAgentClient", () => {
  afterEach(() => {
    // Cleanup will be done in each test
  });

  test("happy path: 402 → 200 (synchronous success)", async () => {
    let paymentHeaderReceived: string | null = null;
    let retryAttempted = false;

    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const path = req.url || "";

        // First request (no payment)
        if (!req.headers["x-payment"]) {
          res.writeHead(402, { "Content-Type": "application/json" });
          const quote = makeTestQuote(path);
          res.end(JSON.stringify(quote));
          return;
        }

        // Retry with payment
        retryAttempted = true;
        paymentHeaderReceived = req.headers["x-payment"] as string;

        const result = {
          run_id: "run_test_sync_123",
          mode: "local" as const,
          result: {
            metrics: {
              accuracy: 0.95,
              auc: 0.92,
              f1: 0.93,
            },
            n_bucket: "<100" as const,
          },
          receipt: {
            exec_tx: "tx_exec_sync_123",
            settle_tx: null,
            wasm_hash: "aaaa" + "a".repeat(60),
            attested: false,
          },
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      }
    );

    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://localhost:${port}`;

    let signerCalled = false;
    const signer: PaymentSigner = (quote: X402Accept) => {
      signerCalled = true;
      return makeTestSignedPayment(quote);
    };

    const client = new BuyerAgentClient({ baseUrl, signer });

    try {
      const result = await client.evaluate("lst_test_123", "model_v1");

      expect(result.run_id).toBe("run_test_sync_123");
      expect(result.mode).toBe("local");
      expect(result.result.metrics.accuracy).toBe(0.95);
      expect(retryAttempted).toBe(true);
      expect(signerCalled).toBe(true);
      expect(paymentHeaderReceived).not.toBeNull();

      // Verify X-Payment header is valid base64 and contains a decodable SignedPayment
      const decoded = Buffer.from(paymentHeaderReceived!, "base64").toString(
        "utf-8"
      );
      const payment = JSON.parse(decoded);
      SignedPaymentSchema.parse(payment);
      expect(payment.payerId).toBe("buyer.testnet");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("happy path: 402 → 202 → poll until SETTLED", async () => {
    let pollCount = 0;
    const listingId = "lst_async_789";
    const modelId = "model_v2";

    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const path = req.url || "";

        // POST /v1/listings/{listingId}/evaluate without payment
        if (
          req.method === "POST" &&
          path.includes("/evaluate") &&
          !req.headers["x-payment"]
        ) {
          const quote = makeTestQuote(path);
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(JSON.stringify(quote));
          return;
        }

        // POST retry with payment
        if (
          req.method === "POST" &&
          path.includes("/evaluate") &&
          req.headers["x-payment"]
        ) {
          const pending = {
            run_id: "run_async_456",
            location: "/v1/runs/run_async_456",
          };
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify(pending));
          return;
        }

        // GET /v1/runs/{runId}/receipt, asked for once the run has settled
        if (req.method === "GET" && path === "/v1/runs/run_async_456/receipt") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ exec_tx: "tx_exec_async_456", settle_tx: "tx_settle_async_456", wasm_hash: "a".repeat(64), attested: true }));
          return;
        }

        // GET /v1/runs/{runId} for polling
        if (req.method === "GET" && path.startsWith("/v1/runs/")) {
          pollCount++;
          if (pollCount === 1) {
            // First poll: still executing
            const run = {
              id: "run_async_456",
              listing_id: listingId,
              buyer_id: "buyer.testnet",
              model_id: modelId,
              state: "EXECUTING",
              payment_nonce: "test_nonce_123",
              attempt: 1,
              exec_tx_hash: "tx_exec_async_456",
              result: null,
              error_code: null,
              mode: "enclave" as const,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(run));
            return;
          }

          if (pollCount === 2) {
            // Second poll: settled with result
            const run = {
              id: "run_async_456",
              listing_id: listingId,
              buyer_id: "buyer.testnet",
              model_id: modelId,
              state: "SETTLED",
              payment_nonce: "test_nonce_123",
              attempt: 1,
              exec_tx_hash: "tx_exec_async_456",
              result: {
                metrics: {
                  accuracy: 0.88,
                  auc: 0.85,
                  f1: 0.87,
                },
                n_bucket: "100-199" as const,
              },
              error_code: null,
              mode: "enclave" as const,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(run));
            return;
          }
        }

        res.writeHead(404);
        res.end("Not found");
      }
    );

    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://localhost:${port}`;

    const signer: PaymentSigner = (quote: X402Accept) => {
      return makeTestSignedPayment(quote);
    };

    const client = new BuyerAgentClient({
      baseUrl,
      signer,
      pollIntervalMs: 50, // Fast polling for tests
    });

    try {
      const result = await client.evaluate(listingId, modelId);

      expect(result.run_id).toBe("run_async_456");
      expect(result.mode).toBe("enclave");
      expect(result.result.metrics.accuracy).toBe(0.88);
      expect(pollCount).toBe(2); // Should have polled twice
      // The receipt comes from the receipt endpoint, not guessed from the run's mode.
      expect(result.receipt).toEqual({ exec_tx: "tx_exec_async_456", settle_tx: "tx_settle_async_456", wasm_hash: "a".repeat(64), attested: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("a run that outlives the poll timeout reports its id so the caller can keep checking", async () => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const path = req.url ?? "";
      if (req.method === "POST" && !req.headers["x-payment"]) {
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(JSON.stringify(makeTestQuote(path)));
        return;
      }
      if (req.method === "POST") {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run_id: "run_slow_789", location: "/v1/runs/run_slow_789" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "run_slow_789",
          listing_id: "lst_1",
          buyer_id: "buyer.testnet",
          model_id: "mdl_1",
          state: "EXECUTING",
          payment_nonce: "test_nonce_123",
          attempt: 1,
          exec_tx_hash: "tx_exec",
          result: null,
          error_code: null,
          mode: "enclave",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const client = new BuyerAgentClient({
      baseUrl: `http://localhost:${(server.address() as AddressInfo).port}`,
      signer: makeTestSignedPayment,
      pollIntervalMs: 10,
      pollTimeoutMs: 50,
    });

    try {
      await expect(client.evaluate("lst_1", "mdl_1")).rejects.toThrow(/run_slow_789/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("negative: retry with payment still gets 402 (payment rejected)", async () => {
    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        if (!req.headers["x-payment"]) {
          // First request without payment
          const quote = makeTestQuote(req.url || "");
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(JSON.stringify(quote));
          return;
        }

        // Retry with payment still gets 402 (rejected)
        const quote = makeTestQuote(req.url || "");
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(JSON.stringify(quote));
      }
    );

    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://localhost:${port}`;

    const signer: PaymentSigner = (quote: X402Accept) => {
      return makeTestSignedPayment(quote);
    };

    const client = new BuyerAgentClient({ baseUrl, signer });

    try {
      await expect(client.evaluate("lst_reject_123", "model_v1")).rejects.toThrow(
        "payment rejected"
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("negative: polling returns FAILED_NOT_CHARGED", async () => {
    const listingId = "lst_failed_123";
    const modelId = "model_v1";

    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const path = req.url || "";

        if (req.method === "POST" && !req.headers["x-payment"]) {
          const quote = makeTestQuote(path);
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(JSON.stringify(quote));
          return;
        }

        if (req.method === "POST" && req.headers["x-payment"]) {
          const pending = {
            run_id: "run_failed_789",
            location: "/v1/runs/run_failed_789",
          };
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify(pending));
          return;
        }

        if (req.method === "GET" && path.startsWith("/v1/runs/")) {
          const run = {
            id: "run_failed_789",
            listing_id: listingId,
            buyer_id: "buyer.testnet",
            model_id: modelId,
            state: "FAILED_NOT_CHARGED",
            payment_nonce: "test_nonce_123",
            attempt: 1,
            exec_tx_hash: null,
            result: null,
            error_code: "INTERNAL",
            mode: "local" as const,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(run));
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      }
    );

    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://localhost:${port}`;

    const signer: PaymentSigner = (quote: X402Accept) => {
      return makeTestSignedPayment(quote);
    };

    const client = new BuyerAgentClient({
      baseUrl,
      signer,
      pollIntervalMs: 50,
    });

    try {
      await expect(client.evaluate(listingId, modelId)).rejects.toThrow(
        /not charged/
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("negative: polling returns PAYMENT_REJECTED", async () => {
    const listingId = "lst_payreject_123";
    const modelId = "model_v1";

    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const path = req.url || "";

        if (req.method === "POST" && !req.headers["x-payment"]) {
          const quote = makeTestQuote(path);
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(JSON.stringify(quote));
          return;
        }

        if (req.method === "POST" && req.headers["x-payment"]) {
          const pending = {
            run_id: "run_payreject_789",
            location: "/v1/runs/run_payreject_789",
          };
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify(pending));
          return;
        }

        if (req.method === "GET" && path.startsWith("/v1/runs/")) {
          const run = {
            id: "run_payreject_789",
            listing_id: listingId,
            buyer_id: "buyer.testnet",
            model_id: modelId,
            state: "PAYMENT_REJECTED",
            payment_nonce: "test_nonce_123",
            attempt: 1,
            exec_tx_hash: null,
            result: null,
            error_code: "INTERNAL",
            mode: "local" as const,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(run));
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      }
    );

    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://localhost:${port}`;

    const signer: PaymentSigner = (quote: X402Accept) => {
      return makeTestSignedPayment(quote);
    };

    const client = new BuyerAgentClient({
      baseUrl,
      signer,
      pollIntervalMs: 50,
    });

    try {
      await expect(client.evaluate(listingId, modelId)).rejects.toThrow(
        /not charged/
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("quote returns the 402 accept without signing or retrying", async () => {
    let requests = 0;
    let authorization: string | undefined;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      requests++;
      authorization = req.headers["authorization"] as string | undefined;
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(JSON.stringify(makeTestQuote(req.url || "")));
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

    let signerCalled = false;
    const client = new BuyerAgentClient({
      baseUrl,
      signer: (q) => {
        signerCalled = true;
        return makeTestSignedPayment(q);
      },
      headers: { authorization: "Bearer t" },
    });

    try {
      const accept = await client.quote("lst_q", "mdl_q");
      expect(accept.maxAmountRequired).toBe("2000000000000000000000000");
      expect(accept.payTo).toBe("hospital.testnet");
      expect(accept.resource).toBe("/v1/listings/lst_q/evaluate");
      expect(requests).toBe(1);
      expect(authorization).toBe("Bearer t");
      expect(signerCalled).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("quote throws with the gateway error when the response is not 402", async () => {
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "LISTING_NOT_PUBLISHED", message: "draft" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    const client = new BuyerAgentClient({ baseUrl, signer: makeTestSignedPayment });
    try {
      await expect(client.quote("lst_q", "mdl_q")).rejects.toThrow("quote failed: 409 LISTING_NOT_PUBLISHED - draft");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
