import { sanitize } from "./sanitize.js";

const SANDBOX_URL = "https://api-sandbox.coinbase.com/api/v3/brokerage/orders/preview";

function requestBody(order) {
  return {
    product_id: order.product_id,
    side: order.side,
    order_configuration: {
      market_market_ioc: {
        quote_size: order.quote_size,
      },
    },
  };
}

export async function fetchStaticSandboxPreview(order, { scenario, fetchImpl = fetch } = {}) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (scenario) headers["X-Sandbox"] = scenario;

  const response = await fetchImpl(SANDBOX_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody(order)),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (text.length > 256 * 1024) {
    throw new Error("Coinbase static sandbox response exceeded the safety limit");
  }
  if (!response.ok) throw new Error(`Coinbase static sandbox returned HTTP ${response.status}`);

  return {
    source: "coinbase_static_sandbox",
    limitation: "Static mocked response; request values are ignored and this is not client proof.",
    scenario: scenario ?? "default",
    response: sanitize(JSON.parse(text)),
  };
}
