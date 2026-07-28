import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoinbaseCreateRequest,
  buildCoinbasePreviewRequest,
} from "../src/coinbase-order.js";

const action = Object.freeze({
  product_id: "ETH-USDC",
  side: "BUY",
  type: "limit",
  time_in_force: "IOC",
  quote_size: "5.00",
  limit_price: "3015.00",
});

test("derives the exact raw Coinbase SOR preview body from a closed action", () => {
  assert.deepEqual(buildCoinbasePreviewRequest(action), {
    product_id: "ETH-USDC",
    side: "BUY",
    order_configuration: {
      sor_limit_ioc: {
        quote_size: "5.00",
        limit_price: "3015.00",
      },
    },
  });
});

test("Create Order body is the authorized preview body plus idempotency and preview IDs", () => {
  const preview = buildCoinbasePreviewRequest(action);
  const create = buildCoinbaseCreateRequest(
    action,
    "00000000-0000-4000-8000-000000000001",
    "preview-1",
  );
  assert.deepEqual(create, {
    client_order_id: "00000000-0000-4000-8000-000000000001",
    ...preview,
    preview_id: "preview-1",
  });
  assert.equal(
    JSON.stringify(create.order_configuration),
    JSON.stringify(preview.order_configuration),
  );
  assert.doesNotMatch(
    JSON.stringify(create),
    /transfer|convert|leverage|margin|rfq_disabled|portfolio/,
  );
});

test("raw Coinbase body derivation rejects unknown or unsupported action fields", () => {
  assert.throws(
    () => buildCoinbasePreviewRequest({ ...action, leverage: "10" }),
    /schema mismatch/,
  );
  assert.throws(
    () =>
      buildCoinbasePreviewRequest({
        ...action,
        base_size: "0.1",
      }),
    /schema mismatch/,
  );
});

test("SELL transports only base_size through Preview and Create", () => {
  const sell = {
    product_id: "BTC-USD",
    side: "SELL",
    type: "limit",
    time_in_force: "IOC",
    base_size: "0.05000000",
    limit_price: "64000.00",
  };
  assert.deepEqual(buildCoinbasePreviewRequest(sell), {
    product_id: "BTC-USD",
    side: "SELL",
    order_configuration: {
      sor_limit_ioc: {
        base_size: "0.05000000",
        limit_price: "64000.00",
      },
    },
  });
  assert.throws(
    () =>
      buildCoinbasePreviewRequest({
        ...sell,
        quote_size: "3200",
      }),
    /schema mismatch/,
  );
});
