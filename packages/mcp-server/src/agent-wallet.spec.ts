import { nearChain } from "./agent-wallet";

const accountView = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: { amount: "100" } }), { status: 200 });

describe("nearChain", () => {
  afterEach(() => jest.restoreAllMocks());

  it("retries a dropped connection to the RPC instead of failing the tool call", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(accountView());

    await expect(nearChain("https://rpc.test").balanceYocto("agent.testnet")).resolves.toBe(100n);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after repeated failures", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    await expect(nearChain("https://rpc.test").balanceYocto("agent.testnet")).rejects.toThrow("fetch failed");
  });

  it("does not retry a real answer such as an unknown account", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", error: { name: "HANDLER_ERROR" } }), { status: 200 }));

    await expect(nearChain("https://rpc.test").balanceYocto("missing.testnet")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
