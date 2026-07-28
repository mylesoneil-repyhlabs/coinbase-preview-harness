import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  BROKERAGE_PATH,
  createCoinbaseExecutionAdapter,
  createCoinbaseRestAdapter,
} from "../src/coinbase-rest.js";

function credentials() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    keyId: "organizations/test/apiKeys/test",
    privateKey: privateKey.export({ format: "pem", type: "sec1" }).toString(),
  };
}

function response(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function jwtPayload(header) {
  const token = header.replace(/^Bearer /, "");
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

test("direct adapter binds a fresh JWT to the exact product path without query", async () => {
  const calls = [];
  const adapter = createCoinbaseRestAdapter(credentials(), {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ product_id: "ETH-USDC" });
    },
  });
  await adapter.getProduct("ETH-USDC");
  assert.equal(
    calls[0].url,
    `https://api.coinbase.com${BROKERAGE_PATH}/products/ETH-USDC?get_tradability_status=true`,
  );
  assert.deepEqual(jwtPayload(calls[0].options.headers.Authorization).uris, [
    `GET api.coinbase.com${BROKERAGE_PATH}/products/ETH-USDC`,
  ]);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["Cache-Control"], "no-cache");
});

test("public adapter sends the exact Preview body and exposes no Create method", async () => {
  const calls = [];
  const adapter = createCoinbaseRestAdapter(credentials(), {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ success: true });
    },
  });
  const preview = {
    product_id: "ETH-USDC",
    side: "BUY",
    order_configuration: {
      sor_limit_ioc: {
        quote_size: "5.00",
        limit_price: "3015.00",
      },
    },
  };
  await adapter.previewOrder(preview);

  assert.deepEqual(JSON.parse(calls[0].options.body), preview);
  assert.deepEqual(jwtPayload(calls[0].options.headers.Authorization).uris, [
    `POST api.coinbase.com${BROKERAGE_PATH}/orders/preview`,
  ]);
  assert.equal(Object.hasOwn(adapter, "createOrder"), false);
  assert.equal(calls.length, 1);
});

test("Create transport cannot be constructed without the private production capability", () => {
  let fetchCalls = 0;
  assert.throws(
    () =>
      createCoinbaseExecutionAdapter(credentials(), Symbol("forged"), {
        fetchImpl: async () => {
          fetchCalls += 1;
          return response({ success: true });
        },
      }),
    /ENGINEERING_INTEGRATION_REQUIRED/,
  );
  assert.equal(fetchCalls, 0);
});

test("direct adapter fails closed on redirects, non-JSON, and HTTP errors", async () => {
  const adapter = createCoinbaseRestAdapter(credentials(), {
    fetchImpl: async () => response({ message: "permission denied" }, { status: 403 }),
  });
  await assert.rejects(
    () => adapter.getBestBidAsk("ETH-USDC"),
    /permission denied/,
  );
});

test("direct adapter binds Get Order and List Fills JWTs to query-free paths", async () => {
  const calls = [];
  const adapter = createCoinbaseRestAdapter(credentials(), {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ order: {}, fills: [] });
    },
  });
  await adapter.getOrder("order-1");
  await adapter.listFills("order-1");

  assert.equal(
    calls[0].url,
    `https://api.coinbase.com${BROKERAGE_PATH}/orders/historical/order-1`,
  );
  assert.deepEqual(jwtPayload(calls[0].options.headers.Authorization).uris, [
    `GET api.coinbase.com${BROKERAGE_PATH}/orders/historical/order-1`,
  ]);
  assert.equal(
    calls[1].url,
    `https://api.coinbase.com${BROKERAGE_PATH}/orders/historical/fills?order_ids=order-1&limit=100`,
  );
  assert.deepEqual(jwtPayload(calls[1].options.headers.Authorization).uris, [
    `GET api.coinbase.com${BROKERAGE_PATH}/orders/historical/fills`,
  ]);
  assert.throws(
    () => adapter.getOrder("../orders"),
    /Invalid Coinbase order_id/,
  );
});

test("List Orders recovery scan is narrowly filtered and query-free in the JWT", async () => {
  const calls = [];
  const adapter = createCoinbaseRestAdapter(credentials(), {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ orders: [], has_next: false, cursor: "" });
    },
  });
  await adapter.listOrders({
    productId: "ETH-USDC",
    side: "BUY",
    startDate: "2026-07-23T17:55:00.000Z",
    endDate: "2026-07-23T18:05:00.000Z",
    cursor: "next-page",
  });

  const url = new URL(calls[0].url);
  assert.equal(
    url.origin + url.pathname,
    `https://api.coinbase.com${BROKERAGE_PATH}/orders/historical/batch`,
  );
  assert.deepEqual(url.searchParams.getAll("product_ids"), ["ETH-USDC"]);
  assert.equal(url.searchParams.get("product_type"), "SPOT");
  assert.equal(url.searchParams.get("order_side"), "BUY");
  assert.equal(
    url.searchParams.get("end_date"),
    "2026-07-23T18:05:00.000Z",
  );
  assert.deepEqual(url.searchParams.getAll("time_in_forces"), [
    "IMMEDIATE_OR_CANCEL",
  ]);
  assert.deepEqual(url.searchParams.getAll("order_types"), ["LIMIT"]);
  assert.equal(url.searchParams.get("cursor"), "next-page");
  assert.deepEqual(jwtPayload(calls[0].options.headers.Authorization).uris, [
    `GET api.coinbase.com${BROKERAGE_PATH}/orders/historical/batch`,
  ]);
});

test("List Accounts follows bounded pagination and returns complete funding evidence", async () => {
  const calls = [];
  const adapter = createCoinbaseRestAdapter(credentials(), {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      const cursor = new URL(url).searchParams.get("cursor");
      return cursor == null
        ? response({
            accounts: [{ uuid: "a", currency: "USDC" }],
            has_next: true,
            cursor: "next-page",
          })
        : response({
            accounts: [{ uuid: "b", currency: "BTC" }],
            has_next: false,
            cursor: "",
          });
    },
  });
  const result = await adapter.listAccounts();
  assert.deepEqual(
    result.accounts.map(({ uuid }) => uuid),
    ["a", "b"],
  );
  assert.equal(result.has_next, false);
  assert.equal(calls.length, 2);
  assert.equal(
    new URL(calls[0].url).pathname,
    `${BROKERAGE_PATH}/accounts`,
  );
  assert.equal(
    new URL(calls[1].url).searchParams.get("cursor"),
    "next-page",
  );
  assert.deepEqual(jwtPayload(calls[1].options.headers.Authorization).uris, [
    `GET api.coinbase.com${BROKERAGE_PATH}/accounts`,
  ]);
});

test("List Accounts rejects repeated pagination cursors", async () => {
  const adapter = createCoinbaseRestAdapter(credentials(), {
    fetchImpl: async () =>
      response({ accounts: [], has_next: true, cursor: "repeat" }),
  });
  await assert.rejects(
    () => adapter.listAccounts(),
    /cursor repeated/,
  );
});

test("List Products pins SPOT and exact requested product IDs", async () => {
  const calls = [];
  const adapter = createCoinbaseRestAdapter(credentials(), {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ products: [] });
    },
  });
  await adapter.listProducts({
    productIds: ["SOL-USDC", "BTC-USD"],
  });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, `${BROKERAGE_PATH}/products`);
  assert.equal(url.searchParams.get("product_type"), "SPOT");
  assert.equal(
    url.searchParams.get("get_tradability_status"),
    "true",
  );
  assert.deepEqual(url.searchParams.getAll("product_ids"), [
    "SOL-USDC",
    "BTC-USD",
  ]);
  assert.throws(
    () => adapter.listProducts({ productIds: ["../orders"] }),
    /Invalid Coinbase product_id/,
  );
});
