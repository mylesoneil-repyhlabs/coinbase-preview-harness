import test from "node:test";
import assert from "node:assert/strict";
import { createBoundExecution } from "../src/execution-binding.js";
import { createExecutionConfirmation } from "../src/execution-confirmation.js";
import {
  runBuiltInSimulation,
  runExecutionPipeline,
} from "../src/execution-pipeline.js";
import { createExecutionPlan, loadSafetyProfile } from "../src/plan.js";

const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";
const FIXED = new Date("2026-07-23T18:00:00.000Z");

async function probeFixture() {
  const plan = await createExecutionPlan(INTENT);
  const safetyProfile = await loadSafetyProfile();
  const attestation = {
    can_view: true,
    can_trade: true,
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
    previewCalls: 0,
    deltaCalls: 0,
    createCalls: 0,
  };
  return {
    state,
    args: {
      mode: "PROBE",
      plan,
      confirmPolicyDigest: plan.policy_digest,
      boundExecution,
      executionConfirmation,
      safetyProfile,
      attestation,
      now: () => new Date(FIXED),
      getProduct: async (productId) => {
        state.productCalls += 1;
        return {
          product_id: productId,
          product_type: "SPOT",
          status: "online",
          base_currency_id: "ETH",
          quote_currency_id: "USDC",
          base_increment: "0.00000001",
          quote_increment: "0.01",
          price_increment: "0.01",
          is_disabled: false,
          trading_disabled: false,
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
              bids: [{ price: "2999.00", size: "1.0" }],
              asks: [{ price: "3000.00", size: "1.0" }],
              time: FIXED.toISOString(),
            },
          ],
        };
      },
      previewAdapter: async (request) => {
        state.previewCalls += 1;
        return {
          response: {
            order_total: "5.25",
            commission_total: "0.25",
            quote_size:
              request.order_configuration.sor_limit_ioc.quote_size,
            base_size: "0.00166113",
            est_average_filled_price: "3010.00",
            best_bid: "2999.00",
            best_ask: "3000.00",
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
    },
  };
}

test("public LIVE pipeline rejects a forged capability before invoking any adapter", async () => {
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
    previewCalls: 0,
    deltaCalls: 0,
    createCalls: 0,
  });
});

test("mode accessors cannot switch from PROBE to LIVE after the capability check", async () => {
  const { args, state } = await probeFixture();
  let modeReads = 0;
  const adversarialArgs = {
    ...args,
    get mode() {
      modeReads += 1;
      return modeReads === 1 ? "PROBE" : "LIVE";
    },
  };

  const record = await runExecutionPipeline(adversarialArgs);
  assert.equal(modeReads, 1);
  assert.equal(record.status, "PREVIEW_PROBE_PASS");
  assert.equal(record.artifact_class, "PROBE");
  assert.equal(state.createCalls, 0);
  assert.equal(state.deltaCalls, 0);
});

test("credentialed Preview reaches only reads and Preview", async () => {
  const { args, state } = await probeFixture();
  const record = await runExecutionPipeline(args);
  assert.equal(record.status, "PREVIEW_PROBE_PASS");
  assert.equal(record.preview_check.verdict, "ALLOW");
  assert.equal(record.delta, null);
  assert.equal(record.execution.adapter_invoked, false);
  assert.deepEqual(state, {
    productCalls: 1,
    marketCalls: 1,
    previewCalls: 1,
    deltaCalls: 0,
    createCalls: 0,
  });
});

test("built-in simulation exercises the full controller without external adapters", async () => {
  const plan = await createExecutionPlan(INTENT);
  const record = await runBuiltInSimulation(plan, plan.policy_digest);
  assert.equal(record.artifact_class, "SIMULATED");
  assert.equal(record.status, "FILLED");
  assert.equal(record.delta.status, "success");
  assert.equal(record.delta.verifier_confirmed, true);
  assert.equal(record.execution.adapter_invoked, true);
  assert.match(record.execution.order_id, /^sim-order-/);
  assert.equal(record.reconciliation.checks.verdict, "PASS");
});

test("unsupported pipeline modes fail closed without invoking adapters", async () => {
  const { args, state } = await probeFixture();
  await assert.rejects(
    () => runExecutionPipeline({ ...args, mode: "TEST" }),
    /mode must be exactly LIVE or PROBE/,
  );
  assert.equal(state.productCalls, 0);
  assert.equal(state.previewCalls, 0);
});

test("prototype tampering cannot admit an unsupported execution mode", async () => {
  const { args, state } = await probeFixture();
  const originalIncludes = Array.prototype.includes;
  Array.prototype.includes = () => true;
  try {
    await assert.rejects(
      () => runExecutionPipeline({ ...args, mode: "TEST" }),
      /mode must be exactly LIVE or PROBE/,
    );
  } finally {
    Array.prototype.includes = originalIncludes;
  }
  assert.equal(state.productCalls, 0);
  assert.equal(state.previewCalls, 0);
  assert.equal(state.createCalls, 0);
});

test("Preview warnings block before Delta or Create", async () => {
  const { args, state } = await probeFixture();
  args.previewAdapter = async (request) => {
    state.previewCalls += 1;
    return {
      response: {
        order_total: "5.25",
        commission_total: "0.25",
        quote_size: request.order_configuration.sor_limit_ioc.quote_size,
        base_size: "0.00166113",
        est_average_filled_price: "3010.00",
        best_bid: "2999.00",
        best_ask: "3000.00",
        preview_id: "preview-1",
        errs: [],
        warning: ["UNKNOWN"],
      },
    };
  };
  const record = await runExecutionPipeline(args);
  assert.equal(record.status, "BLOCKED");
  assert.equal(record.execution.adapter_invoked, false);
  assert.equal(state.deltaCalls, 0);
  assert.equal(state.createCalls, 0);
});
