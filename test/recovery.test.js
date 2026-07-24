import test from "node:test";
import assert from "node:assert/strict";
import { digestBytes } from "../src/evidence.js";
import { createExecutionPlan } from "../src/plan.js";
import { recoverExecution } from "../src/recovery.js";

const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";
const fixed = new Date("2026-07-23T18:00:00.000Z");

async function recoveryFixture(overrides = {}) {
  const plan = await createExecutionPlan(INTENT);
  const createPayload = {
    client_order_id: "client-order-1",
    product_id: "ETH-USDC",
    side: "BUY",
    order_configuration: {
      sor_limit_ioc: {
        quote_size: "5",
        limit_price: "3015.00",
      },
    },
    preview_id: "preview-1",
  };
  const market = {
    product_id: "ETH-USDC",
    product_type: "SPOT",
    base_asset: "ETH",
    quote_asset: "USDC",
    base_increment: "0.00000001",
    quote_increment: "0.01",
    price_increment: "0.01",
    best_bid: "2999.00",
    best_ask: "3000.00",
    observed_at: fixed.toISOString(),
    product_flags: {
      is_disabled: false,
      trading_disabled: false,
      cancel_only: false,
      limit_only: false,
      post_only: false,
      auction_mode: false,
    },
  };
  const attestation = {
    portfolio_fingerprint: "portfolio-fingerprint",
    key_fingerprint: "credential-fingerprint",
  };
  const createPayloadSerialized = JSON.stringify(createPayload);
  const stored = {
    status: "SUBMISSION_UNCERTAIN",
    plan_id: plan.plan_id,
    consumed_at: fixed.toISOString(),
    intent_id: "intent-1",
    policy: plan.policy,
    policy_digest: plan.policy_digest,
    market,
    decision_id: "decision-1",
    client_order_id: createPayload.client_order_id,
    create_payload_digest: digestBytes(createPayloadSerialized),
    create_payload: createPayload,
    create_payload_serialized: createPayloadSerialized,
    portfolio_fingerprint: attestation.portfolio_fingerprint,
    credential_fingerprint: attestation.key_fingerprint,
    ...overrides.stored,
  };
  const order = {
    order_id: "order-1",
    product_id: createPayload.product_id,
    side: createPayload.side,
    client_order_id: createPayload.client_order_id,
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
    order_configuration: createPayload.order_configuration,
    ...overrides.order,
  };
  const fill = {
    entry_id: "entry-1",
    trade_id: "trade-1",
    order_id: order.order_id,
    trade_time: fixed.toISOString(),
    price: "3010.00",
    size: "0.00166113",
    commission: "0.25",
    product_id: createPayload.product_id,
    side: createPayload.side,
    ...overrides.fill,
  };
  return { plan, stored, attestation, order, fill };
}

test("read-only recovery finds an uncertain submission by client_order_id", async () => {
  const fixture = await recoveryFixture();
  const cursors = [];
  let marked;
  const record = await recoverExecution({
    planId: fixture.plan.plan_id,
    stored: fixture.stored,
    attestation: fixture.attestation,
    listOrdersAdapter: async ({ cursor }) => {
      cursors.push(cursor ?? null);
      return cursor
        ? {
            orders: [
              {
                order_id: fixture.order.order_id,
                client_order_id: fixture.stored.client_order_id,
              },
            ],
            has_next: false,
            cursor: "",
          }
        : { orders: [], has_next: true, cursor: "page-2" };
    },
    getOrderAdapter: async () => ({ order: fixture.order }),
    listFillsAdapter: async () => ({
      fills: [fixture.fill],
      cursor: "",
    }),
    now: () => new Date(fixed),
    markGrant: async (_planId, patch) => {
      marked = patch;
    },
  });
  assert.equal(record.status, "FILLED");
  assert.equal(record.execution.order_submitted, true);
  assert.equal(record.execution.order_id, "order-1");
  assert.deepEqual(cursors, [null, "page-2"]);
  assert.equal(record.recovery.pages_scanned, 2);
  assert.equal(marked.status, "FILLED");
});

test("no visible client_order_id remains uncertain and never implies no order", async () => {
  const fixture = await recoveryFixture();
  const record = await recoverExecution({
    planId: fixture.plan.plan_id,
    stored: fixture.stored,
    attestation: fixture.attestation,
    listOrdersAdapter: async () => ({
      orders: [],
      has_next: false,
      cursor: "",
    }),
    now: () => new Date(fixed),
    markGrant: async () => {},
  });
  assert.equal(record.status, "SUBMISSION_UNCERTAIN");
  assert.equal(record.execution.order_submitted, null);
  assert.match(record.failure.message, /do not submit a replacement/i);
});

test("recovery uses a known order_id directly and fails closed on credential drift", async () => {
  const fixture = await recoveryFixture({
    stored: { order_id: "order-1", status: "RECONCILIATION_PENDING" },
  });
  let listOrdersCalls = 0;
  const record = await recoverExecution({
    planId: fixture.plan.plan_id,
    stored: fixture.stored,
    attestation: fixture.attestation,
    listOrdersAdapter: async () => {
      listOrdersCalls += 1;
      return { orders: [] };
    },
    getOrderAdapter: async () => ({ order: fixture.order }),
    listFillsAdapter: async () => ({
      fills: [fixture.fill],
      cursor: "",
    }),
    now: () => new Date(fixed),
    markGrant: async () => {},
  });
  assert.equal(record.status, "FILLED");
  assert.equal(listOrdersCalls, 0);

  await assert.rejects(
    recoverExecution({
      planId: fixture.plan.plan_id,
      stored: fixture.stored,
      attestation: {
        ...fixture.attestation,
        key_fingerprint: "different-key",
      },
      markGrant: async () => {},
    }),
    /does not match this credential-scoped portfolio/,
  );

  await assert.rejects(
    recoverExecution({
      planId: fixture.plan.plan_id,
      stored: {
        ...fixture.stored,
        status: "PRE_SUBMISSION_ABORTED",
      },
      attestation: fixture.attestation,
      markGrant: async () => {},
    }),
    /has no unresolved Coinbase submission/,
  );
});
