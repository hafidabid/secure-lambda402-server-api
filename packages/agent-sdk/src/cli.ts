import { BuyerAgentClient, PaymentSigner } from "./client";

const notImplementedSigner: PaymentSigner = () => {
  throw new Error("not implemented — plug in a real NEAR wallet signer");
};

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
    signer: notImplementedSigner,
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
