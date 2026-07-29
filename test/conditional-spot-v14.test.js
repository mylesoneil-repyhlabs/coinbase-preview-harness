import test from "node:test";
import assert from "node:assert/strict";
import { compileDeterministicIntent } from "../src/intent-compiler.js";
import {
  evaluateExecutionPreview,
  evaluateExecutionProposal,
} from "../src/execution-policy.js";
import { createExecutionPlan } from "../src/plan.js";
import { proposeSpotOrder } from "../src/proposer.js";
import { runBuiltInSimulation } from "../src/execution-pipeline.js";
import { createCanonicalSpotAction } from "../src/spot-action.js";

const CONDITIONAL_BUY =
  "Using my isolated Coinbase Advanced portfolio, use up to 3000 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Only if Coinbase's fresh best ask is at or below 3000 USDC. Partial fill is acceptable. Do not pay more than 35 bps above Coinbase's fresh best ask, more than 15 USDC in commission, or more than 3015 USDC total. This authorization expires 10 minutes after I confirm it.";

const CONDITIONAL_SELL =
  "Using my isolated Coinbase Advanced portfolio, use up to 0.50000000 BTC to sell BTC on BTC-USD once now with a price-bounded IOC limit order. Only when Coinbase's fresh best bid is at or above 60000 USD. Partial fill is acceptable. Do not accept more than 40 bps below Coinbase's fresh best bid, pay more than 25 USD in commission, or receive at least 29000 USD after commission. This authorization expires 10 minutes after I confirm it.";

const NATURAL_FORMATTING_VARIANT =
  "Using my isolated Coinbase Advanced portfolio, use up to $3,000 USDC to buy ETH on ETH/USDC once now with a price bounded IOC limit order. Only when Coinbase fresh best ask is at or below $3,000 USDC. Partial fills allowed. Do not pay more than 35 bps above Coinbase fresh best ask, more than $15 USDC in fees, or more than $3,015 USDC total. This authorization expires in 10 minutes after I confirm it.";

const BUY_MARKET = Object.freeze({
  product_id: "ETH-USDC",
  product_type: "SPOT",
  base_asset: "ETH",
  quote_asset: "USDC",
  base_increment: "0.00000001",
  quote_increment: "0.01",
  price_increment: "0.01",
  base_min_size: "0.00000001",
  base_max_size: "1000000",
  quote_min_size: "1",
  quote_max_size: "10000000",
  best_bid: "2998.00",
  best_ask: "2999.00",
});

test("v1.4 compiles a one-shot conditional BUY with a maximum size", async () => {
  const compilation = compileDeterministicIntent(CONDITIONAL_BUY);
  assert.equal(compilation.status, "READY_FOR_CONFIRMATION");
  assert.equal(compilation.schema_version, "delta.coinbase.compilation.v3");
  assert.deepEqual(compilation.policy.size, {
    denomination: "QUOTE",
    asset: "USDC",
    operator: "MAX",
    value: "3000",
  });
  assert.deepEqual(compilation.policy.market_condition, {
    reference: "BEST_ASK",
    operator: "AT_OR_BELOW",
    asset: "USDC",
    value: "3000",
  });
  assert.ok(
    compilation.grounding.some(
      ({ field }) => field === "policy.market_condition.value",
    ),
  );

  const plan = await createExecutionPlan(CONDITIONAL_BUY);
  assert.equal(plan.schema_version, "delta.coinbase.execution_plan.v3");
  assert.equal(plan.status, "AWAITING_HUMAN_CONFIRMATION");
  assert.equal(plan.action_descriptor.size.operator, "MAX");
  assert.deepEqual(
    plan.action_descriptor.constraints.market_condition,
    compilation.policy.market_condition,
  );
});

test("common natural formatting normalizes without weakening the mandate", () => {
  const canonical = compileDeterministicIntent(CONDITIONAL_BUY);
  const formatted = compileDeterministicIntent(NATURAL_FORMATTING_VARIANT);
  assert.equal(formatted.status, "READY_FOR_CONFIRMATION");
  assert.deepEqual(formatted.policy, canonical.policy);
});

test("v1.4 compiles and simulates a side-correct conditional SELL", async () => {
  const compilation = compileDeterministicIntent(CONDITIONAL_SELL);
  assert.equal(compilation.status, "READY_FOR_CONFIRMATION");
  assert.equal(compilation.policy.side, "SELL");
  assert.equal(compilation.policy.size.operator, "MAX");
  assert.deepEqual(compilation.policy.market_condition, {
    reference: "BEST_BID",
    operator: "AT_OR_ABOVE",
    asset: "USD",
    value: "60000",
  });

  const plan = await createExecutionPlan(CONDITIONAL_SELL);
  const record = await runBuiltInSimulation(plan, plan.policy_digest);
  assert.equal(record.status, "EXECUTION_ELIGIBLE");
  assert.equal(record.delta.decision, "PASS");
  assert.equal(record.execution.one_time_gate_consumed, true);
  assert.equal(record.execution.order_submitted, false);
  assert.equal(record.simulation.exchange_outcome_observed, false);
});

test("maximum sizing allows a smaller proposal but blocks over-allocation", () => {
  const policy = compileDeterministicIntent(CONDITIONAL_BUY).policy;
  const generated = proposeSpotOrder(policy, BUY_MARKET).action;
  assert.equal(generated.quote_size, "3000");
  assert.equal(
    evaluateExecutionProposal(
      policy,
      { ...generated, quote_size: "2500" },
      BUY_MARKET,
    ).decision,
    "PASS",
  );
  const over = evaluateExecutionProposal(
    policy,
    { ...generated, quote_size: "3000.01" },
    BUY_MARKET,
  );
  assert.equal(over.decision, "BLOCK");
  assert.ok(over.failures.some(({ code }) => code === "SIZE_MISMATCH"));
});

test("fresh market evidence must satisfy the authorized threshold", () => {
  const policy = compileDeterministicIntent(CONDITIONAL_BUY).policy;
  const proposal = proposeSpotOrder(policy, BUY_MARKET).action;
  const marketAboveThreshold = {
    ...BUY_MARKET,
    best_bid: "3000.00",
    best_ask: "3000.01",
  };
  const result = evaluateExecutionProposal(
    policy,
    proposal,
    marketAboveThreshold,
  );
  assert.equal(result.decision, "BLOCK");
  assert.ok(
    result.failures.some(
      ({ code }) => code === "MARKET_PRICE_CONDITION_NOT_MET",
    ),
  );
});

test("Preview rechecks the threshold and coherent economic fields", () => {
  const policy = compileDeterministicIntent(CONDITIONAL_BUY).policy;
  const proposal = proposeSpotOrder(policy, BUY_MARKET).action;
  const preview = {
    order_total: "3010",
    commission_total: "10",
    quote_size: "3000",
    base_size: "1.00033344",
    est_average_filled_price: "2999",
    best_bid: "2998.00",
    best_ask: "2999.00",
    preview_id: "preview-conditional-buy",
    errs: [],
    warning: [],
  };
  assert.equal(
    evaluateExecutionPreview(policy, proposal, BUY_MARKET, preview).decision,
    "PASS",
  );

  const conditionDrift = evaluateExecutionPreview(
    policy,
    proposal,
    BUY_MARKET,
    {
      ...preview,
      best_bid: "3000.00",
      best_ask: "3000.50",
    },
  );
  assert.equal(conditionDrift.decision, "BLOCK");
  assert.ok(
    conditionDrift.failures.some(
      ({ code }) => code === "PREVIEW_MARKET_CONDITION_NOT_MET",
    ),
  );

  const contradictory = evaluateExecutionPreview(
    policy,
    proposal,
    BUY_MARKET,
    {
      ...preview,
      order_total: "9999",
      base_size: "999999",
    },
  );
  assert.equal(contradictory.decision, "BLOCK");
  assert.ok(
    contradictory.failures.some(
      ({ code }) => code === "PREVIEW_SIZE_PRICE_INCONSISTENT",
    ),
  );
  assert.ok(
    contradictory.failures.some(
      ({ code }) => code === "PREVIEW_ORDER_TOTAL_INCONSISTENT",
    ),
  );
});

for (const [name, change, expectedCode] of [
  [
    "wrong reference",
    (intent) => intent.replace("fresh best ask is", "fresh best bid is"),
    "MARKET_CONDITION_SIDE_MISMATCH",
  ],
  [
    "wrong operator",
    (intent) => intent.replace("at or below 3000", "at or above 3000"),
    "MARKET_CONDITION_SIDE_MISMATCH",
  ],
  [
    "wrong quote asset",
    (intent) => intent.replace("below 3000 USDC", "below 3000 BTC"),
    "MARKET_CONDITION_ASSET_MISMATCH",
  ],
]) {
  test(`conditional compilation fails closed on the ${name}`, () => {
    const result = compileDeterministicIntent(change(CONDITIONAL_BUY));
    assert.equal(result.status, "NEEDS_CLARIFICATION");
    assert.equal(result.policy, null);
    assert.ok(result.ambiguities.some(({ code }) => code === expectedCode));
  });
}

test("duplicate and conflicting market conditions never become authorization", () => {
  const duplicateClause =
    "Only if Coinbase's fresh best ask is at or below 3000 USDC.";
  const duplicate = compileDeterministicIntent(
    `${CONDITIONAL_BUY} ${duplicateClause}`,
  );
  assert.equal(duplicate.status, "UNSUPPORTED");
  assert.ok(
    duplicate.unsupported_constraints.some(
      ({ code }) => code === "DUPLICATE_MATERIAL_CONSTRAINT",
    ),
  );

  const conflicting = compileDeterministicIntent(
    `${CONDITIONAL_BUY} Only if Coinbase's fresh best ask is at or below 2900 USDC.`,
  );
  assert.equal(conflicting.status, "UNSUPPORTED");
  assert.ok(
    conflicting.unsupported_constraints.some(
      ({ code }) => code === "CONFLICTING_MATERIAL_CONSTRAINT",
    ),
  );
});

test("an unmatched money constraint cannot be silently discarded", () => {
  const result = compileDeterministicIntent(
    `${CONDITIONAL_BUY} At most $1.`,
  );
  assert.equal(result.status, "UNSUPPORTED");
  assert.equal(result.policy, null);
  assert.ok(
    result.unsupported_constraints.some(
      ({ code }) => code === "UNRECOGNIZED_CONSTRAINT",
    ),
  );
});

test("market-condition tampering changes the canonical action binding", () => {
  const policy = compileDeterministicIntent(CONDITIONAL_BUY).policy;
  const original = createCanonicalSpotAction(policy);
  const changed = createCanonicalSpotAction({
    ...policy,
    market_condition: {
      ...policy.market_condition,
      value: "2999",
    },
  });
  assert.notEqual(original.descriptor_digest, changed.descriptor_digest);
});
