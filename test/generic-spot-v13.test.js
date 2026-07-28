import test from "node:test";
import assert from "node:assert/strict";
import { compileDeterministicIntent } from "../src/intent-compiler.js";
import { evaluateCoinbaseFunding } from "../src/funding.js";
import { normalizeCoinbaseMarketData } from "../src/market.js";
import { runMandateAttemptLoop } from "../src/mandate/controller.js";
import {
  createExecutionPlan,
  loadSafetyProfile,
} from "../src/plan.js";
import { assertPolicyWithinSafetyProfile } from "../src/policy-validator.js";
import {
  assertCanonicalSpotAction,
  createCanonicalSpotAction,
} from "../src/spot-action.js";

function buyIntent({
  base,
  quote,
  amount,
  fee = "2",
  total = "252",
}) {
  return `Using my isolated Coinbase Advanced portfolio, use exactly ${amount} ${quote} to buy ${base} on ${base}-${quote} once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 40 bps above Coinbase's fresh best ask, more than ${fee} ${quote} in commission, or more than ${total} ${quote} total. This authorization expires 2 minutes after I confirm it.`;
}

function sellIntent({
  base,
  quote,
  amount,
  fee = "8",
  proceeds = "100",
}) {
  return `Using my isolated Coinbase Advanced portfolio, use exactly ${amount} ${base} to sell ${base} on ${base}-${quote} once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not accept more than 40 bps below Coinbase's fresh best bid, pay more than ${fee} ${quote} in commission, or receive at least ${proceeds} ${quote} after commission. This authorization expires 2 minutes after I confirm it.`;
}

const compilationCases = [
  [
    "BTC-USDC BUY",
    buyIntent({
      base: "BTC",
      quote: "USDC",
      amount: "250",
    }),
    "quote_size",
    "USDC",
  ],
  [
    "SOL-USD BUY",
    buyIntent({
      base: "SOL",
      quote: "USD",
      amount: "250",
    }),
    "quote_size",
    "USD",
  ],
  [
    "ETH-BTC BUY",
    buyIntent({
      base: "ETH",
      quote: "BTC",
      amount: "0.01000000",
      fee: "0.00010000",
      total: "0.01010000",
    }),
    "quote_size",
    "BTC",
  ],
  [
    "BTC-USDC SELL",
    sellIntent({
      base: "BTC",
      quote: "USDC",
      amount: "0.05000000",
      proceeds: "3000",
    }),
    "base_size",
    "BTC",
  ],
  [
    "SOL-USD SELL",
    sellIntent({
      base: "SOL",
      quote: "USD",
      amount: "2.50000000",
      proceeds: "300",
    }),
    "base_size",
    "SOL",
  ],
];

for (const [name, intent, sizeField, fundingAsset] of compilationCases) {
  test(`v1.3 compiles and plans ${name}`, async () => {
    const compilation = compileDeterministicIntent(intent);
    assert.equal(compilation.status, "READY_FOR_CONFIRMATION");
    assert.equal(
      compilation.schema_version,
      "delta.coinbase.compilation.v2",
    );
    const plan = await createExecutionPlan(intent);
    assert.equal(plan.status, "AWAITING_HUMAN_CONFIRMATION");
    assert.equal(plan.action_descriptor.size.field, sizeField);
    assert.equal(plan.action_descriptor.funding.asset, fundingAsset);
    assert.equal(plan.capability_profile.create_enabled, false);
  });
}

test("USD and USDC are never silently substituted", () => {
  const compilation = compileDeterministicIntent(
    buyIntent({
      base: "ETH",
      quote: "USD",
      amount: "250",
    }).replace("exactly 250 USD", "exactly 250 USDC"),
  );
  assert.equal(compilation.status, "NEEDS_CLARIFICATION");
  assert.ok(
    compilation.ambiguities.some(
      ({ code }) => code === "BUY_SIZE_ASSET_MISMATCH",
    ),
  );
});

const unsupported = [
  ["transfer", "Transfer 1 BTC to another portfolio."],
  ["withdraw", "Withdraw 1 BTC."],
  ["convert", "Convert 100 USD to USDC."],
  ["stake", "Stake 1 ETH."],
  ["derivative", "Buy a BTC perpetual with leverage."],
  ["recurring", "Buy BTC every day."],
  ["balance percentage", "Sell half my BTC."],
  ["conditional strategy", "Buy ETH if it reaches 2000 USD."],
];

for (const [name, intent] of unsupported) {
  test(`unsupported ${name} is not coerced into a spot order`, () => {
    const compilation = compileDeterministicIntent(intent);
    assert.notEqual(compilation.status, "READY_FOR_CONFIRMATION");
    assert.equal(compilation.policy, null);
  });
}

function accounts({
  currency,
  value,
  active = true,
  ready = true,
  hasNext = false,
}) {
  return {
    accounts: [
      {
        uuid: "account-1",
        currency,
        available_balance: { currency, value },
        active,
        ready,
        deleted_at: null,
        platform: "ACCOUNT_PLATFORM_CONSUMER",
        retail_portfolio_id: "portfolio-1",
      },
    ],
    has_next: hasNext,
    cursor: hasNext ? "next" : null,
  };
}

test("BUY funding binds the held quote asset and debit ceiling", () => {
  const policy = compileDeterministicIntent(
    buyIntent({
      base: "SOL",
      quote: "USDC",
      amount: "250",
    }),
  ).policy;
  const result = evaluateCoinbaseFunding(
    policy,
    accounts({ currency: "USDC", value: "252" }),
    { portfolioFingerprint: "portfolio" },
  );
  assert.equal(result.decision, "PASS");
  assert.equal(result.funding_asset, "USDC");
  assert.equal(result.required_available, "252");
});

test("SELL funding binds the held base asset and preserves eight decimals", () => {
  const policy = compileDeterministicIntent(
    sellIntent({
      base: "BTC",
      quote: "USD",
      amount: "0.05000000",
      proceeds: "3000",
    }),
  ).policy;
  const result = evaluateCoinbaseFunding(
    policy,
    accounts({ currency: "BTC", value: "0.05000000" }),
  );
  assert.equal(result.decision, "PASS");
  assert.equal(result.required_available, "0.05000000");
});

for (const [name, accountResponse, code] of [
  [
    "insufficient balance",
    accounts({ currency: "USDC", value: "10" }),
    "INSUFFICIENT_AVAILABLE_BALANCE",
  ],
  [
    "wrong source currency",
    accounts({ currency: "USD", value: "1000" }),
    "FUNDING_ASSET_NOT_HELD",
  ],
  [
    "inactive account",
    accounts({ currency: "USDC", value: "1000", active: false }),
    "FUNDING_ASSET_NOT_HELD",
  ],
  [
    "incomplete pagination",
    accounts({ currency: "USDC", value: "1000", hasNext: true }),
    "ACCOUNTS_EVIDENCE_INCOMPLETE",
  ],
]) {
  test(`${name} BLOCKS funding evidence`, () => {
    const policy = compileDeterministicIntent(
      buyIntent({
        base: "SOL",
        quote: "USDC",
        amount: "250",
      }),
    ).policy;
    const result = evaluateCoinbaseFunding(policy, accountResponse);
    assert.equal(result.decision, "BLOCK");
    assert.ok(result.failures.some((failure) => failure.code === code));
  });
}

function product(overrides = {}) {
  return {
    product_id: "SOL-USDC",
    product_type: "SPOT",
    status: "online",
    base_currency_id: "SOL",
    quote_currency_id: "USDC",
    base_increment: "0.00000001",
    quote_increment: "0.01",
    price_increment: "0.01",
    base_min_size: "0.001",
    base_max_size: "1000000",
    quote_min_size: "1",
    quote_max_size: "1000000",
    is_disabled: false,
    trading_disabled: false,
    view_only: false,
    cancel_only: false,
    limit_only: false,
    post_only: false,
    auction_mode: false,
    ...overrides,
  };
}

function book(overrides = {}) {
  return {
    pricebooks: [
      {
        product_id: "SOL-USDC",
        bids: [{ price: "149.90", size: "10" }],
        asks: [{ price: "150.00", size: "10" }],
        time: "2026-07-23T18:00:00.000Z",
        ...overrides,
      },
    ],
  };
}

test("runtime product metadata is authoritative for a supported pair", () => {
  const market = normalizeCoinbaseMarketData(
    product(),
    book(),
    "SOL-USDC",
  );
  assert.equal(market.product_id, "SOL-USDC");
  assert.equal(market.product_flags.view_only, false);
  assert.equal(market.base_min_size, "0.001");
});

test("limit_only is required and true is compatible with SOR limit IOC", () => {
  const market = normalizeCoinbaseMarketData(
    product({ limit_only: true }),
    book(),
    "SOL-USDC",
  );
  assert.equal(market.product_flags.limit_only, true);
});

for (const flag of [
  "is_disabled",
  "trading_disabled",
  "view_only",
  "cancel_only",
  "post_only",
  "auction_mode",
]) {
  test(`runtime product flag ${flag} blocks the pair`, () => {
    assert.throws(
      () =>
        normalizeCoinbaseMarketData(
          product({ [flag]: true }),
          book(),
          "SOL-USDC",
        ),
      /not executable/,
    );
  });
}

test("limit_only does not override incompatible Coinbase product flags", () => {
  for (const flag of [
    "is_disabled",
    "trading_disabled",
    "view_only",
    "cancel_only",
    "post_only",
    "auction_mode",
  ]) {
    assert.throws(
      () =>
        normalizeCoinbaseMarketData(
          product({ limit_only: true, [flag]: true }),
          book(),
          "SOL-USDC",
        ),
      new RegExp(`not executable: ${flag}`),
    );
  }
});

test("runtime product metadata fails closed when a tradability flag is omitted", () => {
  const missingLimitOnly = product();
  delete missingLimitOnly.limit_only;
  assert.throws(
    () =>
      normalizeCoinbaseMarketData(
        missingLimitOnly,
        book(),
        "SOL-USDC",
      ),
    /missing required boolean: limit_only/,
  );
});

test("non-SPOT and mismatched products are rejected", () => {
  assert.throws(
    () =>
      normalizeCoinbaseMarketData(
        product({ product_type: "FUTURE" }),
        book(),
        "SOL-USDC",
      ),
    /not SPOT/,
  );
  assert.throws(
    () =>
      normalizeCoinbaseMarketData(
        product({ product_id: "BTC-USDC" }),
        book(),
        "SOL-USDC",
      ),
    /does not match/,
  );
});

test("missing size limits and crossed books fail closed", () => {
  assert.throws(
    () =>
      normalizeCoinbaseMarketData(
        product({ base_min_size: undefined }),
        book(),
        "SOL-USDC",
      ),
    /base_min_size/,
  );
  assert.throws(
    () =>
      normalizeCoinbaseMarketData(
        product(),
        book({
          bids: [{ price: "151", size: "10" }],
          asks: [{ price: "150", size: "10" }],
        }),
        "SOL-USDC",
      ),
    /best bid must be below best ask/,
  );
});

test("canonical action descriptor detects tampering", () => {
  const policy = compileDeterministicIntent(
    sellIntent({
      base: "BTC",
      quote: "USD",
      amount: "0.05000000",
      proceeds: "3000",
    }),
  ).policy;
  const descriptor = createCanonicalSpotAction(policy);
  assert.equal(assertCanonicalSpotAction(descriptor, policy), descriptor);
  const tampered = structuredClone(descriptor);
  tampered.funding.asset = "USD";
  assert.throws(
    () => assertCanonicalSpotAction(tampered, policy),
    /digest mismatch/,
  );
});

test("REVIEW never retries and never invokes execution", async () => {
  let executeCalls = 0;
  const result = await runMandateAttemptLoop({
    maxAttempts: 3,
    propose: async () => ({ id: "candidate" }),
    evaluate: async () => ({
      decision: "REVIEW",
      status: "processing",
      verified: false,
      constraint_failures: [],
    }),
    execute: async () => {
      executeCalls += 1;
    },
  });
  assert.equal(result.status, "STOPPED");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].disposition, "STOP");
  assert.equal(executeCalls, 0);
});

test("generic Preview planning does not widen the future live profile", async () => {
  const intent = buyIntent({
    base: "SOL",
    quote: "USD",
    amount: "250",
  });
  const plan = await createExecutionPlan(intent);
  assert.equal(plan.status, "AWAITING_HUMAN_CONFIRMATION");
  const liveProfile = await loadSafetyProfile();
  assert.throws(
    () => assertPolicyWithinSafetyProfile(plan.policy, liveProfile),
    /outside the local safety profile|principal exceeds/,
  );
});
