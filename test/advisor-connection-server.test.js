import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import {
  createInMemoryViewCredentialProvider,
} from "../src/advisor/view-only-credential-provider.js";
import { listenAdvisorServer } from "../src/advisor/server.js";
import { advisorGuardResultView } from "../src/advisor/view-model.js";
import { digest, digestBytes } from "../src/evidence.js";
import { createExecutionPlan } from "../src/plan.js";
import { runGuardPreflight } from "../src/preflight.js";
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

function capabilityFrom(response) {
  assert.equal(response.headers["set-cookie"], undefined);
  const session = response.json().session;
  assert.equal(session.storage, "PAGE_MEMORY_ONLY");
  assert.match(session.capability, /^[A-Za-z0-9_-]{43}$/);
  return session.capability;
}

function mutationHeaders(
  baseUrl,
  capability = null,
  mode = null,
) {
  return {
    "Content-Type": "application/json",
    Origin: baseUrl,
    "Sec-Fetch-Site": "same-origin",
    "X-Delta-Advisor": "1",
    ...(capability
      ? { "X-Delta-Advisor-Session": capability }
      : {}),
    ...(mode ? { "X-Delta-Advisor-Mode": mode } : {}),
  };
}

async function openSession(baseUrl) {
  const response = await request(baseUrl, {
    pathname: "/api/session",
    method: "POST",
    headers: mutationHeaders(baseUrl),
    body: "{}",
  });
  assert.equal(response.status, 200);
  return capabilityFrom(response);
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

async function freshViewOnlyRecord() {
  const plan = await createExecutionPlan(INTENT);
  const calls = [];
  const record = (
    await runGuardPreflight({
      plan,
      confirmPolicyDigest: plan.policy_digest,
      viewOnlyRequested: true,
      verifiedViewCredential: verifiedCredential(credential()),
      assertViewCredentialCurrent: async () => {},
      createViewAdapter: () => fakeViewAdapter(calls),
      nonce: "readiness-preview-test-nonce",
      history: { enabled: false },
    })
  ).record;
  assert.equal(record.status, "PREVIEW_PROBE_PASS");
  assert.equal(record.decision, "PASS");
  return record;
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

test("connection status without a page capability allocates no session or provider", async (t) => {
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

  assert.equal(response.status, 401);
  assert.equal(
    response.json().error.code,
    "SESSION_CAPABILITY_REQUIRED",
  );
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

  const capability = await openSession(running.url);
  const initial = await request(running.url, {
    pathname: "/api/connection",
    headers: {
      "X-Delta-Advisor-Session": capability,
    },
  });
  assert.equal(initial.status, 200);
  assert.equal(initial.json().connection.connected, false);
  assert.equal(initial.headers["set-cookie"], undefined);
  const key = credential();

  const connected = await request(running.url, {
    pathname: "/api/connection/connect",
    method: "POST",
    headers: mutationHeaders(running.url, capability),
    body: JSON.stringify(key),
  });
  assert.equal(connected.status, 200);
  assert.equal(connected.headers["set-cookie"], undefined);
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
    headers: mutationHeaders(running.url, capability),
    body: JSON.stringify({ intent: INTENT }),
  });
  assert.equal(planned.status, 200);
  const planId = planned.json().plan.plan_id;
  const checked = await request(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers: mutationHeaders(
      running.url,
      capability,
      "view_only_preflight",
    ),
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
  assert.equal(
    result.live_readiness.schema_version,
    "delta.coinbase.live_readiness_preview.v1",
  );
  assert.equal(
    result.live_readiness.status,
    "LOCKED_EXPLANATION_ONLY",
  );
  assert.equal(result.live_readiness.boundary.orders_off, true);
  assert.equal(
    result.live_readiness.boundary.create_available,
    false,
  );
  assert.equal(result.live_readiness.boundary.authorized, false);
  assert.equal(result.live_readiness.boundary.eligible, false);
  assert.equal(
    result.live_readiness.boundary.ready_to_trade,
    false,
  );
  assert.equal(
    result.live_readiness.boundary.final_confirmation_available,
    false,
  );
  assert.equal(result.live_readiness.boundary.grant_exists, false);
  assert.equal(
    result.live_readiness.future_one_order_scope.grant_exists,
    false,
  );
  assert.deepEqual(
    result.live_readiness.missing_prerequisites.map(
      (item) => item.label,
    ),
    [
      "Authenticated execution principal",
      "Production Delta verifier",
      "Isolated View+Trade credential in an executor",
      "Server-issued final review challenge",
      "Durable atomic one-use grant and journal",
      "Server kill-switch epoch",
      "Exact-byte Create service",
      "Submission reconciliation",
      "Separate first-order approval",
    ],
  );
  assert.deepEqual(adapterCalls.sort(), [
    "GET BBO ETH-USDC",
    "GET accounts",
    "GET product ETH-USDC",
    "POST orders/preview",
  ]);
  assert.equal(permissionChecks, 2);
  assert.doesNotMatch(
    checked.text,
    /BEGIN EC PRIVATE KEY|organizations\/test|apiKeys|redacted-before-browser|test-portfolio|preview-session-only-test/i,
  );
  const responseKeys = [];
  JSON.parse(checked.text, (key, value) => {
    if (key) responseKeys.push(key);
    return value;
  });
  for (const forbiddenKey of [
    "client_order_id",
    "create_payload",
    "create_payload_digest",
    "credential_fingerprint",
    "portfolio_fingerprint",
    "final_review_challenge",
    "execution_confirmation",
    "grant_id",
  ]) {
    assert.equal(
      responseKeys.includes(forbiddenKey),
      false,
      forbiddenKey,
    );
  }

  const disconnected = await request(running.url, {
    pathname: "/api/connection/disconnect",
    method: "POST",
    headers: mutationHeaders(running.url, capability),
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
  const capability = await openSession(running.url);
  const planned = await request(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: mutationHeaders(running.url, capability),
    body: JSON.stringify({ intent: INTENT }),
  });
  const checked = await request(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers: mutationHeaders(
      running.url,
      capability,
      "view_only_preflight",
    ),
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
  assert.equal(checked.json().result.live_readiness, undefined);
});

test("only a fresh, complete, exact View-only PASS emits the locked readiness projection", async () => {
  const record = await freshViewOnlyRecord();
  const { record_digest: recordDigest, ...recordPayload } = record;
  assert.equal(recordDigest, digest(recordPayload));
  assert.equal(record.schema_version, "delta.coinbase.execution_record.v3");
  assert.equal(record.artifact_class, "PROBE");
  assert.equal(record.boundary.dry_run, false);
  assert.equal(
    record.boundary.preview_is_not_execution_or_price_guarantee,
    true,
  );
  assert.equal(
    record.guard_receipt.nonce_digest,
    record.preflight.nonce_digest,
  );
  assert.equal(
    record.guard_receipt.provenance.source,
    "COINBASE_VIEW_ONLY",
  );
  assert.equal(
    record.guard_receipt.provenance.coinbase_contacted,
    true,
  );
  assert.equal(
    record.guard_receipt.provenance.production_delta_contacted,
    false,
  );
  assert.equal(
    record.confirmation.supplied_execution_digest,
    record.confirmation.execution_digest,
  );
  assert.match(record.confirmation.execution_digest, /^[a-f0-9]{64}$/);
  assert.match(record.confirmation.receipt_digest, /^[a-f0-9]{64}$/);
  assert.equal(
    Date.parse(record.confirmation.policy_expires_at) -
      Date.parse(record.confirmation.confirmed_at),
    record.policy.validity.ttl_seconds * 1_000,
  );
  assert.deepEqual(
    {
      attestation_schema:
        record.credential_binding.attestation_schema,
      environment: record.credential_binding.environment,
      request_auth_profile:
        record.credential_binding.request_auth_profile,
      can_view: record.credential_binding.can_view,
      can_trade: record.credential_binding.can_trade,
      can_transfer: record.credential_binding.can_transfer,
      can_receive: record.credential_binding.can_receive,
      can_receive_reported:
        record.credential_binding.can_receive_reported,
    },
    {
      attestation_schema:
        "delta.coinbase.view_permission_attestation.v2",
      environment: "coinbase-read-preview",
      request_auth_profile: "CDP_URIS_V1",
      can_view: true,
      can_trade: false,
      can_transfer: false,
      can_receive: null,
      can_receive_reported: false,
    },
  );
  assert.equal(
    record.sources.accounts.requested_at,
    record.sources.product.requested_at,
  );
  assert.equal(
    record.sources.accounts.requested_at,
    record.sources.best_bid_ask.requested_at,
  );
  assert.equal(
    record.sources.accounts.received_at,
    record.sources.product.received_at,
  );
  assert.equal(
    record.sources.accounts.received_at,
    record.sources.best_bid_ask.received_at,
  );
  assert.equal(record.sources.accounts.age_ms, 0);
  assert.equal(record.sources.product.age_ms, 0);
  assert.equal(record.sources.preview.age_ms, 0);
  assert.equal(
    record.sources.accounts.timestamp_kind,
    "LOCAL_RECEIPT_TIME",
  );
  assert.equal(
    record.sources.product.timestamp_kind,
    "LOCAL_RECEIPT_TIME",
  );
  assert.equal(
    record.sources.best_bid_ask.timestamp_kind,
    "COINBASE_PRICEBOOK_TIME",
  );
  assert.equal(
    record.sources.preview.timestamp_kind,
    "LOCAL_RECEIPT_TIME",
  );
  assert.equal(
    record.sources.preview.received_at,
    record.preview.collected_at,
  );
  const confirmationAt = Date.parse(record.confirmation.confirmed_at);
  const evidenceRequestedAt = Date.parse(
    record.sources.accounts.requested_at,
  );
  const evidenceReceivedAt = Date.parse(
    record.sources.accounts.received_at,
  );
  const bboObservedAt = Date.parse(
    record.sources.best_bid_ask.observed_at,
  );
  const previewRequestedAt = Date.parse(
    record.sources.preview.requested_at,
  );
  const previewReceivedAt = Date.parse(
    record.sources.preview.received_at,
  );
  assert.ok(confirmationAt <= evidenceRequestedAt);
  assert.ok(evidenceRequestedAt <= evidenceReceivedAt);
  assert.ok(evidenceReceivedAt <= previewRequestedAt);
  assert.ok(previewRequestedAt <= previewReceivedAt);
  assert.ok(bboObservedAt <= evidenceReceivedAt + 2_000);
  assert.equal(
    record.sources.best_bid_ask.age_ms,
    Math.max(0, evidenceReceivedAt - bboObservedAt),
  );
  assert.equal(record.preview_check.settlement.kind, "MAX_QUOTE_DEBIT");
  assert.equal(record.preview_check.settlement.value, "3010");
  assert.equal(record.proposal.action.quote_size, "3000");
  assert.equal(record.proposal.action.base_size, undefined);
  assert.equal(record.proposal.action.limit_price, "2910.15");
  assert.equal(record.preview.evidence.base_size, "1.03092784");
  assert.equal(record.preview.evidence.commission_total, "10");
  const current = new Date(
    Date.parse(record.sources.preview.received_at) + 1,
  );
  const view = advisorGuardResultView(record, {
    liveReadinessEnabled: true,
    now: current,
  });
  assert.equal(view.decision.outcome, "PASS");
  assert.equal(view.receipt.verified, true);
  assert.equal(
    view.live_readiness.status,
    "LOCKED_EXPLANATION_ONLY",
  );
  assert.equal(view.live_readiness.boundary.orders_off, true);
  assert.equal(
    view.live_readiness.protected_bindings
      .prospective_create_digest,
    true,
  );
  assert.equal(
    view.live_readiness.protected_bindings
      .prospective_create_payload,
    undefined,
  );
  assert.equal(
    advisorGuardResultView(record, {
      liveReadinessEnabled: false,
      now: current,
    }).live_readiness,
    undefined,
  );

  const expired = advisorGuardResultView(record, {
    liveReadinessEnabled: true,
    now: new Date(record.preflight.expires_at),
  });
  assert.equal(expired.receipt.verified, true);
  assert.equal(expired.live_readiness, undefined);
  assert.equal(
    advisorGuardResultView(record, {
      liveReadinessEnabled: true,
      now: new Date(Date.parse(record.generated_at) - 1),
    }).live_readiness,
    undefined,
  );
  assert.equal(
    advisorGuardResultView(record, {
      liveReadinessEnabled: true,
      now: new Date("invalid"),
    }).live_readiness,
    undefined,
  );
});

test("readiness projection fails closed across every exact binding and execution boundary", async () => {
  const record = await freshViewOnlyRecord();
  const current = new Date(
    Date.parse(record.sources.preview.received_at) + 1,
  );
  const reseal = (value) => {
    const { record_digest: _previous, ...payload } = value;
    value.record_digest = digest(payload);
  };
  const mutations = [
    ["missing record digest", (value) => {
      delete value.record_digest;
    }],
    ["blank record digest", (value) => {
      value.record_digest = "";
    }],
    ["contradictory dry-run boundary", (value) => {
      value.boundary.dry_run = true;
      reseal(value);
    }],
    ["false Preview guarantee boundary", (value) => {
      value.boundary.preview_is_not_execution_or_price_guarantee =
        false;
      reseal(value);
    }],
    ["contradictory BBO receipt time", (value) => {
      value.sources.best_bid_ask.received_at =
        "1970-01-01T00:00:00.000Z";
      reseal(value);
    }],
    ["receipt-unbound settlement", (value) => {
      value.preview_check.settlement.value =
        "organizations/secret/apiKeys/leaked-id";
      value.record_digest = "";
    }],
    ["resealed contradictory settlement", (value) => {
      value.preview_check.settlement.value = "999";
      reseal(value);
    }],
    ["policy", (value) => {
      value.policy.side = "SELL";
    }],
    ["one-check confirmation", (value) => {
      value.confirmation.execution_matched = false;
    }],
    ["resealed supplied execution digest", (value) => {
      value.confirmation.supplied_execution_digest =
        "0".repeat(64);
      reseal(value);
    }],
    ["resealed expired policy window", (value) => {
      value.confirmation.policy_expires_at = new Date(
        Date.parse(value.generated_at) - 1,
      ).toISOString();
      reseal(value);
    }],
    ["resealed confirmation time outside its TTL relation", (value) => {
      value.confirmation.confirmed_at =
        "2000-01-01T00:00:00.000Z";
      reseal(value);
    }],
    ["canonical action", (value) => {
      value.action_descriptor.side = "SELL";
    }],
    ["proposal", (value) => {
      value.proposal.action.limit_price = "2999.99";
    }],
    ["proposal field set", (value) => {
      value.proposal.action.reduce_only = true;
    }],
    ["Preview request", (value) => {
      value.preview.request_digest = "0".repeat(64);
    }],
    ["Preview response", (value) => {
      value.preview.evidence.commission_total = "11";
    }],
    ["evidence", (value) => {
      value.preview.evidence_digest = "0".repeat(64);
    }],
    ["prospective Create digest", (value) => {
      value.execution.create_payload_digest = "0".repeat(64);
    }],
    ["credential scope", (value) => {
      value.credential_binding.credential_fingerprint =
        "0".repeat(64);
    }],
    ["View-only permission scope", (value) => {
      value.credential_binding.can_trade = true;
      reseal(value);
    }],
    ["portfolio scope", (value) => {
      value.funding.portfolio_fingerprint = "0".repeat(64);
    }],
    ["source provenance", (value) => {
      value.sources.preview.provenance = "SIMULATED_FIXTURE";
    }],
    ["account completeness", (value) => {
      value.sources.accounts.complete = false;
    }],
    ["proposal decision", (value) => {
      value.proposal_check.decision = "REVIEW";
    }],
    ["Preview decision", (value) => {
      value.preview_check.decision = "REVIEW";
    }],
    ["nonce", (value) => {
      value.preflight.nonce_digest = "0".repeat(64);
    }],
    ["preflight", (value) => {
      value.preflight.fingerprint = "0".repeat(64);
    }],
    ["receipt", (value) => {
      value.guard_receipt.receipt_digest = "0".repeat(64);
    }],
    ["future timestamp", (value) => {
      value.sources.preview.received_at = new Date(
        current.getTime() + 60_000,
      ).toISOString();
    }],
    ["adapter invocation", (value) => {
      value.execution.adapter_invoked = true;
    }],
    ["order id", (value) => {
      value.execution.order_id = "must-never-exist";
    }],
    ["transmitted body", (value) => {
      value.execution.transmitted_body_digest =
        value.execution.create_payload_digest;
    }],
    ["consumed gate", (value) => {
      value.execution.one_time_gate_consumed = true;
    }],
  ];
  const intentionallyInvalidOuterDigest = new Set([
    "missing record digest",
    "blank record digest",
    "receipt-unbound settlement",
  ]);
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(record);
    mutate(changed);
    if (!intentionallyInvalidOuterDigest.has(name)) reseal(changed);
    const view = advisorGuardResultView(changed, {
      liveReadinessEnabled: true,
      now: current,
    });
    assert.equal(
      view.live_readiness,
      undefined,
      `${name} must omit readiness`,
    );
  }
});
