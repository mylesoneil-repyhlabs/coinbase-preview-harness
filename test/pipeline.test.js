import test from "node:test";
import assert from "node:assert/strict";
import { runPreviewPipeline } from "../src/pipeline.js";

const mandate = {
  id: "test",
  allowed_products: ["ETH-USDC"],
  allowed_sides: ["BUY"],
  allowed_order_types: ["market"],
  max_quote_size: "20.00",
  max_order_total: "21.00",
  max_commission_total: "1.00",
};

const order = {
  product_id: "ETH-USDC",
  side: "BUY",
  type: "market",
  quote_size: "20.00",
};

test("blocked proposals never invoke the Coinbase adapter", async () => {
  let calls = 0;
  const record = await runPreviewPipeline({
    artifactClass: "FIXTURE",
    mandate,
    order: { ...order, product_id: "ETH-USD" },
    previewAdapter: async () => {
      calls += 1;
      throw new Error("must not run");
    },
    adapterMode: "live",
  });
  assert.equal(calls, 0);
  assert.equal(record.final_verdict, "BLOCK");
  assert.equal(record.coinbase.adapter_invoked, false);
});

test("an allowed proposal invokes preview exactly once", async () => {
  let calls = 0;
  const record = await runPreviewPipeline({
    artifactClass: "LIVE",
    mandate,
    order,
    previewAdapter: async () => {
      calls += 1;
      return {
        response: {
          order_total: "20.50",
          commission_total: "0.50",
          quote_size: "20.00",
          est_average_filled_price: "3000.00",
          base_size: "0.006",
          best_bid: "2999.00",
          best_ask: "3001.00",
          slippage: "0.01",
        },
      };
    },
    adapterMode: "live",
  });
  assert.equal(calls, 1);
  assert.equal(record.final_verdict, "ALLOW");
  assert.equal(record.execution.order_created, false);
  assert.match(record.record_digest, /^[a-f0-9]{64}$/);
});

test("preview adapter failures produce a sanitized fail-closed record", async () => {
  const record = await runPreviewPipeline({
    artifactClass: "LIVE",
    mandate,
    order,
    previewAdapter: async () => {
      throw new Error("HTTP 401 unauthorized");
    },
    adapterMode: "live",
  });
  assert.equal(record.final_verdict, "AUTHENTICATION_ERROR");
  assert.equal(record.postcheck.verdict, "BLOCK");
  assert.equal(record.execution.order_created, false);
});
