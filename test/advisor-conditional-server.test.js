import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { listenAdvisorServer } from "../src/advisor/server.js";

const CLOCK = new Date("2026-07-31T12:00:00.000Z");
const now = () => new Date(CLOCK);

function fakeViewCredentialProvider() {
  let connected = false;
  let controller = new AbortController();
  const status = () => ({
    schema_version:
      "delta.coinbase.advisor_view_only_connection.v1",
    connected,
    mode: "view_only_preflight",
    permissions: connected
      ? {
          can_view: true,
          can_trade: false,
          can_transfer: false,
        }
      : undefined,
    create_available: false,
    no_order_submitted: true,
  });
  return {
    async connect() {
      connected = true;
      controller = new AbortController();
      return status();
    },
    status,
    disconnect() {
      connected = false;
      controller.abort("DISCONNECTED");
      return status();
    },
    async withVerifiedCredential(operation) {
      if (!connected) throw new Error("not connected");
      return operation({
        credentials: Object.freeze({
          test_scope: "VIEW_ONLY",
        }),
        signal: controller.signal,
        assertCurrent() {
          if (!connected) {
            throw new Error("connection changed");
          }
        },
      });
    },
  };
}

function request(
  baseUrl,
  {
    pathname,
    method = "POST",
    capability = null,
    body = null,
  },
) {
  const target = new URL(pathname, baseUrl);
  const headers = {
    "Content-Type": "application/json",
    Origin: baseUrl,
    "Sec-Fetch-Site": "same-origin",
    "X-Delta-Advisor": "1",
  };
  if (capability) {
    headers["X-Delta-Advisor-Session"] = capability;
  }
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      target,
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
            json: JSON.parse(text),
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(
      body == null ? undefined : JSON.stringify(body),
    );
  });
}

function capabilityFrom(response) {
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(response.json.session.storage, "PAGE_MEMORY_ONLY");
  assert.match(
    response.json.session.capability,
    /^[A-Za-z0-9_-]{43}$/,
  );
  return response.json.session.capability;
}

async function openSession(running) {
  const response = await request(running.url, {
    pathname: "/api/session",
    body: {},
  });
  assert.equal(response.status, 200);
  return capabilityFrom(response);
}

function planInput(overrides = {}) {
  return {
    product_id: "ETH-USDC",
    side: "BUY",
    size_value: "3000",
    threshold_value: "3000",
    max_slippage_bps: 35,
    max_fee_value: "15",
    timezone: "America/New_York",
    expires_at: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

async function runningAdvisor(t, options = {}) {
  const running = await listenAdvisorServer({
    now,
    ...options,
  });
  t.after(() => running.close());
  return running;
}

async function createPlan(
  running,
  overrides = {},
  suppliedCapability = null,
) {
  const capability =
    suppliedCapability ?? (await openSession(running));
  const response = await request(running.url, {
    pathname: "/api/conditional/plan",
    capability,
    body: planInput(overrides),
  });
  assert.equal(response.status, 200);
  return {
    capability,
    saved: response.json.saved_plan,
  };
}

async function authorize(
  running,
  capability,
  saved,
  source = "fixture",
) {
  const response = await request(running.url, {
    pathname: "/api/conditional/authorize",
    capability,
    body: {
      plan_id: saved.plan.plan_id,
      revision: saved.plan.revision,
      source,
      ttl_seconds: 300,
    },
  });
  assert.equal(response.status, 200);
  return response.json.saved_plan;
}

test("conditional fixture lifecycle is one-check, repeatable only with fresh authorization, and locked", async (t) => {
  const running = await runningAdvisor(t);
  const { capability, saved } = await createPlan(running);
  const authorized = await authorize(
    running,
    capability,
    saved,
  );
  const identity = {
    plan_id: saved.plan.plan_id,
    revision: saved.plan.revision,
    authorization_id:
      authorized.authorization.authorization_id,
  };

  const blocked = await request(running.url, {
    pathname: "/api/conditional/simulate",
    capability,
    body: { ...identity, scenario: "block" },
  });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.json.result.state, "BLOCKED");
  assert.equal(blocked.json.result.decision, "BLOCK");
  assert.equal(blocked.json.result.receipt.verified, true);
  assert.equal(
    blocked.json.result.receipt.execution_state,
    "LOCKED",
  );
  assert.equal(
    blocked.json.result.boundary.order_submitted,
    false,
  );

  const replay = await request(running.url, {
    pathname: "/api/conditional/simulate",
    capability,
    body: { ...identity, scenario: "pass" },
  });
  assert.equal(replay.status, 409);
  assert.equal(
    replay.json.error.code,
    "CONDITIONAL_AUTHORIZATION_CONSUMED",
  );
  assert.equal(replay.json.result, undefined);

  const reauthorized = await authorize(
    running,
    capability,
    saved,
  );
  assert.notEqual(
    reauthorized.authorization.authorization_id,
    identity.authorization_id,
  );
  const passed = await request(running.url, {
    pathname: "/api/conditional/simulate",
    capability,
    body: {
      plan_id: saved.plan.plan_id,
      revision: saved.plan.revision,
      authorization_id:
        reauthorized.authorization.authorization_id,
      scenario: "pass",
    },
  });
  assert.equal(passed.status, 200);
  assert.equal(
    passed.json.result.state,
    "WOULD_TRIGGER_SIMULATION",
  );
  assert.equal(passed.json.result.decision, "PASS");
  assert.match(
    passed.json.result.boundary.statement,
    /nothing is watching/i,
  );
});

test("concurrent double-submit yields one result and one safe conflict", async (t) => {
  const running = await runningAdvisor(t);
  const { capability, saved } = await createPlan(running);
  const authorized = await authorize(
    running,
    capability,
    saved,
  );
  const body = {
    plan_id: saved.plan.plan_id,
    revision: saved.plan.revision,
    authorization_id:
      authorized.authorization.authorization_id,
    scenario: "pass",
  };

  const responses = await Promise.all([
    request(running.url, {
      pathname: "/api/conditional/simulate",
      capability,
      body,
    }),
    request(running.url, {
      pathname: "/api/conditional/simulate",
      capability,
      body,
    }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  const accepted = responses.find(
    (response) => response.status === 200,
  );
  const rejected = responses.find(
    (response) => response.status === 409,
  );
  assert.equal(
    accepted.json.result.state,
    "WOULD_TRIGGER_SIMULATION",
  );
  assert.equal(
    rejected.json.error.code,
    "CONDITIONAL_AUTHORIZATION_CONSUMED",
  );
  assert.equal(rejected.json.result, undefined);
});

test("invalid View-only fixture scenario is rejected before one-use consumption", async (t) => {
  const running = await runningAdvisor(t);
  const { capability, saved } = await createPlan(running);
  const authorized = await authorize(
    running,
    capability,
    saved,
    "view_only",
  );
  const identity = {
    plan_id: saved.plan.plan_id,
    revision: saved.plan.revision,
    authorization_id:
      authorized.authorization.authorization_id,
  };

  const malformed = await request(running.url, {
    pathname: "/api/conditional/simulate",
    capability,
    body: { ...identity, scenario: "block" },
  });
  assert.equal(malformed.status, 400);
  assert.equal(
    malformed.json.error.code,
    "CONDITIONAL_VIEW_ONLY_SCENARIO_INVALID",
  );

  const accepted = await request(running.url, {
    pathname: "/api/conditional/simulate",
    capability,
    body: { ...identity, scenario: "pass" },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.result.state, "REVIEW");
  assert.equal(accepted.json.result.decision, "REVIEW");
  assert.equal(
    accepted.json.result.evidence.source,
    "view_only",
  );
  assert.deepEqual(
    Object.keys(accepted.json.result.evidence).sort(),
    ["product_id", "source", "unavailable"],
  );
  assert.equal(
    accepted.json.result.receipt.verified,
    true,
  );
});

test("cancel before CHECKING consumes the grant, is idempotent, and records one cancellation", async (t) => {
  const running = await runningAdvisor(t);
  const { capability, saved } = await createPlan(running);
  const authorized = await authorize(
    running,
    capability,
    saved,
  );
  const body = {
    plan_id: saved.plan.plan_id,
    revision: saved.plan.revision,
    authorization_id:
      authorized.authorization.authorization_id,
  };

  const cancelled = await request(running.url, {
    pathname: "/api/conditional/cancel",
    capability,
    body,
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.cancelled, true);
  assert.equal(
    cancelled.json.already_cancelled,
    false,
  );
  assert.equal(
    cancelled.json.saved_plan.session_state,
    "REVIEW",
  );
  assert.equal(
    cancelled.json.saved_plan.authorization.consumed,
    true,
  );

  const delayedStart = await request(running.url, {
    pathname: "/api/conditional/simulate",
    capability,
    body: { ...body, scenario: "pass" },
  });
  assert.equal(delayedStart.status, 409);
  assert.equal(
    delayedStart.json.error.code,
    "CONDITIONAL_AUTHORIZATION_CONSUMED",
  );

  const repeated = await request(running.url, {
    pathname: "/api/conditional/cancel",
    capability,
    body,
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.cancelled, true);
  assert.equal(
    repeated.json.already_cancelled,
    true,
  );

  const activity = await request(running.url, {
    pathname: "/api/activity",
    method: "GET",
    capability,
  });
  assert.equal(activity.status, 200);
  assert.equal(
    activity.json.session_activity.filter(
      (entry) =>
        entry.kind ===
        "CONDITIONAL_SIMULATION_CANCELLED",
    ).length,
    1,
  );
});

test("server cancellation aborts a delayed View-only provider and discards its late result", async (t) => {
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const running = await runningAdvisor(t, {
    createViewCredentialProvider:
      fakeViewCredentialProvider,
    createViewOnlyAdapter: (_credentials, options) => {
      const waitForCancellation = () =>
        new Promise((resolve, reject) => {
          startedResolve();
          if (options.signal.aborted) {
            reject(
              Object.assign(new Error("cancelled"), {
                name: "AbortError",
              }),
            );
            return;
          }
          options.signal.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error("cancelled"), {
                  name: "AbortError",
                }),
              ),
            { once: true },
          );
        });
      return {
        async getProduct() {
          await waitForCancellation();
          return null;
        },
        async getBestBidAsk() {
          await waitForCancellation();
          return null;
        },
      };
    },
  });
  const { capability, saved } = await createPlan(running);
  const connected = await request(running.url, {
    pathname: "/api/connection/connect",
    capability,
    body: {
      name: "test-view-only",
      privateKey: "test-only-injected-provider",
    },
  });
  assert.equal(connected.status, 200);
  const authorized = await authorize(
    running,
    capability,
    saved,
    "view_only",
  );
  const body = {
    plan_id: saved.plan.plan_id,
    revision: saved.plan.revision,
    authorization_id:
      authorized.authorization.authorization_id,
  };
  const pending = request(running.url, {
    pathname: "/api/conditional/simulate",
    capability,
    body: { ...body, scenario: "pass" },
  });
  await started;

  const cancelled = await request(running.url, {
    pathname: "/api/conditional/cancel",
    capability,
    body,
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.cancelled, true);
  assert.equal(
    cancelled.json.saved_plan.cancellation
      .late_result_disposition,
    "DISCARD",
  );

  const late = await pending;
  assert.equal(late.status, 409);
  assert.equal(
    late.json.error.code,
    "CONDITIONAL_ATTEMPT_CONFLICT",
  );
  assert.equal(late.json.result, undefined);
});

test("completed result wins the cancel race and is returned for truthful UI recovery", async (t) => {
  const running = await runningAdvisor(t);
  const { capability, saved } = await createPlan(running);
  const authorized = await authorize(
    running,
    capability,
    saved,
  );
  const body = {
    plan_id: saved.plan.plan_id,
    revision: saved.plan.revision,
    authorization_id:
      authorized.authorization.authorization_id,
  };
  const completed = await request(running.url, {
    pathname: "/api/conditional/simulate",
    capability,
    body: { ...body, scenario: "pass" },
  });
  assert.equal(completed.status, 200);

  const cancellation = await request(running.url, {
    pathname: "/api/conditional/cancel",
    capability,
    body,
  });
  assert.equal(cancellation.status, 200);
  assert.equal(cancellation.json.cancelled, false);
  assert.equal(
    cancellation.json.saved_plan.result.receipt
      .receipt_digest,
    completed.json.result.receipt.receipt_digest,
  );
  assert.equal(
    cancellation.json.saved_plan.session_state,
    "WOULD_TRIGGER_SIMULATION",
  );
});

test("conditional routes require an explicit page-memory capability and never allocate implicitly", async (t) => {
  const running = await runningAdvisor(t);
  for (const pathname of [
    "/api/conditional/plan",
    "/api/conditional/revise",
    "/api/conditional/authorize",
    "/api/conditional/cancel",
    "/api/conditional/simulate",
    "/api/conditional/revoke",
  ]) {
    const response = await request(running.url, {
      pathname,
      body: {},
    });
    assert.equal(response.status, 401);
    assert.equal(
      response.json.error.code,
      "SESSION_CAPABILITY_REQUIRED",
    );
    assert.equal(response.headers["set-cookie"], undefined);
  }
});

test("advisor conditional routes do not expose Create, execute, proxy, or monitoring", async () => {
  const [server, conditional, web] = await Promise.all([
    readFile(
      new URL("../src/advisor/server.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/advisor/conditional-plan.js",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../web/app.js", import.meta.url),
      "utf8",
    ),
  ]);
  const routeNames = [
    ...server.matchAll(/["'](\/api\/[^"']+)["']/g),
  ].map((match) => match[1]);
  assert.equal(
    routeNames.some((route) =>
      /create|execute|submit|orders|proxy/i.test(route),
    ),
    false,
  );
  assert.doesNotMatch(
    `${server}\n${conditional}\n${web}`,
    /\bsetInterval\s*\(|\bWebSocket\b|EventSource|background monitor/i,
  );
});
