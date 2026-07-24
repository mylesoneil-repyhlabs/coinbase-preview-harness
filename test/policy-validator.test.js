import test from "node:test";
import assert from "node:assert/strict";
import { compileDeterministicIntent } from "../src/intent-compiler.js";
import {
  assertPolicyWithinSafetyProfile,
  validateCompilation,
  validatePolicy,
} from "../src/policy-validator.js";

const READY_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";

const safetyProfile = {
  allowed_products: ["ETH-USDC"],
  allowed_sides: ["BUY"],
  allowed_order_types: ["SOR_LIMIT_IOC"],
  max_principal: "5.00",
  max_all_in_debit: "5.50",
  max_commission: "0.50",
  max_slippage_bps: 50,
  max_ttl_seconds: 120,
  max_executions: 1,
};

test("validated policy remains inside the independent safety profile", () => {
  const compilation = compileDeterministicIntent(READY_INTENT);
  assert.equal(validatePolicy(compilation.policy), compilation.policy);
  assert.equal(
    assertPolicyWithinSafetyProfile(compilation.policy, safetyProfile),
    true,
  );
});

test("unknown policy fields fail closed", () => {
  const compilation = compileDeterministicIntent(READY_INTENT);
  assert.throws(
    () => validatePolicy({ ...compilation.policy, leverage: "10" }),
    /unknown fields: leverage/,
  );
});

test("a model output cannot cite grounding text absent from the prompt", () => {
  const compilation = structuredClone(compileDeterministicIntent(READY_INTENT));
  compilation.grounding[0].source_quote = "ETH-BTC";
  assert.throws(
    () => validateCompilation(compilation, READY_INTENT),
    /not present in the source intent/,
  );
});

test("the safety profile narrows a broader human policy", () => {
  const compilation = structuredClone(compileDeterministicIntent(READY_INTENT));
  compilation.policy.size.value = "5.01";
  assert.throws(
    () => assertPolicyWithinSafetyProfile(compilation.policy, safetyProfile),
    /principal exceeds/,
  );
});
