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
    () => buildCoinbasePreviewRequest({ ...action, side: "SELL" }),
    /only transports BUY/,
  );
});
