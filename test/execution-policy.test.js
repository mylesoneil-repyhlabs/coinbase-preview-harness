import test from "node:test";
import assert from "node:assert/strict";
import { compileDeterministicIntent } from "../src/intent-compiler.js";
import {
  evaluateExecutionPreview,
  evaluateExecutionProposal,
  selectExecutionPreviewEvidence,
} from "../src/execution-policy.js";
import { proposeSpotOrder } from "../src/proposer.js";

const BUY_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 250 USDC to buy SOL on SOL-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 40 bps above Coinbase's fresh best ask, more than 2 USDC in commission, or more than 252 USDC total. This authorization expires 2 minutes after I confirm it.";
const SELL_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 0.05000000 BTC to sell BTC on BTC-USD once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not accept more than 40 bps below Coinbase's fresh best bid, pay more than 8 USD in commission, or receive at least 3190 USD after commission. This authorization expires 2 minutes after I confirm it.";

const buyPolicy = compileDeterministicIntent(BUY_INTENT).policy;
const sellPolicy = compileDeterministicIntent(SELL_INTENT).policy;
const buyMarket = {
  product_id: "SOL-USDC",
  product_type: "SPOT",
  base_asset: "SOL",
  quote_asset: "USDC",
  base_increment: "0.00000001",
  quote_increment: "0.01",
  price_increment: "0.01",
  base_min_size: "0.001",
  base_max_size: "1000000",
  quote_min_size: "1",
  quote_max_size: "1000000",
  best_bid: "149.90",
  best_ask: "150.00",
};
const sellMarket = {
  product_id: "BTC-USD",
  product_type: "SPOT",
  base_asset: "BTC",
  quote_asset: "USD",
  base_increment: "0.00000001",
  quote_increment: "0.01",
  price_increment: "0.01",
  base_min_size: "0.00000001",
  base_max_size: "100",
  quote_min_size: "1",
  quote_max_size: "10000000",
  best_bid: "64000.00",
  best_ask: "64001.00",
};

test("BUY derives quote_size and a best-ask price ceiling", () => {
  const proposal = proposeSpotOrder(buyPolicy, buyMarket, {
    now: new Date("2026-07-23T18:00:00Z"),
  });
  assert.deepEqual(proposal.action, {
    product_id: "SOL-USDC",
    side: "BUY",
    type: "limit",
    time_in_force: "IOC",
    quote_size: "250",
    limit_price: "150.60",
  });
  const evaluation = evaluateExecutionProposal(
    buyPolicy,
    proposal.action,
    buyMarket,
  );
  assert.equal(evaluation.decision, "PASS");
  assert.equal(evaluation.price_reference_value, "150.00");
  assert.equal(evaluation.authorized_limit_price, "150.60");
  assert.equal(proposal.action_descriptor.funding.asset, "USDC");
});

test("SELL derives base_size and a best-bid price floor", () => {
  const proposal = proposeSpotOrder(sellPolicy, sellMarket).action;
  assert.deepEqual(proposal, {
    product_id: "BTC-USD",
    side: "SELL",
    type: "limit",
    time_in_force: "IOC",
    base_size: "0.05000000",
    limit_price: "63744.00",
  });
  const evaluation = evaluateExecutionProposal(
    sellPolicy,
    proposal,
    sellMarket,
  );
  assert.equal(evaluation.decision, "PASS");
  assert.equal(evaluation.price_reference_value, "64000.00");
  assert.equal(evaluation.authorized_limit_price, "63744.00");
  assert.equal(
    evaluateExecutionProposal(
      sellPolicy,
      { ...proposal, quote_size: "3200" },
      sellMarket,
    ).decision,
    "BLOCK",
  );
});

test("exact BUY limit is blocked before Preview above the authorized ask-derived ceiling", () => {
  const proposal = proposeSpotOrder(buyPolicy, buyMarket).action;
  const result = evaluateExecutionProposal(
    buyPolicy,
    { ...proposal, limit_price: "999999.00" },
    buyMarket,
  );
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.authorized_limit_price, "150.60");
  assert.ok(
    result.failures.some(
      ({ code }) => code === "LIMIT_PRICE_OUTSIDE_AUTHORIZED_BOUND",
    ),
  );
});

test("exact SELL limit is blocked before Preview below the authorized bid-derived floor", () => {
  const proposal = proposeSpotOrder(sellPolicy, sellMarket).action;
  const result = evaluateExecutionProposal(
    sellPolicy,
    { ...proposal, limit_price: "1.00" },
    sellMarket,
  );
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.authorized_limit_price, "63744.00");
  assert.ok(
    result.failures.some(
      ({ code }) => code === "LIMIT_PRICE_OUTSIDE_AUTHORIZED_BOUND",
    ),
  );
});

test("BUY Preview passes only within debit, fee, and price bounds", () => {
  const proposal = proposeSpotOrder(buyPolicy, buyMarket).action;
  const preview = {
    order_total: "251",
    commission_total: "1",
    quote_size: "250",
    base_size: "1.66",
    est_average_filled_price: "150.40",
    preview_id: "preview-buy",
    errs: [],
    warning: [],
  };
  const result = evaluateExecutionPreview(
    buyPolicy,
    proposal,
    buyMarket,
    preview,
  );
  assert.equal(result.decision, "PASS");
  assert.deepEqual(result.settlement, {
    kind: "MAX_QUOTE_DEBIT",
    value: "251",
  });
});

test("SELL Preview passes only above the net-proceeds and price floors", () => {
  const proposal = proposeSpotOrder(sellPolicy, sellMarket).action;
  const preview = {
    order_total: "3200",
    commission_total: "5",
    quote_size: "3200",
    base_size: "0.05000000",
    est_average_filled_price: "63900",
    preview_id: "preview-sell",
    errs: [],
    warning: [],
  };
  const result = evaluateExecutionPreview(
    sellPolicy,
    proposal,
    sellMarket,
    preview,
  );
  assert.equal(result.decision, "PASS");
  assert.deepEqual(result.settlement, {
    kind: "MIN_NET_QUOTE_PROCEEDS",
    value: "3195",
  });
  const belowFloor = evaluateExecutionPreview(
    sellPolicy,
    proposal,
    sellMarket,
    {
      ...preview,
      order_total: "3180",
      quote_size: "3180",
      est_average_filled_price: "63600",
    },
  );
  assert.equal(belowFloor.decision, "BLOCK");
  assert.ok(
    belowFloor.failures.some(
      ({ code }) => code === "MIN_NET_PROCEEDS_NOT_MET",
    ),
  );
  assert.ok(
    belowFloor.failures.some(
      ({ code }) => code === "LIMIT_PRICE_VIOLATION",
    ),
  );
});

test("Preview warnings produce REVIEW while errors and fee drift BLOCK", () => {
  const proposal = proposeSpotOrder(buyPolicy, buyMarket).action;
  const base = {
    order_total: "250",
    commission_total: "0",
    quote_size: "250",
    base_size: "1.66",
    est_average_filled_price: "150",
    preview_id: "preview-buy",
    errs: [],
    warning: [],
  };
  const review = evaluateExecutionPreview(
    buyPolicy,
    proposal,
    buyMarket,
    { ...base, warning: ["UNKNOWN"] },
  );
  assert.equal(review.decision, "REVIEW");
  assert.equal(review.failures.length, 0);
  const block = evaluateExecutionPreview(
    buyPolicy,
    proposal,
    buyMarket,
    {
      ...base,
      commission_total: "3",
      order_total: "253",
      errs: ["INSUFFICIENT_FUND"],
    },
  );
  assert.equal(block.decision, "BLOCK");
  assert.ok(
    block.failures.some(
      ({ code }) => code === "COMMISSION_CAP_EXCEEDED",
    ),
  );
});

test("canonical Preview evidence ignores optional self-reported slippage", () => {
  const selected = selectExecutionPreviewEvidence({
    order_total: "250",
    commission_total: "0",
    quote_size: "250",
    base_size: "1.66",
    est_average_filled_price: "150",
    best_bid: "149.90",
    best_ask: "150",
    slippage: "999999",
    preview_id: "preview-buy",
    errs: [],
    warning: [],
  });
  assert.equal(Object.hasOwn(selected, "slippage"), false);
});
