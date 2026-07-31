import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import {
  createInMemoryViewCredentialProvider,
} from "../src/advisor/view-only-credential-provider.js";
import { listenAdvisorServer } from "../src/advisor/server.js";
import { digest, digestBytes } from "../src/evidence.js";
import {
  validateViewCredentialMaterial,
} from "../src/permissions.js";

const INTENT =
  "Using held USDC, buy up to 3,000 USDC of ETH on ETH-USDC once with a price-bounded IOC limit order and allow partial fills. Only if Coinbase's fresh best ask is at or below 3,000 USDC. Do not pay more than 35 bps above Coinbase's fresh best ask, more than 15 USDC in fees, or more than 3,015 USDC total. The authorization expires 10 minutes after I confirm it.";

function credential() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    name: "organizations/test/apiKeys/view-only",
    privateKey: privateKey
      .export({ type: "sec1", format: "pem" })
      .toString(),
  };
}

function request(
  baseUrl,
  {
    pathname = "/",
    method = "GET",
    headers = {},
    body = null,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const call = http.request(
      new URL(pathname, baseUrl),
      { method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            json: () => JSON.parse(text),
          });
        });
      },
    );
    call.on("error", reject);
    if (body != null) call.write(body);
    call.end();
  });
}

function cookieFrom(response) {
  const values = response.headers["set-cookie"];
  assert.ok(Array.isArray(values) && values.length === 1);
  return values[0].split(";", 1)[0];
}

function mutationHeaders(baseUrl, cookie = null) {
  return {
    "Content-Type": "application/json",
    Origin: baseUrl,
    "Sec-Fetch-Site": "same-origin",
    "X-Delta-Advisor": "1",
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function verifiedCredential(material) {
  const parsed = validateViewCredentialMaterial(material);
  const attestation = {
    schema: "delta.coinbase.view_permission_attestation.v2",
    verified_at: new Date().toISOString(),
    environment: "coinbase-read-preview",
    jwt_profile: "CDP_URIS_V1",
    can_view: true,
    can_trade: false,
    can_transfer: false,
    can_receive: null,
    can_receive_reported: false,
    key_fingerprint: digest(parsed.keyId),
    portfolio_fingerprint: digest("test-portfolio"),
  };
  const result = { attestation };
  Object.defineProperty(result, "credentials", {
    enumerable: false,
    value: parsed,
  });
  return Object.freeze(result);
}

function fakeViewAdapter(calls) {
  return Object.freeze({
    async listAccounts() {
      calls.push("GET accounts");
      return {
        accounts: [
          {
            uuid: "redacted-before-browser",
            currency: "USDC",
            available_balance: {
              currency: "USDC",
              value: "5000",
            },
            active: true,
            ready: true,
            deleted_at: null,
            platform: "ACCOUNT_PLATFORM_CONSUMER",
            retail_portfolio_id: "test-portfolio",
          },
        ],
        has_next: false,
        cursor: null,
      };
    },
    async getProduct(productId) {
      calls.push(`GET product ${productId}`);
      return {
        product_id: productId,
        product_type: "SPOT",
        status: "online",
        base_currency_id: "ETH",
        quote_currency_id: "USDC",
        base_increment: "0.00000001",
        quote_increment: "0.01",
        price_increment: "0.01",
        base_min_size: "0.0001",
        base_max_size: "1000",
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
    async getBestBidAsk(productId) {
      calls.push(`GET BBO ${productId}`);
      return {
        pricebooks: [
          {
            product_id: productId,
            bids: [{ price: "2899.00", size: "5" }],
            asks: [{ price: "2900.00", size: "5" }],
            time: new Date().toISOString(),
          },
        ],
      };
    },
    async previewOrder(body) {
      calls.push("POST orders/preview");
      const configuration =
        body.order_configuration.sor_limit_ioc;
      return {
        response: {
          order_total: "3000",
          commission_total: "10",
          quote_size: configuration.quote_size,
          base_size: "1.03092784",
          est_average_filled_price: "2910.00",
          best_bid: "2899.00",
          best_ask: "2900.00",
          preview_id: "preview-session-only-test",
          errs: [],
          warning: [],
        },
        transport: {
          method: "POST",
          host: "api.coinbase.com",
          path: "/api/v3/brokerage/orders/preview",
          sent_body_digest: digestBytes(
            JSON.stringify(body),
          ),
        },
      };
    },
  });
}

async function advisor(t, options = {}) {
  const running = await listenAdvisorServer(options);
  t.after(() => running.close());
  return running;
}

test("public status allocates neither a browser session nor a credential provider", async (t) => {
  let providerFactories = 0;
  const running = await advisor(t, {
    createViewCredentialProvider() {
      providerFactories += 1;
      throw new Error("status must not create provider");
    },
  });
  const response = await request(running.url, {
    pathname: "/api/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(providerFactories, 0);
});

test("connection status without a cookie allocates no session, provider, or cookie", async (t) => {
  let opens = 0;
  let providerFactories = 0;
  const sessionStore = {
    idleTtlSeconds: 900,
    absoluteTtlSeconds: 3600,
    ttlSeconds: 900,
    peek() {
      return null;
    },
    open() {
      opens += 1;
      throw new Error("connection status must not open");
    },
    clear() {},
  };
  const running = await advisor(t, {
    sessionStore,
    createViewCredentialProvider() {
      providerFactories += 1;
      throw new Error("connection status must not create provider");
    },
  });
  const response = await request(running.url, {
    pathname: "/api/connection",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json().connection.connected, false);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(opens, 0);
  assert.equal(providerFactories, 0);
});

test("connect and disconnect require the same-origin mutation contract before session allocation", async (t) => {
  let providerFactories = 0;
  const running = await advisor(t, {
    createViewCredentialProvider() {
      providerFactories += 1;
      throw new Error("hostile request must not create provider");
    },
  });
  for (const pathname of [
    "/api/connection/connect",
    "/api/connection/disconnect",
  ]) {
    const response = await request(running.url, {
      pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
    assert.equal(
      response.json().error.code,
      "SAME_ORIGIN_REQUIRED",
    );
  }
  assert.equal(providerFactories, 0);
});

test("session-only connection drives a real View-only-shaped preflight with redacted DTOs", async (t) => {
  let permissionChecks = 0;
  const adapterCalls = [];
  const running = await advisor(t, {
    createViewCredentialProvider: () =>
      createInMemoryViewCredentialProvider({
        fetchImpl: async () => {
          throw new Error("real Coinbase network is forbidden");
        },
        verifyCredential: async (input) => {
          permissionChecks += 1;
          return verifiedCredential(input);
        },
      }),
    createViewOnlyAdapter: (_credentials, options) => {
      assert.equal(options.signal.aborted, false);
      return fakeViewAdapter(adapterCalls);
    },
  });

  const initial = await request(running.url, {
    pathname: "/api/connection",
  });
  assert.equal(initial.status, 200);
  assert.equal(initial.json().connection.connected, false);
  assert.equal(initial.headers["set-cookie"], undefined);
  const key = credential();

  const connected = await request(running.url, {
    pathname: "/api/connection/connect",
    method: "POST",
    headers: mutationHeaders(running.url),
    body: JSON.stringify(key),
  });
  assert.equal(connected.status, 200);
  const cookie = cookieFrom(connected);
  assert.equal(connected.json().connection.connected, true);
  assert.equal(
    connected.json().connection.permissions.can_trade,
    false,
  );
  assert.equal(
    connected.json().boundary.create_available,
    false,
  );
  assert.doesNotMatch(
    connected.text,
    /BEGIN EC PRIVATE KEY|organizations\/test|apiKeys|fingerprint/i,
  );

  const planned = await request(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: mutationHeaders(running.url, cookie),
    body: JSON.stringify({ intent: INTENT }),
  });
  assert.equal(planned.status, 200);
  const planId = planned.json().plan.plan_id;
  const checked = await request(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers: mutationHeaders(running.url, cookie),
    body: JSON.stringify({
      plan_id: planId,
      mode: "view_only_preflight",
    }),
  });
  assert.equal(checked.status, 200);
  const { result } = checked.json();
  assert.equal(result.mode, "view_only_preflight");
  assert.equal(
    result.decision.outcome,
    "PASS",
    JSON.stringify(result.decision),
  );
  assert.equal(
    result.source,
    "COINBASE_VIEW_ONLY_READS_AND_PREVIEW",
  );
  assert.equal(result.receipt.verified, true);
  assert.equal(
    result.delta.kind,
    "LOCAL_DETERMINISTIC_PREFLIGHT",
  );
  assert.equal(result.delta.production_delta_contacted, false);
  assert.equal(result.boundary.coinbase_contacted, true);
  assert.equal(result.boundary.create_available, false);
  assert.equal(result.boundary.order_submitted, false);
  assert.equal(result.boundary.money_moved, false);
  assert.deepEqual(adapterCalls.sort(), [
    "GET BBO ETH-USDC",
    "GET accounts",
    "GET product ETH-USDC",
    "POST orders/preview",
  ]);
  assert.equal(permissionChecks, 2);
  assert.doesNotMatch(
    checked.text,
    /BEGIN EC PRIVATE KEY|organizations\/test|apiKeys|redacted-before-browser|test-portfolio/i,
  );

  const disconnected = await request(running.url, {
    pathname: "/api/connection/disconnect",
    method: "POST",
    headers: mutationHeaders(running.url, cookie),
    body: "{}",
  });
  assert.equal(disconnected.status, 200);
  assert.equal(disconnected.json().connection.connected, false);
  assert.doesNotMatch(
    disconnected.text,
    /BEGIN EC PRIVATE KEY|organizations\/test|apiKeys/i,
  );
});

test("requesting View-only without a connection returns a verified REVIEW, never simulated PASS", async (t) => {
  const running = await advisor(t);
  const opened = await request(running.url, {
    pathname: "/api/connection",
  });
  assert.equal(opened.headers["set-cookie"], undefined);
  const planned = await request(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: mutationHeaders(running.url),
    body: JSON.stringify({ intent: INTENT }),
  });
  const cookie = cookieFrom(planned);
  const checked = await request(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers: mutationHeaders(running.url, cookie),
    body: JSON.stringify({
      plan_id: planned.json().plan.plan_id,
      mode: "view_only_preflight",
    }),
  });

  assert.equal(checked.status, 200);
  assert.equal(
    checked.json().result.mode,
    "view_only_preflight",
  );
  assert.equal(checked.json().result.decision.outcome, "REVIEW");
  assert.equal(checked.json().result.receipt.verified, true);
  assert.equal(
    checked.json().result.boundary.coinbase_contacted,
    false,
  );
  assert.notEqual(
    checked.json().result.source,
    "SIMULATED_FIXTURE_NOT_COINBASE",
  );
});
