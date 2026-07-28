import test from "node:test";
import assert from "node:assert/strict";
import { createBoundExecution } from "../src/execution-binding.js";
import { createExecutionConfirmation } from "../src/execution-confirmation.js";
import {
  runBuiltInSimulation,
  runExecutionPipeline,
} from "../src/execution-pipeline.js";
import {
  createExecutionPlan,
  loadPreviewCapabilityProfile,
} from "../src/plan.js";

const BUY_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 250 USDC to buy SOL on SOL-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 40 bps above Coinbase's fresh best ask, more than 2 USDC in commission, or more than 252 USDC total. This authorization expires 2 minutes after I confirm it.";
const SELL_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 0.05000000 BTC to sell BTC on BTC-USD once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not accept more than 40 bps below Coinbase's fresh best bid, pay more than 8 USD in commission, or receive at least 3190 USD after commission. This authorization expires 2 minutes after I confirm it.";
const FIXED = new Date("2026-07-23T18:00:00.000Z");

async function probeFixture() {
  const plan = await createExecutionPlan(BUY_INTENT);
  const capabilityProfile = await loadPreviewCapabilityProfile();
  const attestation = {
    can_view: true,
    can_trade: false,
    can_transfer: false,
    can_receive: false,
    jwt_profile: "CDP_URIS_V1",
    portfolio_fingerprint: "portfolio-fingerprint",
    key_fingerprint: "credential-fingerprint",
  };
  const boundExecution = createBoundExecution(
    plan,
    attestation,
    plan.policy_digest,
  );
  const executionConfirmation = createExecutionConfirmation({
    boundExecution,
    attestation,
    confirmedExecutionDigest: boundExecution.execution_digest,
    confirmedAt: FIXED,
  });
  const state = {
    productCalls: 0,
    marketCalls: 0,
    accountCalls: 0,
    previewCalls: 0,
    deltaCalls: 0,
    createCalls: 0,
  };
  const args = {
    mode: "PROBE",
    plan,
    confirmPolicyDigest: plan.policy_digest,
    boundExecution,
    executionConfirmation,
    capabilityProfile,
    attestation,
    now: () => new Date(FIXED),
    listAccounts: async () => {
      state.accountCalls += 1;
      return {
        accounts: [
          {
            uuid: "account-usdc",
            currency: "USDC",
            available_balance: { currency: "USDC", value: "500" },
            active: true,
            ready: true,
            deleted_at: null,
            platform: "ACCOUNT_PLATFORM_CONSUMER",
            retail_portfolio_id: "portfolio-1",
          },
        ],
        has_next: false,
        cursor: null,
      };
    },
    getProduct: async (productId) => {
      state.productCalls += 1;
      return {
        product_id: productId,
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
      };
    },
    getBestBidAsk: async (productId) => {
      state.marketCalls += 1;
      return {
        pricebooks: [
          {
            product_id: productId,
            bids: [{ price: "149.90", size: "10" }],
            asks: [{ price: "150.00", size: "10" }],
            time: FIXED.toISOString(),
          },
        ],
      };
    },
    previewAdapter: async (request) => {
      state.previewCalls += 1;
      return {
        response: {
          order_total: "251",
          commission_total: "1",
          quote_size:
            request.order_configuration.sor_limit_ioc.quote_size,
          base_size: "1.66",
          est_average_filled_price: "150.40",
          best_bid: "149.90",
          best_ask: "150.00",
          preview_id: "preview-1",
          errs: [],
          warning: [],
        },
      };
    },
    mandateAdapter: {
      submitPolicy: async () => {
        state.deltaCalls += 1;
        throw new Error("Delta must not run during Preview");
      },
    },
    createAdapter: async () => {
      state.createCalls += 1;
      throw new Error("Create must not run during Preview");
    },
  };
  return { args, state };
}

test("public LIVE rejects a forged capability before every adapter", async () => {
  const { args, state } = await probeFixture();
  await assert.rejects(
    () =>
      runExecutionPipeline({
        ...args,
        mode: "LIVE",
        executionCapability: Symbol("forged"),
      }),
    /ENGINEERING_INTEGRATION_REQUIRED/,
  );
  assert.deepEqual(state, {
    productCalls: 0,
    marketCalls: 0,
    accountCalls: 0,
    previewCalls: 0,
    deltaCalls: 0,
    createCalls: 0,
  });
});

test("credentialed Preview uses accounts, product, book, and Preview only", async () => {
  const { args, state } = await probeFixture();
  const record = await runExecutionPipeline(args);
  assert.equal(record.status, "PREVIEW_PROBE_PASS");
  assert.equal(record.funding.decision, "PASS");
  assert.equal(record.preview_check.decision, "PASS");
  assert.equal(record.delta, null);
  assert.equal(record.execution.adapter_invoked, false);
  assert.deepEqual(state, {
    productCalls: 1,
    marketCalls: 1,
    accountCalls: 1,
    previewCalls: 1,
    deltaCalls: 0,
    createCalls: 0,
  });
});

test("Preview warnings return REVIEW and keep Delta/Create locked", async () => {
  const { args, state } = await probeFixture();
  const original = args.previewAdapter;
  args.previewAdapter = async (request) => {
    const result = await original(request);
    result.response.warning = ["PRICE_WARNING"];
    return result;
  };
  const record = await runExecutionPipeline(args);
  assert.equal(record.status, "REVIEW");
  assert.equal(record.preview_check.decision, "REVIEW");
  assert.equal(state.deltaCalls, 0);
  assert.equal(state.createCalls, 0);
});

test("insufficient held quote funds BLOCK before proposal or Preview", async () => {
  const { args, state } = await probeFixture();
  args.listAccounts = async () => {
    state.accountCalls += 1;
    return {
      accounts: [
        {
          uuid: "account-usdc",
          currency: "USDC",
          available_balance: { currency: "USDC", value: "10" },
          active: true,
          ready: true,
          deleted_at: null,
          platform: "ACCOUNT_PLATFORM_CONSUMER",
          retail_portfolio_id: "portfolio-1",
        },
      ],
      has_next: false,
      cursor: null,
    };
  };
  const record = await runExecutionPipeline(args);
  assert.equal(record.status, "BLOCKED");
  assert.equal(record.funding.decision, "BLOCK");
  assert.equal(state.previewCalls, 0);
});

test("unsupported modes fail closed without invoking adapters", async () => {
  const { args, state } = await probeFixture();
  await assert.rejects(
    () => runExecutionPipeline({ ...args, mode: "TEST" }),
    /mode must be exactly LIVE or PROBE/i,
  );
  assert.equal(state.productCalls, 0);
  assert.equal(state.previewCalls, 0);
});

test("built-in generic BUY and SELL both reach exact verified PASS", async () => {
  for (const intent of [BUY_INTENT, SELL_INTENT]) {
    const plan = await createExecutionPlan(intent);
    const record = await runBuiltInSimulation(
      plan,
      plan.policy_digest,
    );
    assert.equal(record.artifact_class, "SIMULATED");
    assert.equal(record.status, "FILLED");
    assert.equal(record.delta.decision, "PASS");
    assert.equal(record.delta.verifier_confirmed, true);
    assert.equal(record.delta.receipt.verified, true);
    assert.equal(
      record.delta.receipt.action_descriptor_digest,
      plan.action_descriptor.descriptor_digest,
    );
    assert.equal(record.reconciliation.checks.verdict, "PASS");
  }
});
