import test from "node:test";
import assert from "node:assert/strict";
import { compileDeterministicIntent } from "../src/intent-compiler.js";
import {
  evaluateExecutionPreview,
  evaluateExecutionProposal,
} from "../src/execution-policy.js";
import { proposeSpotOrder } from "../src/proposer.js";

const READY_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";

const policy = compileDeterministicIntent(READY_INTENT).policy;
const market = {
  product_id: "ETH-USDC",
  product_type: "SPOT",
  base_asset: "ETH",
  quote_asset: "USDC",
  base_increment: "0.00000001",
  quote_increment: "0.01",
  price_increment: "0.01",
  best_bid: "2999.00",
  best_ask: "3000.00",
};

test("agent derives a price-bounded IOC action from policy and fresh best ask", () => {
  const proposal = proposeSpotOrder(policy, market, {
    now: new Date("2026-07-23T18:00:00Z"),
  });
  assert.deepEqual(proposal.action, {
    product_id: "ETH-USDC",
    side: "BUY",
    type: "limit",
    time_in_force: "IOC",
    quote_size: "5",
    limit_price: "3015.00",
  });
  assert.equal(
    evaluateExecutionProposal(policy, proposal.action, market).verdict,
    "ALLOW",
  );
});

test("preview evidence passes only when bound economics remain within policy", () => {
  const proposal = proposeSpotOrder(policy, market).action;
  const preview = {
    order_total: "5.25",
    commission_total: "0.25",
    quote_size: "5",
    base_size: "0.00166",
    est_average_filled_price: "3010.00",
    preview_id: "preview-1",
    errs: [],
    warning: [],
  };
  assert.equal(
    evaluateExecutionPreview(policy, proposal, market, preview).verdict,
    "ALLOW",
  );
});

test("unknown preview warnings and fee drift block before delta or create", () => {
  const proposal = proposeSpotOrder(policy, market).action;
  const result = evaluateExecutionPreview(policy, proposal, market, {
    order_total: "5.60",
    commission_total: "0.60",
    quote_size: "5",
    base_size: "0.00166",
    est_average_filled_price: "3010.00",
    preview_id: "preview-1",
    errs: [],
    warning: ["UNKNOWN"],
  });
  assert.equal(result.verdict, "BLOCK");
  const codes = result.failures.map((item) => item.code);
  assert.ok(codes.includes("PREVIEW_WARNINGS"));
  assert.ok(codes.includes("ALL_IN_CAP_EXCEEDED"));
  assert.ok(codes.includes("COMMISSION_CAP_EXCEEDED"));
});
