import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePreview, evaluateProposal } from "../src/policy.js";

const mandate = {
  allowed_products: ["ETH-USDC"],
  allowed_sides: ["BUY"],
  allowed_order_types: ["market"],
  max_quote_size: "20.00",
  max_order_total: "21.00",
  max_commission_total: "1.00",
};

const allowed = {
  product_id: "ETH-USDC",
  side: "BUY",
  type: "market",
  quote_size: "20.00",
};

test("allows the exact closed-schema proposal", () => {
  assert.equal(evaluateProposal(mandate, allowed).verdict, "ALLOW");
});

test("blocks pair substitution, overspend, side changes, and unknown fields", () => {
  const cases = [
    { ...allowed, product_id: "ETH-USD" },
    { ...allowed, quote_size: "20.01" },
    { ...allowed, side: "SELL" },
    { ...allowed, leverage: "2.0" },
  ];
  for (const proposal of cases) {
    assert.equal(evaluateProposal(mandate, proposal).verdict, "BLOCK");
  }
});

test("rejects scientific notation, negatives, and non-string amounts", () => {
  for (const quote_size of ["2e1", "-1", 20]) {
    assert.equal(evaluateProposal(mandate, { ...allowed, quote_size }).verdict, "BLOCK");
  }
});

test("enforces preview all-in and commission caps", () => {
  const preview = {
    order_total: "20.50",
    commission_total: "0.50",
    quote_size: "20.00",
    est_average_filled_price: "3000.00",
    base_size: "0.006",
    best_bid: "2999.00",
    best_ask: "3001.00",
    slippage: "0.01",
  };
  assert.equal(evaluatePreview(mandate, allowed, preview).verdict, "ALLOW");
  assert.equal(evaluatePreview(mandate, allowed, { ...preview, order_total: "21.01" }).verdict, "BLOCK");
  assert.equal(evaluatePreview(mandate, allowed, { ...preview, commission_total: "1.01" }).verdict, "BLOCK");
  assert.equal(evaluatePreview(mandate, allowed, { ...preview, order_total: "0" }).verdict, "BLOCK");
  assert.equal(evaluatePreview(mandate, allowed, { ...preview, quote_size: "0" }).verdict, "BLOCK");
  assert.equal(evaluatePreview(mandate, allowed, { ...preview, order_total: "19.99" }).verdict, "BLOCK");
});
