import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { listenAdvisorServer } from "../src/advisor/server.js";
import { normalizeCoinbaseMarketData } from "../src/market.js";

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
          if (!connected) throw new Error("connection changed");
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
    cookie = null,
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
  if (cookie) headers.Cookie = cookie;
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

function cookieFrom(response) {
  const values = response.headers["set-cookie"];
  assert.ok(Array.isArray(values) && values.length === 1);
  return values[0].split(";", 1)[0];
}

function planningInput(overrides = {}) {
  return {
    source: "fixture",
    planning_amount_value: "10000",
    quote_asset: "USDC",
    scenario_acknowledged: true,
    allocations: [
      {
        product_id: "BTC-USDC",
        weight_bps: 6000,
        scenario_change_bps: -1000,
      },
      {
        product_id: "ETH-USDC",
        weight_bps: 4000,
        scenario_change_bps: -2000,
      },
    ],
    ...overrides,
  };
}

function product(productId) {
  const [base, quote] = productId.split("-");
  return {
    product_id: productId,
    product_type: "SPOT",
    status: "online",
    base_currency_id: base,
    quote_currency_id: quote,
    base_increment: "0.00000001",
    quote_increment: "0.01",
    price_increment: "0.01",
    base_min_size: "0.00000001",
    base_max_size: "1000000",
    quote_min_size: "1",
    quote_max_size: "1000000000",
    is_disabled: false,
    trading_disabled: false,
    view_only: false,
    cancel_only: false,
    limit_only: true,
    post_only: false,
    auction_mode: false,
  };
}

function bbo(productId) {
  const prices = {
    "BTC-USDC": ["118500.20", "118500.30"],
    "ETH-USDC": ["3820.05", "3820.15"],
  }[productId];
  return {
    pricebooks: [
      {
        product_id: productId,
        bids: [{ price: prices[0] }],
        asks: [{ price: prices[1] }],
        time: "2026-07-31T11:59:30.000Z",
      },
    ],
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
  cookie = null,
) {
  const response = await request(running.url, {
    pathname: "/api/education/plan",
    cookie,
    body: planningInput(overrides),
  });
  assert.equal(response.status, 200);
  return {
    cookie: cookie ?? cookieFrom(response),
    saved: response.json.saved_plan,
  };
}

async function connect(running) {
  const response = await request(running.url, {
    pathname: "/api/connection/connect",
    body: {
      name: "organizations/test/apiKeys/view",
      privateKey: "test-only-private-key",
    },
  });
  assert.equal(response.status, 200);
  return cookieFrom(response);
}

test("fixture educational plan uses no provider and returns a redacted neutral DTO", async (t) => {
  let providers = 0;
  const running = await runningAdvisor(t, {
    createViewCredentialProvider() {
      providers += 1;
      return fakeViewCredentialProvider();
    },
  });
  const { saved } = await createPlan(running);
  assert.equal(providers, 0);
  assert.equal(saved.session_state, "PLAN_VALID_FOR_EDITING");
  assert.equal(saved.boundary.advice_off, true);
  assert.equal(saved.boundary.trade_authorized, false);
  assert.equal(
    saved.plan.market_snapshot.facts.products[0].provenance
      .label,
    "Generated fixture",
  );
  assert.equal(
    saved.plan.market_snapshot.facts.educational_sources[0]
      .provenance.label,
    "Locally curated summary of primary source",
  );
  assert.equal(
    saved.plan.market_snapshot.facts.educational_sources[0]
      .retrieved_at,
    undefined,
  );
  assert.match(
    saved.plan.market_snapshot.facts.educational_sources[0]
      .content_digest,
    /^[a-f0-9]{64}$/,
  );
  const serialized = JSON.stringify(saved);
  assert.doesNotMatch(
    serialized,
    /model_integrity|snapshot_digest|private.?key|account_id/i,
  );
  assert.doesNotMatch(serialized, /"PASS"|receipt|Preview/);
});

test("scenario acknowledgement must be the literal true and rejected revisions do not mutate state", async (t) => {
  const running = await runningAdvisor(t);
  const { scenario_acknowledged: _ack, ...withoutAck } =
    planningInput();
  for (const body of [
    withoutAck,
    planningInput({ scenario_acknowledged: false }),
    planningInput({ scenario_acknowledged: "true" }),
  ]) {
    const rejected = await request(running.url, {
      pathname: "/api/education/plan",
      body,
    });
    assert.equal(rejected.status, 400);
    assert.equal(
      rejected.json.error.code,
      "EDUCATIONAL_INPUT_INVALID",
    );
  }

  const current = await createPlan(running);
  const revisionBase = {
    plan_id: current.saved.plan.plan_id,
    revision: current.saved.plan.revision,
    planning_amount_value: "12000",
    quote_asset: "USDC",
    allocations: planningInput().allocations,
  };
  for (const body of [
    revisionBase,
    { ...revisionBase, scenario_acknowledged: false },
    { ...revisionBase, scenario_acknowledged: "true" },
  ]) {
    const rejected = await request(running.url, {
      pathname: "/api/education/revise",
      cookie: current.cookie,
      body,
    });
    assert.equal(rejected.status, 400);
    assert.equal(
      rejected.json.error.code,
      "EDUCATIONAL_INPUT_INVALID",
    );
  }

  const revised = await request(running.url, {
    pathname: "/api/education/revise",
    cookie: current.cookie,
    body: {
      ...revisionBase,
      scenario_acknowledged: true,
    },
  });
  assert.equal(revised.status, 200);
  assert.equal(revised.json.saved_plan.plan.revision, 2);
  assert.equal(
    revised.json.saved_plan.plan.inputs
      .scenario_acknowledged,
    true,
  );
  assert.ok(
    revised.json.saved_plan.plan.analysis.scenarios.every(
      (scenario) =>
        scenario.assumptions.every(
          (assumption) =>
            assumption.provenance.label === "User supplied",
        ),
    ),
  );
});

test("API rejects forged trusted fields and an education ID cannot authorize", async (t) => {
  const running = await runningAdvisor(t);
  const normalizedMarket = normalizeCoinbaseMarketData(
    product("BTC-USDC"),
    bbo("BTC-USDC"),
    "BTC-USDC",
  );
  for (const forged of [
    { products: [] },
    { products: [normalizedMarket] },
    { provenance: "Coinbase observed" },
    { evaluated_at: CLOCK.toISOString() },
    { snapshot: {} },
    { plan: {} },
    { decision: "PASS" },
    {
      allocations: [
        {
          ...planningInput().allocations[0],
          provenance: "Coinbase observed",
        },
      ],
    },
  ]) {
    const response = await request(running.url, {
      pathname: "/api/education/plan",
      body: { ...planningInput(), ...forged },
    });
    assert.equal(response.status, 400);
    assert.doesNotMatch(
      JSON.stringify(response.json),
      /Coinbase observed/,
    );
  }
  const invalidSource = await request(running.url, {
    pathname: "/api/education/plan",
    body: planningInput({ source: "coinbase_observed" }),
  });
  assert.equal(invalidSource.status, 400);

  const { cookie, saved } = await createPlan(running);
  for (const body of [
    {
      plan_id: saved.plan.plan_id,
      revision: saved.plan.revision,
      leg_id: saved.plan.analysis.allocations[0].leg_id,
    },
    {
      plan_id: saved.plan.plan_id,
      revision: saved.plan.revision,
      leg_id: saved.plan.analysis.allocations[0].leg_id,
      side: "SWAP",
    },
  ]) {
    const invalidSide = await request(running.url, {
      pathname: "/api/education/handoff",
      cookie,
      body,
    });
    assert.equal(invalidSide.status, 400);
  }
  const forgedRevision = await request(running.url, {
    pathname: "/api/education/revise",
    cookie,
    body: {
      plan_id: saved.plan.plan_id,
      revision: saved.plan.revision,
      planning_amount_value: "10000",
      quote_asset: "USDC",
      scenario_acknowledged: true,
      allocations: planningInput().allocations,
      provenance: "Coinbase observed",
    },
  });
  assert.equal(forgedRevision.status, 400);

  const forgedHandoff = await request(running.url, {
    pathname: "/api/education/handoff",
    cookie,
    body: {
      plan_id: saved.plan.plan_id,
      revision: saved.plan.revision,
      leg_id: saved.plan.analysis.allocations[0].leg_id,
      side: "BUY",
      source: "view_only",
    },
  });
  assert.equal(forgedHandoff.status, 400);

  const authorize = await request(running.url, {
    pathname: "/api/advisor/authorize",
    cookie,
    body: {
      plan_id: saved.plan.plan_id,
      mode: "dry_run",
    },
  });
  assert.equal(authorize.status, 404);
  assert.equal(authorize.json.error.code, "PLAN_NOT_FOUND");
});

test("View-only market snapshot uses product and BBO only", async (t) => {
  const calls = [];
  const running = await runningAdvisor(t, {
    createViewCredentialProvider: () =>
      fakeViewCredentialProvider(),
    createViewOnlyAdapter: () => ({
      async getProduct(productId) {
        calls.push(["product", productId]);
        return product(productId);
      },
      async getBestBidAsk(productId) {
        calls.push(["bbo", productId]);
        return bbo(productId);
      },
    }),
  });
  const cookie = await connect(running);
  const { saved } = await createPlan(
    running,
    { source: "view_only" },
    cookie,
  );
  assert.equal(saved.session_state, "PLAN_VALID_FOR_EDITING");
  assert.deepEqual(calls.sort(), [
    ["bbo", "BTC-USDC"],
    ["bbo", "ETH-USDC"],
    ["product", "BTC-USDC"],
    ["product", "ETH-USDC"],
  ]);
  assert.ok(
    saved.plan.market_snapshot.facts.products.every(
      (item) => item.provenance.label === "Coinbase observed",
    ),
  );
  assert.equal(
    saved.plan.market_snapshot.source_selection.fallback_used,
    false,
  );
});

test("View-only outage or partial response becomes REVIEW with no fixture fallback", async (t) => {
  const running = await runningAdvisor(t, {
    createViewCredentialProvider: () =>
      fakeViewCredentialProvider(),
    createViewOnlyAdapter: () => ({
      async getProduct(productId) {
        return product(productId);
      },
      async getBestBidAsk(productId) {
        if (productId === "ETH-USDC") {
          throw new Error("injected partial outage");
        }
        return bbo(productId);
      },
    }),
  });
  const cookie = await connect(running);
  const { saved } = await createPlan(
    running,
    { source: "view_only" },
    cookie,
  );
  assert.equal(saved.session_state, "REVIEW");
  assert.equal(saved.plan.decision.outcome, "REVIEW");
  assert.equal(
    saved.plan.market_snapshot.source_selection.requested,
    "view_only",
  );
  assert.equal(
    saved.plan.market_snapshot.source_selection.fallback_used,
    false,
  );
  assert.equal(
    saved.plan.market_snapshot.facts.products.length,
    0,
  );
  assert.doesNotMatch(
    JSON.stringify(saved.plan.market_snapshot.facts),
    /Generated fixture|Coinbase observed/,
  );
});

test("revising the selected assets refreshes the exact fixture snapshot", async (t) => {
  const running = await runningAdvisor(t);
  const initialAllocations = [
    {
      product_id: "BTC-USDC",
      weight_bps: 10_000,
      scenario_change_bps: 0,
    },
  ];
  const initial = await createPlan(running, {
    allocations: initialAllocations,
  });
  assert.deepEqual(
    initial.saved.plan.market_snapshot.facts.products.map(
      ({ product_id }) => product_id,
    ),
    ["BTC-USDC"],
  );

  const revised = await request(running.url, {
    pathname: "/api/education/revise",
    cookie: initial.cookie,
    body: {
      plan_id: initial.saved.plan.plan_id,
      revision: initial.saved.plan.revision,
      planning_amount_value: "10000",
      quote_asset: "USDC",
      scenario_acknowledged: true,
      allocations: [
        {
          product_id: "BTC-USDC",
          weight_bps: 5000,
          scenario_change_bps: -1000,
        },
        {
          product_id: "ETH-USDC",
          weight_bps: 5000,
          scenario_change_bps: -2000,
        },
      ],
    },
  });
  assert.equal(revised.status, 200);
  assert.equal(
    revised.json.saved_plan.session_state,
    "PLAN_VALID_FOR_EDITING",
  );
  assert.equal(revised.json.saved_plan.plan.revision, 2);
  assert.deepEqual(
    revised.json.saved_plan.plan.market_snapshot.facts.products.map(
      ({ product_id }) => product_id,
    ),
    ["BTC-USDC", "ETH-USDC"],
  );
});

test("a stale fixture revision gets a fresh current snapshot", async (t) => {
  let clock = new Date(CLOCK);
  const running = await runningAdvisor(t, {
    now: () => new Date(clock),
  });
  const initial = await createPlan(running);
  const firstEvaluatedAt =
    initial.saved.plan.market_snapshot.evaluated_at;
  clock = new Date(CLOCK.getTime() + 61_000);

  const revised = await request(running.url, {
    pathname: "/api/education/revise",
    cookie: initial.cookie,
    body: {
      plan_id: initial.saved.plan.plan_id,
      revision: initial.saved.plan.revision,
      planning_amount_value: "11000",
      quote_asset: "USDC",
      scenario_acknowledged: true,
      allocations: planningInput().allocations,
    },
  });
  assert.equal(revised.status, 200);
  assert.equal(
    revised.json.saved_plan.session_state,
    "PLAN_VALID_FOR_EDITING",
  );
  assert.notEqual(
    revised.json.saved_plan.plan.market_snapshot.evaluated_at,
    firstEvaluatedAt,
  );
  assert.equal(
    revised.json.saved_plan.plan.market_snapshot.evaluated_at,
    clock.toISOString(),
  );
});

test("a View-only REVIEW can recover only through a fresh View-only snapshot", async (t) => {
  let failBbo = true;
  let bboCalls = 0;
  const running = await runningAdvisor(t, {
    createViewCredentialProvider: () =>
      fakeViewCredentialProvider(),
    createViewOnlyAdapter: () => ({
      async getProduct(productId) {
        return product(productId);
      },
      async getBestBidAsk(productId) {
        bboCalls += 1;
        if (failBbo) {
          failBbo = false;
          throw new Error("injected first-check outage");
        }
        return bbo(productId);
      },
    }),
  });
  const cookie = await connect(running);
  const allocations = [
    {
      product_id: "BTC-USDC",
      weight_bps: 10_000,
      scenario_change_bps: 0,
    },
  ];
  const initial = await createPlan(
    running,
    {
      source: "view_only",
      allocations,
    },
    cookie,
  );
  assert.equal(initial.saved.session_state, "REVIEW");
  assert.equal(
    initial.saved.plan.market_snapshot.facts.products.length,
    0,
  );

  const revised = await request(running.url, {
    pathname: "/api/education/revise",
    cookie,
    body: {
      plan_id: initial.saved.plan.plan_id,
      revision: initial.saved.plan.revision,
      planning_amount_value: "10000",
      quote_asset: "USDC",
      scenario_acknowledged: true,
      allocations,
    },
  });
  assert.equal(revised.status, 200);
  assert.equal(
    revised.json.saved_plan.session_state,
    "PLAN_VALID_FOR_EDITING",
  );
  assert.equal(bboCalls, 2);
  assert.ok(
    revised.json.saved_plan.plan.market_snapshot.facts.products.every(
      ({ provenance }) =>
        provenance.label === "Coinbase observed",
    ),
  );
  assert.equal(
    revised.json.saved_plan.plan.market_snapshot.source_selection
      .fallback_used,
    false,
  );
});

test("revision, cross-session, and second-handoff attempts fail closed without advisor automation", async (t) => {
  let advisorPlans = 0;
  let preflights = 0;
  const running = await runningAdvisor(t, {
    async createPlan() {
      advisorPlans += 1;
      throw new Error("not expected");
    },
    async runPreflight() {
      preflights += 1;
      throw new Error("not expected");
    },
  });
  const first = await createPlan(running);
  const second = await createPlan(running);
  const crossSession = await request(running.url, {
    pathname: "/api/education/handoff",
    cookie: second.cookie,
    body: {
      plan_id: first.saved.plan.plan_id,
      revision: 1,
      leg_id:
        first.saved.plan.analysis.allocations[0].leg_id,
      side: "BUY",
    },
  });
  assert.equal(crossSession.status, 404);

  const revised = await request(running.url, {
    pathname: "/api/education/revise",
    cookie: first.cookie,
    body: {
      plan_id: first.saved.plan.plan_id,
      revision: 1,
      planning_amount_value: "10000",
      quote_asset: "USDC",
      scenario_acknowledged: true,
      allocations: planningInput().allocations.map(
        (allocation) => ({
          ...allocation,
          weight_bps: 5000,
        }),
      ),
    },
  });
  assert.equal(revised.status, 200);
  const current = revised.json.saved_plan;
  const stale = await request(running.url, {
    pathname: "/api/education/handoff",
    cookie: first.cookie,
    body: {
      plan_id: current.plan.plan_id,
      revision: 1,
      leg_id:
        first.saved.plan.analysis.allocations[0].leg_id,
      side: "BUY",
    },
  });
  assert.equal(stale.status, 409);

  const identity = {
    plan_id: current.plan.plan_id,
    revision: current.plan.revision,
    leg_id: current.plan.analysis.allocations[0].leg_id,
    side: "SELL",
  };
  const handoff = await request(running.url, {
    pathname: "/api/education/handoff",
    cookie: first.cookie,
    body: identity,
  });
  assert.equal(handoff.status, 200);
  assert.equal(
    handoff.json.saved_plan.session_state,
    "DRAFT_CREATED_NOT_AUTHORIZED",
  );
  assert.equal(
    handoff.json.saved_plan.advisor_prefill_defaults
      .classification,
    "EDITABLE_GUARD_DEFAULTS",
  );
  assert.equal(
    handoff.json.saved_plan.draft.authorization.state,
    "NOT_AUTHORIZED",
  );
  assert.equal(
    handoff.json.saved_plan.draft.candidate_action.side,
    "SELL",
  );
  assert.equal(advisorPlans, 0);
  assert.equal(preflights, 0);

  const secondHandoff = await request(running.url, {
    pathname: "/api/education/handoff",
    cookie: first.cookie,
    body: identity,
  });
  assert.equal(secondHandoff.status, 409);
  assert.equal(advisorPlans, 0);
  assert.equal(preflights, 0);
});
