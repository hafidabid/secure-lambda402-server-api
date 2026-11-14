import { BuyerAgentClient, PaymentSigner } from "./client";
import { createNearPaymentSigner } from "./near-signer";

/** Signs real NEAR payments when NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY are set; otherwise fails clearly. */
function signerFromEnv(): PaymentSigner {
  const accountId = process.env.NEAR_ACCOUNT_ID;
  const privateKey = process.env.NEAR_PRIVATE_KEY;
  if (!accountId || !privateKey) {
    return () => {
      throw new Error("set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (optionally NEAR_RPC_URL) to pay for runs");
    };
  }
  return createNearPaymentSigner({
    accountId,
    privateKey,
    rpcUrl: process.env.NEAR_RPC_URL,
    autoWrapNear: process.env.NEAR_AUTO_WRAP === "1", // spends the buyer's NEAR to top up wNEAR
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("Usage: cli.ts <baseUrl> <listingId> <modelId>");
    process.exit(1);
  }

  const baseUrl = args[0]!;
  const listingId = args[1]!;
  const modelId = args[2]!;

  const client = new BuyerAgentClient({
    baseUrl,
    signer: signerFromEnv(),
  });

  try {
    const result = await client.evaluate(listingId, modelId);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Evaluation failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
