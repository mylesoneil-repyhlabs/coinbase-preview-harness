import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { signDeltaDecisionForTest } from "../src/delta-client.js";
import { digestBytes } from "../src/evidence.js";
import { createBoundExecution } from "../src/execution-binding.js";
import { runExecutionPipeline } from "../src/execution-pipeline.js";
import { createExecutionPlan, loadSafetyProfile } from "../src/plan.js";

const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";

const fixed = new Date("2026-07-23T18:00:00.000Z");

async function fixture(overrides = {}) {
  const plan = await createExecutionPlan(INTENT);
  const safetyProfile = await loadSafetyProfile();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const state = {
    createCalls: 0,
    previewRequest: null,
    evaluationRequest: null,
    createPayload: null,
    createPayloadSerialized: null,
    orderCalls: 0,
    fillCalls: 0,
    consumedJtis: new Set(),
    consumedPlans: new Set(),
    consumedAuthorizationRecord: null,
    consumedPlanRecord: null,
  };
  const now = overrides.now ?? (() => new Date(fixed));
  const deltaAdapter =
    overrides.deltaAdapter ??
    (async (request, bindings) => {
      state.evaluationRequest = request;
      overrides.mutateEvaluationRequest?.(request);
      const base = {
        schema_version: "delta.coinbase.decision.v1",
        decision_id: randomUUID(),
        decision: "ALLOW",
        evaluated_at: fixed.toISOString(),
        expires_at: new Date(fixed.getTime() + 10_000).toISOString(),
        bindings,
        checks: [{ id: "all_constraints", result: "PASS" }],
        reason_codes: [],
        authorization: {
          algorithm: "Ed25519",
          key_id: "delta-test",
          audience: "delta-coinbase-executor",
          jti: overrides.fixedJti ?? randomUUID(),
          signature: "",
        },
      };
      return signDeltaDecisionForTest(
        overrides.mutateDecision ? overrides.mutateDecision(base) : base,
        privateKey,
      );
    });

  const args = {
    mode: "LIVE",
    plan,
    confirmPolicyDigest: plan.policy_digest,
    safetyProfile,
    attestation: {
      can_view: true,
      can_trade: true,
      can_transfer: false,
      can_receive: false,
      jwt_profile: "CDP_URIS_V1",
      portfolio_fingerprint: "portfolio-fingerprint",
      key_fingerprint: "credential-fingerprint",
    },
    executionConfirmedAt: fixed,
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
          time: fixed.toISOString(),
        },
      ],
    }),
    previewAdapter: async (request) => {
      state.previewRequest = request;
      return {
        response: {
          order_total: "5.25",
          commission_total: "0.25",
          quote_size: request.order_configuration.sor_limit_ioc.quote_size,
          base_size: "0.00166113",
          est_average_filled_price: "3010.00",
          best_bid: "2999.00",
          best_ask: "3000.00",
          slippage: "0.003333",
          preview_id: "preview-1",
          errs: [],
          warning: [],
        },
      };
    },
    deltaAdapter,
    createAdapter:
      overrides.createAdapter ??
      (async (payload, serializedBody) => {
        state.createCalls += 1;
        state.createPayload = payload;
        state.createPayloadSerialized = serializedBody;
        return {
          response: {
            success: true,
            success_response: {
              order_id: "order-1",
              product_id: payload.product_id,
              side: payload.side,
              client_order_id: payload.client_order_id,
            },
            error_response: null,
            order_configuration: payload.order_configuration,
          },
        };
      }),
    getOrderAdapter:
      overrides.getOrderAdapter ??
      (async (orderId) => {
        state.orderCalls += 1;
        return {
          order: {
            order_id: orderId,
            product_id: state.createPayload.product_id,
            side: state.createPayload.side,
            client_order_id: state.createPayload.client_order_id,
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
            created_time: fixed.toISOString(),
            last_fill_time: fixed.toISOString(),
            reject_reason: "REJECT_REASON_UNSPECIFIED",
            reject_message: "",
            cancel_message: "",
            order_configuration: state.createPayload.order_configuration,
            ...(overrides.orderPatch ?? {}),
          },
        };
      }),
    listFillsAdapter:
      overrides.listFillsAdapter ??
      (async (orderId) => {
        state.fillCalls += 1;
        return {
          fills: [
            {
              entry_id: "entry-1",
              trade_id: "trade-1",
              order_id: orderId,
              trade_time: fixed.toISOString(),
              price: "3010.00",
              size: "0.00166113",
              commission: "0.25",
              product_id: state.createPayload.product_id,
              side: state.createPayload.side,
              ...(overrides.fillPatch ?? {}),
            },
          ],
          cursor: "",
          proof_token_required: false,
          ...(overrides.fillResponsePatch ?? {}),
        };
      }),
    deltaPublicKey: publicKey,
    consume: async (jti, record) => {
      if (state.consumedJtis.has(jti)) {
        throw new Error("delta authorization has already been consumed");
      }
      state.consumedJtis.add(jti);
      state.consumedAuthorizationRecord = record;
    },
    markConsumed: async () => {},
    consumePlan: async (planId, record) => {
      if (state.consumedPlans.has(planId)) {
        throw new Error("human-confirmed execution plan has already been consumed");
      }
      state.consumedPlans.add(planId);
      state.consumedPlanRecord = record;
    },
    markPlan: async () => {},
  };
  const boundExecution = createBoundExecution(
    plan,
    args.attestation,
    plan.policy_digest,
  );
  args.boundExecution = boundExecution;
  args.confirmExecutionDigest = boundExecution.execution_digest;
  return { args, state };
}

test("signed delta ALLOW submits exactly the raw body delta authorized", async () => {
  const { args, state } = await fixture();
  const record = await runExecutionPipeline(args);
  assert.equal(record.status, "FILLED");
  assert.equal(state.createCalls, 1);
  assert.deepEqual(state.evaluationRequest.create_payload, state.createPayload);
  assert.equal(
    state.evaluationRequest.create_payload_serialized,
    state.createPayloadSerialized,
  );
  assert.equal(state.createPayloadSerialized, JSON.stringify(state.createPayload));
  assert.equal(
    record.execution.create_payload_digest,
    digestBytes(state.createPayloadSerialized),
  );
  assert.deepEqual(state.createPayload.order_configuration, state.previewRequest.order_configuration);
  assert.equal(state.createPayload.preview_id, "preview-1");
  assert.equal(record.execution.order_id, "order-1");
  assert.equal(record.reconciliation.checks.verdict, "PASS");
  assert.deepEqual(state.consumedPlanRecord.create_payload, state.createPayload);
  assert.deepEqual(
    state.consumedAuthorizationRecord.create_payload,
    state.createPayload,
  );
  assert.equal(state.orderCalls, 1);
  assert.equal(state.fillCalls, 1);
});

test("credentialed preview probe cannot call delta or Coinbase Create", async () => {
  const { args, state } = await fixture();
  const boundExecution = createBoundExecution(
    args.plan,
    args.attestation,
    args.plan.policy_digest,
  );
  const probe = await runExecutionPipeline({
    ...args,
    mode: "PROBE",
    boundExecution,
    confirmExecutionDigest: boundExecution.execution_digest,
    deltaAdapter: async () => {
      throw new Error("delta must not be called by a preview probe");
    },
    createAdapter: async () => {
      state.createCalls += 1;
      throw new Error("Create must not be called by a preview probe");
    },
    getOrderAdapter: undefined,
    listFillsAdapter: undefined,
  });
  assert.equal(probe.status, "PREVIEW_PROBE_PASS");
  assert.equal(probe.preview_check.verdict, "ALLOW");
  assert.equal(probe.delta, null);
  assert.equal(probe.execution.adapter_invoked, false);
  assert.equal(state.createCalls, 0);
});

test("only the closed LIVE and PROBE modes are accepted", async () => {
  const { args, state } = await fixture();
  await assert.rejects(
    runExecutionPipeline({ ...args, mode: "TEST" }),
    /mode must be exactly LIVE or PROBE/,
  );
  await assert.rejects(
    runExecutionPipeline({ ...args, mode: undefined }),
    /mode must be exactly LIVE or PROBE/,
  );
  assert.equal(state.createCalls, 0);
});

test("delta cannot mutate the exact Create payload it is asked to authorize", async () => {
  const configured = await fixture({
    mutateEvaluationRequest: (request) => {
      request.create_payload.side = "SELL";
    },
  });
  const record = await runExecutionPipeline(configured.args);
  assert.equal(record.status, "BLOCKED");
  assert.match(record.failure.message, /read only|changed during delta evaluation/i);
  assert.equal(configured.state.createCalls, 0);
});

test("a mismatched or unsigned delta ALLOW never invokes Create Order", async () => {
  const mismatched = await fixture({
    mutateDecision: (decision) => ({
      ...decision,
      bindings: { ...decision.bindings, create_payload_digest: "changed" },
    }),
  });
  const mismatchRecord = await runExecutionPipeline(mismatched.args);
  assert.equal(mismatchRecord.status, "BLOCKED");
  assert.equal(mismatched.state.createCalls, 0);

  const unsigned = await fixture({
    deltaAdapter: async (_request, bindings) => ({
      schema_version: "delta.coinbase.decision.v1",
      decision_id: randomUUID(),
      decision: "ALLOW",
      evaluated_at: fixed.toISOString(),
      expires_at: new Date(fixed.getTime() + 10_000).toISOString(),
      bindings,
      checks: [{ id: "all_constraints", result: "PASS" }],
      reason_codes: [],
      authorization: {
        algorithm: "Ed25519",
        key_id: "delta-test",
        audience: "delta-coinbase-executor",
        jti: randomUUID(),
        signature: "",
      },
    }),
  });
  const unsignedRecord = await runExecutionPipeline(unsigned.args);
  assert.equal(unsignedRecord.status, "BLOCKED");
  assert.equal(unsigned.state.createCalls, 0);
});

test("one human-confirmed plan can reach Coinbase Create at most once", async () => {
  const { args, state } = await fixture();
  const first = await runExecutionPipeline(args);
  const second = await runExecutionPipeline(args);
  assert.equal(first.status, "FILLED");
  assert.equal(second.status, "BLOCKED");
  assert.match(second.failure.message, /plan has already been consumed/);
  assert.equal(state.createCalls, 1);
});

test("post-submit reconciliation distinguishes partial, no-fill, and pending outcomes", async () => {
  const scenarios = [
    {
      order: {
        status: "CANCELLED",
        completion_percentage: "40",
        number_of_fills: "1",
        filled_size: "0.00066445",
        filled_value: "2.00",
        average_filled_price: "3010.00",
        total_fees: "0.10",
        total_value_after_fees: "2.10",
      },
      expected: "PARTIAL_FILL",
    },
    {
      order: {
        status: "EXPIRED",
        completion_percentage: "0",
        number_of_fills: "0",
        filled_size: "0",
        filled_value: "0",
        average_filled_price: "0",
        total_fees: "0",
        total_value_after_fees: "0",
      },
      expected: "NO_FILL",
    },
    {
      order: {
        status: "PENDING",
        completion_percentage: "0",
        number_of_fills: "0",
        filled_size: "0",
        filled_value: "0",
        average_filled_price: "0",
        total_fees: "0",
        total_value_after_fees: "0",
      },
      expected: "ORDER_PENDING",
    },
  ];

  for (const scenario of scenarios) {
    let scenarioState;
    const configured = await fixture({
      getOrderAdapter: async (orderId) => ({
        order: {
          order_id: orderId,
          product_id: scenarioState.createPayload.product_id,
          side: scenarioState.createPayload.side,
          client_order_id: scenarioState.createPayload.client_order_id,
          product_type: "SPOT",
          order_type: "LIMIT",
          time_in_force: "IMMEDIATE_OR_CANCEL",
          settled: scenario.expected !== "ORDER_PENDING",
          created_time: fixed.toISOString(),
          last_fill_time: fixed.toISOString(),
          reject_reason: "REJECT_REASON_UNSPECIFIED",
          reject_message: "",
          cancel_message: "",
          order_configuration: scenarioState.createPayload.order_configuration,
          ...scenario.order,
        },
      }),
      listFillsAdapter: async (orderId) => ({
        fills:
          scenario.expected === "PARTIAL_FILL"
            ? [
                {
                  entry_id: "entry-partial",
                  trade_id: "trade-partial",
                  order_id: orderId,
                  trade_time: fixed.toISOString(),
                  price: "3010.00",
                  size: "0.00066445",
                  commission: "0.10",
                  product_id: scenarioState.createPayload.product_id,
                  side: scenarioState.createPayload.side,
                },
              ]
            : [],
      }),
    });
    scenarioState = configured.state;
    const record = await runExecutionPipeline(configured.args);
    assert.equal(record.status, scenario.expected);
  }
});

test("actual fees above the mandate are reported as an execution policy breach", async () => {
  let breachState;
  const configured = await fixture({
    getOrderAdapter: async (orderId) => ({
      order: {
        order_id: orderId,
        product_id: breachState.createPayload.product_id,
        side: breachState.createPayload.side,
        client_order_id: breachState.createPayload.client_order_id,
        status: "FILLED",
        product_type: "SPOT",
        order_type: "LIMIT",
        time_in_force: "IMMEDIATE_OR_CANCEL",
        completion_percentage: "100",
        average_filled_price: "3010.00",
        number_of_fills: "1",
        filled_size: "0.00166113",
        filled_value: "5.00",
        total_fees: "0.51",
        total_value_after_fees: "5.51",
        settled: true,
        created_time: fixed.toISOString(),
        last_fill_time: fixed.toISOString(),
        reject_reason: "REJECT_REASON_UNSPECIFIED",
        reject_message: "",
        cancel_message: "",
        order_configuration: breachState.createPayload.order_configuration,
      },
    }),
    listFillsAdapter: async (orderId) => ({
      fills: [
        {
          entry_id: "entry-breach",
          trade_id: "trade-breach",
          order_id: orderId,
          trade_time: fixed.toISOString(),
          price: "3010.00",
          size: "0.00166113",
          commission: "0.51",
          product_id: breachState.createPayload.product_id,
          side: breachState.createPayload.side,
        },
      ],
    }),
  });
  breachState = configured.state;
  const record = await runExecutionPipeline(configured.args);
  assert.equal(record.status, "EXECUTION_POLICY_BREACH");
  assert.equal(record.execution.order_submitted, true);
  assert.ok(
    record.reconciliation.checks.failures.some(
      (failure) => failure.code === "ACTUAL_COMMISSION_EXCEEDED",
    ),
  );
});

test("Get Order failure never downgrades an accepted order to blocked", async () => {
  const configured = await fixture({
    getOrderAdapter: async () => {
      throw new Error("history temporarily unavailable");
    },
  });
  const record = await runExecutionPipeline(configured.args);
  assert.equal(record.status, "RECONCILIATION_PENDING");
  assert.equal(record.execution.order_submitted, true);
  assert.equal(record.execution.order_id, "order-1");
});

test("every ambiguous post-Create result is SUBMISSION_UNCERTAIN", async () => {
  const transportFailure = await fixture({
    createAdapter: async () => {
      transportFailure.state.createCalls += 1;
      throw new Error("timeout");
    },
  });
  const timeoutRecord = await runExecutionPipeline(transportFailure.args);
  assert.equal(timeoutRecord.status, "SUBMISSION_UNCERTAIN");
  assert.equal(transportFailure.state.createCalls, 1);

  const malformed = await fixture({
    createAdapter: async () => ({ response: { success: true } }),
  });
  const malformedRecord = await runExecutionPipeline(malformed.args);
  assert.equal(malformedRecord.status, "SUBMISSION_UNCERTAIN");

  const contradictoryRejection = await fixture({
    createAdapter: async (payload) => ({
      response: {
        success: false,
        success_response: {
          order_id: "possibly-created-order",
          product_id: payload.product_id,
          side: payload.side,
          client_order_id: payload.client_order_id,
        },
        error_response: { message: "contradictory response" },
      },
    }),
  });
  const contradictoryRecord = await runExecutionPipeline(
    contradictoryRejection.args,
  );
  assert.equal(contradictoryRecord.status, "SUBMISSION_UNCERTAIN");
});

test("stale market evidence and explicit Coinbase rejection do not masquerade as success", async () => {
  const stale = await fixture({
    now: () => new Date(fixed.getTime() + 6_000),
  });
  const staleRecord = await runExecutionPipeline(stale.args);
  assert.equal(staleRecord.status, "BLOCKED");
  assert.match(staleRecord.failure.message, /market evidence is stale/);
  assert.equal(stale.state.createCalls, 0);

  const rejected = await fixture({
    createAdapter: async () => ({
      response: {
        success: false,
        success_response: null,
        error_response: { message: "insufficient funds" },
      },
    }),
  });
  const rejectedRecord = await runExecutionPipeline(rejected.args);
  assert.equal(rejectedRecord.status, "COINBASE_REJECTED");
  assert.match(rejectedRecord.failure.message, /insufficient funds/);
});

test("all temporal gates are rechecked immediately before Create", async () => {
  const expiredDuringCredentialVerification = await fixture({
    now: () => new Date(fixed.getTime() + 121_000),
  });
  const credentialDelayRecord = await runExecutionPipeline(
    expiredDuringCredentialVerification.args,
  );
  assert.equal(credentialDelayRecord.status, "BLOCKED");
  assert.match(
    credentialDelayRecord.failure.message,
    /expired before credential verification completed/,
  );
  assert.equal(expiredDuringCredentialVerification.state.createCalls, 0);

  let preSubmitClockCalls = 0;
  const staleBeforeConsumption = await fixture({
    now: () =>
      new Date(
        fixed.getTime() + (++preSubmitClockCalls >= 6 ? 6_000 : 0),
      ),
  });
  const staleRecord = await runExecutionPipeline(staleBeforeConsumption.args);
  assert.equal(staleRecord.status, "BLOCKED");
  assert.match(staleRecord.failure.message, /market evidence is stale/);
  assert.equal(staleBeforeConsumption.state.createCalls, 0);

  let postConsumptionClockCalls = 0;
  const expiredAfterConsumption = await fixture({
    now: () =>
      new Date(
        fixed.getTime() + (++postConsumptionClockCalls >= 8 ? 11_000 : 0),
      ),
  });
  const expiredRecord = await runExecutionPipeline(expiredAfterConsumption.args);
  assert.equal(expiredRecord.status, "BLOCKED");
  assert.equal(expiredRecord.failure.stage, "POST_AUTHORIZATION");
  assert.match(expiredRecord.failure.message, /authorization expired/);
  assert.equal(expiredAfterConsumption.state.createCalls, 0);
});

test("incomplete or incoherent fill evidence cannot report terminal success", async () => {
  const unavailable = await fixture({
    listFillsAdapter: async () => {
      throw new Error("fills unavailable");
    },
  });
  const unavailableRecord = await runExecutionPipeline(unavailable.args);
  assert.equal(unavailableRecord.status, "RECONCILIATION_PENDING");
  assert.equal(unavailableRecord.execution.order_submitted, true);

  const incomplete = await fixture({
    listFillsAdapter: async () => ({ fills: [] }),
  });
  const incompleteRecord = await runExecutionPipeline(incomplete.args);
  assert.equal(incompleteRecord.status, "RECONCILIATION_PENDING");
  assert.equal(incompleteRecord.reconciliation.fills_complete, false);

  const zeroFilled = await fixture({
    orderPatch: {
      number_of_fills: "0",
      filled_size: "0",
      filled_value: "0",
      average_filled_price: "0",
      total_fees: "0",
      total_value_after_fees: "0",
    },
    listFillsAdapter: async () => ({ fills: [] }),
  });
  const zeroFilledRecord = await runExecutionPipeline(zeroFilled.args);
  assert.equal(zeroFilledRecord.status, "RECONCILIATION_PENDING");

  const contradictoryAggregate = await fixture({
    fillPatch: { size: "0.00010000" },
  });
  const contradictoryAggregateRecord = await runExecutionPipeline(
    contradictoryAggregate.args,
  );
  assert.equal(
    contradictoryAggregateRecord.status,
    "RECONCILIATION_PENDING",
  );
  assert.equal(
    contradictoryAggregateRecord.reconciliation.evidence_coherent,
    false,
  );

  const paginated = await fixture({
    fillResponsePatch: { cursor: "next-page" },
  });
  const paginatedRecord = await runExecutionPipeline(paginated.args);
  assert.equal(paginatedRecord.status, "RECONCILIATION_PENDING");
  assert.equal(paginatedRecord.reconciliation.pagination_complete, false);

  const invalidCount = await fixture({
    orderPatch: { number_of_fills: "1.5" },
  });
  const invalidCountRecord = await runExecutionPipeline(invalidCount.args);
  assert.equal(invalidCountRecord.status, "RECONCILIATION_FAILED");
  assert.match(invalidCountRecord.failure.error, /nonnegative integer/);
});
