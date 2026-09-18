// Shared helper: is Arc mainnet's public RPC reachable from this runner? (chain id 5042 = 0x13b2)
export async function rpcReachable(): Promise<boolean> {
  try {
    const r = await fetch("https://rpc.mainnet.arc.io", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(8_000),
    });
    const j = (await r.json()) as { result?: string };
    return j.result === "0x13b2";
  } catch { return false; }
}
