/**
 * Submits a single signed transaction as a Jito bundle. A bundle can hold up
 * to 5 transactions atomically, but a single-tx bundle is all a mint needs —
 * it's the tip inside the transaction, not the bundle size, that buys
 * priority.
 *
 * Returns the bundle ID Jito assigns, which is NOT the same as the
 * transaction signature — callers should track the tx signature themselves
 * (computed at signing time) for confirmation polling.
 */
export async function submitJitoBundle(base58Tx: string, blockEngineUrl: string): Promise<string> {
  const response = await fetch(`${blockEngineUrl}/api/v1/bundles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[base58Tx]],
    }),
  });

  if (!response.ok) {
    throw new Error(`Jito block engine returned HTTP ${response.status}`);
  }

  const json = (await response.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(`Jito bundle rejected: ${json.error.message}`);
  if (!json.result) throw new Error("Jito bundle submission returned no result");
  return json.result;
}
