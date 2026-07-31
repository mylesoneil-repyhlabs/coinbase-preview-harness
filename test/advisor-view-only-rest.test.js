import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COINBASE_VIEW_BROKERAGE_PATH,
  createCoinbaseViewOnlyPreflightAdapter,
  VIEW_ONLY_PREFLIGHT_ROUTES,
} from "../src/coinbase-view-only-rest.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function credentials() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    keyId: "organizations/test/apiKeys/view-only",
    privateKey: privateKey
      .export({ format: "pem", type: "sec1" })
      .toString(),
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
  return JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  );
}

test("advisor View-only transport exposes only accounts, product, BBO, and Preview", async () => {
  const calls = [];
  const adapter = createCoinbaseViewOnlyPreflightAdapter(
    credentials(),
    {
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        const pathname = new URL(url).pathname;
        if (
          pathname ===
          `${COINBASE_VIEW_BROKERAGE_PATH}/accounts`
        ) {
          return response({
            accounts: [],
            has_next: false,
            cursor: null,
          });
        }
        return response({ ok: true });
      },
    },
  );

  assert.deepEqual(Object.keys(adapter).sort(), [
    "getBestBidAsk",
    "getProduct",
    "listAccounts",
    "previewOrder",
  ]);
  assert.equal(Object.hasOwn(adapter, "createOrder"), false);
  assert.equal(Object.hasOwn(adapter, "getOrder"), false);
  assert.equal(Object.hasOwn(adapter, "listOrders"), false);

  await adapter.listAccounts();
  await adapter.getProduct("ETH-USDC");
  await adapter.getBestBidAsk("ETH-USDC");
  const preview = {
    product_id: "ETH-USDC",
    side: "BUY",
    order_configuration: {
      sor_limit_ioc: {
        quote_size: "250",
        limit_price: "3000",
      },
    },
  };
  await adapter.previewOrder(preview);

  assert.equal(calls.length, 4);
  assert.equal(
    new URL(calls[3].url).pathname,
    `${COINBASE_VIEW_BROKERAGE_PATH}/orders/preview`,
  );
  assert.deepEqual(JSON.parse(calls[3].options.body), preview);
  assert.deepEqual(
    jwtPayload(calls[3].options.headers.Authorization).uris,
    [
      `POST api.coinbase.com${COINBASE_VIEW_BROKERAGE_PATH}/orders/preview`,
    ],
  );
  assert.equal(calls[3].options.redirect, "error");
});

test("View-only transport uses an immutable route/method allowlist and session abort", async () => {
  assert.equal(Object.isFrozen(VIEW_ONLY_PREFLIGHT_ROUTES), true);
  assert.deepEqual(
    VIEW_ONLY_PREFLIGHT_ROUTES.map(({ method, path }) => [
      method,
      path ?? "PRODUCT_PATH_PATTERN",
    ]),
    [
      ["GET", `${COINBASE_VIEW_BROKERAGE_PATH}/accounts`],
      ["GET", "PRODUCT_PATH_PATTERN"],
      [
        "GET",
        `${COINBASE_VIEW_BROKERAGE_PATH}/best_bid_ask`,
      ],
      [
        "POST",
        `${COINBASE_VIEW_BROKERAGE_PATH}/orders/preview`,
      ],
    ],
  );

  const controller = new AbortController();
  controller.abort();
  let observedSignal = null;
  const adapter = createCoinbaseViewOnlyPreflightAdapter(
    credentials(),
    {
      signal: controller.signal,
      fetchImpl: async (_url, options) => {
        observedSignal = options.signal;
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    },
  );
  await assert.rejects(
    () => adapter.getProduct("ETH-USDC"),
    /aborted/,
  );
  assert.equal(observedSignal.aborted, true);
});

async function relativeDependencyClosure(entry) {
  const visited = new Set();
  async function visit(file) {
    const absolute = path.resolve(file);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    const source = await readFile(absolute, "utf8");
    for (const match of source.matchAll(
      /(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?["'](\.[^"']+)["']/g,
    )) {
      const resolved = path.resolve(
        path.dirname(absolute),
        match[1].endsWith(".js")
          ? match[1]
          : `${match[1]}.js`,
      );
      await visit(resolved);
    }
  }
  await visit(entry);
  return visited;
}

test("advisor dependency closure excludes the Coinbase execution REST adapter", async () => {
  const closure = await relativeDependencyClosure(
    path.join(ROOT, "src", "advisor", "server.js"),
  );
  const relative = [...closure].map((file) =>
    path.relative(ROOT, file),
  );
  assert.equal(relative.includes("src/coinbase-rest.js"), false);

  const sources = await Promise.all(
    [...closure].map((file) => readFile(file, "utf8")),
  );
  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /\bcreateCoinbaseExecutionAdapter\b/,
  );
  assert.doesNotMatch(
    combined,
    /request\(\s*["']POST["']\s*,\s*[^)]*\/orders["']/,
  );
});
