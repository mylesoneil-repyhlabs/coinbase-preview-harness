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

test("a READY model output cannot bypass duplicated source material", () => {
  const compilation = compileDeterministicIntent(READY_INTENT);
  assert.throws(
    () =>
      validateCompilation(
        compilation,
        `${READY_INTENT} This authorization expires 2 minutes after I confirm it.`,
      ),
    /source intent contains unsupported or repeated constraints/,
  );
});

test("a READY model output cannot discard an unrepresented source clause", () => {
  const compilation = compileDeterministicIntent(READY_INTENT);
  assert.throws(
    () =>
      validateCompilation(
        compilation,
        `${READY_INTENT} Use the account with the lowest tax liability.`,
      ),
    /source intent contains unsupported or repeated constraints/,
  );
});

const semanticallyDifferentSources = [
  [
    "policy.size.value",
    (intent) => intent.replace("exactly 5 USDC", "exactly 4 USDC"),
    "use exactly 4 USDC",
  ],
  [
    "policy.product_id",
    (intent) => intent.replace("ETH-USDC", "BTC-USDC"),
    "BTC-USDC",
  ],
  [
    "policy.side",
    (intent) => intent.replace("to buy ETH", "to sell ETH"),
    "sell",
  ],
  [
    "policy.order_type",
    (intent) =>
      intent.replace("price-bounded IOC limit order", "market order"),
    "market order",
  ],
  [
    "policy.partial_fill_policy",
    (intent) =>
      intent.replace(
        "Partial fill is acceptable",
        "Partial fill is not acceptable",
      ),
    "Partial fill is not acceptable",
  ],
  [
    "policy.limits.max_slippage_bps",
    (intent) => intent.replace("more than 50 bps", "more than 40 bps"),
    "Do not pay more than 40 bps above",
  ],
  [
    "policy.limits.max_commission.value",
    (intent) =>
      intent.replace("0.50 USDC in commission", "0.40 USDC in commission"),
    "more than 0.40 USDC in commission",
  ],
  [
    "policy.limits.settlement.value",
    (intent) => intent.replace("5.50 USDC total", "6.00 USDC total"),
    "more than 6.00 USDC total",
  ],
  [
    "policy.validity.ttl_seconds",
    (intent) => intent.replace("expires 2 minutes", "expires 1 minute"),
    "authorization expires 1 minute",
  ],
  [
    "policy.usage.max_executions",
    (intent) => intent.replace("once now", "twice now"),
    "twice",
  ],
];

for (const [field, changeSource, groundingQuote] of semanticallyDifferentSources) {
  test(`READY ${field} must equal its single source constraint`, () => {
    const compilation = structuredClone(
      compileDeterministicIntent(READY_INTENT),
    );
    compilation.grounding.find(
      (item) => item.field === field,
    ).source_quote = groundingQuote;
    assert.throws(
      () => validateCompilation(compilation, changeSource(READY_INTENT)),
      new RegExp(
        `${field.replaceAll(".", "\\.")} does not match the source`,
      ),
    );
  });
}

test("grounding must identify the source clause for its own material field", () => {
  const compilation = structuredClone(
    compileDeterministicIntent(READY_INTENT),
  );
  const sizeGrounding = compilation.grounding.find(
    (item) => item.field === "policy.size.value",
  );
  sizeGrounding.source_quote = "ETH-USDC";
  assert.throws(
    () => validateCompilation(compilation, READY_INTENT),
    /grounding quote for policy\.size\.value does not correspond to its source constraint/,
  );
});

test("a fake READY size cannot be grounded by the source's different size", () => {
  const compilation = structuredClone(
    compileDeterministicIntent(READY_INTENT),
  );
  compilation.policy.size.value = "4";
  assert.throws(
    () => validateCompilation(compilation, READY_INTENT),
    /policy\.size\.value does not match the source exact order size/,
  );
});

test("each material field permits exactly one grounding item", () => {
  const compilation = structuredClone(
    compileDeterministicIntent(READY_INTENT),
  );
  compilation.grounding.push(structuredClone(compilation.grounding[0]));
  assert.throws(
    () => validateCompilation(compilation, READY_INTENT),
    /material field has duplicate grounding/,
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
