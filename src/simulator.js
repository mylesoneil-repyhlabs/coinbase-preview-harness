import { generateKeyPairSync, randomUUID } from "node:crypto";
import { signDeltaDecisionForTest } from "./delta-client.js";
import { digest } from "./evidence.js";
import { createBoundExecution } from "./execution-binding.js";
import { runExecutionPipeline } from "./execution-pipeline.js";
import { loadSafetyProfile } from "./plan.js";

export async function simulateExecution(plan, confirmPolicyDigest) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const fixedNow = new Date("2026-07-23T18:00:00.000Z");
  const now = () => new Date(fixedNow);
  const consumed = new Set();
  const consumedPlans = new Set();
  let submittedOrder = null;
  const safetyProfile = await loadSafetyProfile();
  const attestation = {
    can_view: true,
    can_trade: true,
    can_transfer: false,
    can_receive: false,
    jwt_profile: "CDP_URIS_V1",
    portfolio_fingerprint: "simulated-portfolio-fingerprint",
    key_fingerprint: "simulated-trade-key-fingerprint",
  };
  const boundExecution = createBoundExecution(
    plan,
    attestation,
    confirmPolicyDigest,
  );

  const liveShapedRecord = await runExecutionPipeline({
    mode: "LIVE",
    plan,
    confirmPolicyDigest,
    boundExecution,
    confirmExecutionDigest: boundExecution.execution_digest,
    executionConfirmedAt: fixedNow,
    safetyProfile,
    attestation,
    now,
    getProduct: async (productId) => ({
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
    }),
    getBestBidAsk: async (productId) => ({
      pricebooks: [
        {
          product_id: productId,
          bids: [{ price: "2999.00", size: "1.0" }],
          asks: [{ price: "3000.00", size: "1.0" }],
          time: fixedNow.toISOString(),
        },
      ],
    }),
    previewAdapter: async (requestBody) => ({
      response: {
        order_total: "5.25",
        commission_total: "0.25",
        quote_size:
          requestBody.order_configuration.sor_limit_ioc.quote_size,
        base_size: "0.00166113",
        est_average_filled_price: "3010.00",
        best_bid: "2999.00",
        best_ask: "3000.00",
        slippage: "0.003333",
        preview_id: `sim-preview-${randomUUID()}`,
        errs: [],
        warning: [],
      },
    }),
    deltaAdapter: async (_request, bindings) => {
      const evaluatedAt = fixedNow.toISOString();
      const decision = {
        schema_version: "delta.coinbase.decision.v1",
        decision_id: randomUUID(),
        decision: "ALLOW",
        evaluated_at: evaluatedAt,
        expires_at: new Date(fixedNow.getTime() + 10_000).toISOString(),
        bindings,
        checks: [
          { id: "simulated.all_constraints", result: "PASS" },
        ],
        reason_codes: [],
        authorization: {
          algorithm: "Ed25519",
          key_id: "simulated-delta-verifier",
          audience: "delta-coinbase-executor",
          jti: randomUUID(),
          signature: "",
        },
      };
      return signDeltaDecisionForTest(decision, privateKey);
    },
    createAdapter: async (payload, serializedBody) => {
      if (serializedBody !== JSON.stringify(payload)) {
        throw new Error("Simulated Create body changed after delta authorization");
      }
      submittedOrder = {
        order_id: `sim-order-${randomUUID()}`,
        payload,
      };
      return {
        response: {
          success: true,
          success_response: {
            order_id: submittedOrder.order_id,
            product_id: payload.product_id,
            side: payload.side,
            client_order_id: payload.client_order_id,
          },
          error_response: null,
          order_configuration: payload.order_configuration,
        },
      };
    },
    getOrderAdapter: async (orderId) => ({
      order: {
        order_id: orderId,
        product_id: submittedOrder.payload.product_id,
        side: submittedOrder.payload.side,
        client_order_id: submittedOrder.payload.client_order_id,
        status: "FILLED",
        product_type: "SPOT",
        order_type: "LIMIT",
        time_in_force: "IMMEDIATE_OR_CANCEL",
        completion_percentage: "100",
        average_filled_price: "3010.00",
        number_of_fills: "1",
        filled_size: "0.00166113",
        filled_value: "5.00",
        total_fees: "0.25",
        total_value_after_fees: "5.25",
        settled: true,
        created_time: fixedNow.toISOString(),
        last_fill_time: fixedNow.toISOString(),
        reject_reason: "REJECT_REASON_UNSPECIFIED",
        reject_message: "",
        cancel_message: "",
        order_configuration: submittedOrder.payload.order_configuration,
      },
    }),
    listFillsAdapter: async (orderId) => ({
      fills: [
        {
          entry_id: `sim-entry-${randomUUID()}`,
          trade_id: `sim-trade-${randomUUID()}`,
          order_id: orderId,
          trade_time: fixedNow.toISOString(),
          price: "3010.00",
          size: "0.00166113",
          commission: "0.25",
          product_id: submittedOrder.payload.product_id,
          side: submittedOrder.payload.side,
        },
      ],
      cursor: "",
      proof_token_required: false,
    }),
    deltaPublicKey: publicKey,
    consume: async (jti) => {
      if (consumed.has(jti)) throw new Error("delta authorization has already been consumed");
      consumed.add(jti);
    },
    markConsumed: async () => {},
    consumePlan: async (planId) => {
      if (consumedPlans.has(planId)) {
        throw new Error("human-confirmed execution plan has already been consumed");
      }
      consumedPlans.add(planId);
    },
    markPlan: async () => {},
  });
  const { record_digest: _previousDigest, ...record } = liveShapedRecord;
  const simulatedRecord = { ...record, artifact_class: "SIMULATED" };
  return {
    ...simulatedRecord,
    record_digest: digest(simulatedRecord),
  };
}
