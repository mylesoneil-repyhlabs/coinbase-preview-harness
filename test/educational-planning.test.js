import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDUCATIONAL_PLANNING_API,
  EDUCATIONAL_PROVENANCE,
  createEducationalViewOnlyAuthority,
  createGeneratedEducationalMarketSnapshot,
  createEducationalPortfolioPlan,
  editEducationalPortfolioPlan,
  reviewSingleTradeMandateDraft,
  selectSingleTradeMandateDraft,
} from "../src/advisor/educational-planning.js";
import {
  normalizeCoinbaseMarketData,
} from "../src/market.js";
import * as educationalPlanningModule from "../src/advisor/educational-planning.js";
import * as marketModule from "../src/market.js";

const NOW = "2026-07-31T12:00:00.000Z";
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function products(overrides = {}) {
  return [
    {
      product_id: "BTC-USDC",
      base_asset: "BTC",
      quote_asset: "USDC",
      product_type: "SPOT",
      available: true,
      best_bid: "118500.20",
      best_ask: "118500.30",
      observed_at: "2026-07-31T11:59:30.000Z",
      ...overrides.BTC,
    },
    {
      product_id: "ETH-USDC",
      base_asset: "ETH",
      quote_asset: "USDC",
      product_type: "SPOT",
      available: true,
      best_bid: "3820.05",
      best_ask: "3820.15",
      observed_at: "2026-07-31T11:59:30.000Z",
      ...overrides.ETH,
    },
  ];
}

function snapshotInput(overrides = {}) {
  return {
    snapshot_id: "snapshot-session-1",
    evaluated_at: NOW,
    market_max_age_seconds: 60,
    education_max_age_seconds: 31_536_000,
    requested_product_ids: ["BTC-USDC", "ETH-USDC"],
    products: products(),
    ...overrides,
  };
}

function rawAdapterResult(item) {
  return {
    product: {
      product_id: item.product_id,
      product_type: "SPOT",
      status: "online",
      base_currency_id: item.base_asset,
      quote_currency_id: item.quote_asset,
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
    },
    bestBidAsk: {
      pricebooks: [
        {
          product_id: item.product_id,
          bids: [{ price: item.best_bid }],
          asks: [{ price: item.best_ask }],
          time: item.observed_at,
        },
      ],
    },
  };
}

function directlyNormalizedProducts() {
  return products().map((item) => {
    const raw = rawAdapterResult(item);
    return normalizeCoinbaseMarketData(
      raw.product,
      raw.bestBidAsk,
      item.product_id,
    );
  });
}

function authorityProducts(authority) {
  return products().map((item) => {
    const raw = rawAdapterResult(item);
    return authority.normalizeAdapterResult(
      raw.product,
      raw.bestBidAsk,
      item.product_id,
    );
  });
}

function readySnapshot(overrides = {}) {
  return createGeneratedEducationalMarketSnapshot(
    snapshotInput(overrides),
  );
}

function planInput(overrides = {}) {
  return {
    session_id: "session-education-1",
    plan_id: "portfolio-plan-1",
    created_at: NOW,
    snapshot: readySnapshot(),
    planning_amount: {
      asset: "USDC",
      value: "10000",
    },
    allocations: [
      {
        asset: "BTC",
        product_id: "BTC-USDC",
        weight_bps: 6000,
      },
      {
        asset: "ETH",
        product_id: "ETH-USDC",
        weight_bps: 4000,
      },
    ],
    scenarios: [
      {
        name: "User-supplied broad decline",
        changes: [
          { asset: "BTC", change_bps: -1000 },
          { asset: "ETH", change_bps: -2000 },
        ],
      },
    ],
    scenario_acknowledged: true,
    ...overrides,
  };
}

function readyPlan(overrides = {}) {
  return createEducationalPortfolioPlan(planInput(overrides));
}

function selectBtc(
  plan,
  { side = "BUY", ...overrides } = {},
) {
  return selectSingleTradeMandateDraft(plan, {
    draft_id: "draft-btc-1",
    selected_at: "2026-07-31T12:00:10.000Z",
    selected_legs: [
      {
        asset: "BTC",
        product_id: "BTC-USDC",
        leg_id: `${plan.plan_id}:r${plan.revision}:BTC-USDC`,
        side,
      },
    ],
    ...overrides,
  });
}

test("market snapshot labels every provenance class and is never Guard evidence", () => {
  const snapshot = readySnapshot();
  assert.equal(
    snapshot.status,
    "SNAPSHOT_AVAILABLE_FOR_EDUCATION",
  );
  assert.equal(
    snapshot.decision.outcome,
    "SNAPSHOT_AVAILABLE_FOR_EDUCATION",
  );
  assert.deepEqual(snapshot.provenance_legend, [
    "Generated fixture",
    "Coinbase observed",
    "Locally curated summary of primary source",
    "Calculated locally",
    "User supplied",
  ]);
  assert.equal(
    snapshot.facts.products[0].best_ask.provenance.label,
    EDUCATIONAL_PROVENANCE.GENERATED_FIXTURE,
  );
  assert.equal(
    snapshot.facts.products[0].provenance.label,
    EDUCATIONAL_PROVENANCE.GENERATED_FIXTURE,
  );
  assert.equal(
    snapshot.facts.educational_sources[0].provenance.label,
    EDUCATIONAL_PROVENANCE.LOCALLY_CURATED_PRIMARY_SOURCE,
  );
  assert.match(
    snapshot.facts.educational_sources[0].canonical_url,
    /^https:\/\//,
  );
  assert.match(
    snapshot.facts.educational_sources[0].content_digest,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    typeof snapshot.facts.educational_sources[0].publisher,
    "string",
  );
  assert.equal(
    snapshot.facts.educational_sources[0].retrieved_at,
    undefined,
  );
  assert.equal(
    snapshot.guard_boundary.eligible_as_guard_evidence,
    false,
  );
  assert.equal(
    snapshot.guard_boundary.research_used_as_guard_evidence,
    false,
  );
  assert.deepEqual(snapshot.fallback, {
    used: false,
    fixture_used: true,
    substitution_used: false,
  });
  const authority = createEducationalViewOnlyAuthority();
  const observed = authority.createSnapshot(
    snapshotInput({ products: authorityProducts(authority) }),
  );
  assert.equal(
    observed.facts.products[0].provenance.label,
    EDUCATIONAL_PROVENANCE.COINBASE_OBSERVED,
  );
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(EDUCATIONAL_PLANNING_API.lifecycle, "SESSION_ONLY");
  assert.equal(EDUCATIONAL_PLANNING_API.persistence, "NONE");
});

test("the public module surface exposes structural normalization but no reusable provenance brand", () => {
  assert.equal(
    typeof marketModule.normalizeCoinbaseMarketData,
    "function",
  );
  assert.equal(
    "isNormalizedCoinbaseMarketData" in marketModule,
    false,
  );
  assert.equal(
    "createCoinbaseEducationalMarketSnapshot" in
      educationalPlanningModule,
    false,
  );
});

test("normalization, lookalikes, clones, and another authority cannot mint Coinbase provenance", async (t) => {
  const authority = createEducationalViewOnlyAuthority();
  const trusted = authorityProducts(authority);
  const otherAuthority =
    createEducationalViewOnlyAuthority();
  const cases = [
    {
      name: "normalized-looking raw facts",
      products: products(),
    },
    {
      name: "public normalizer output",
      products: directlyNormalizedProducts(),
    },
    {
      name: "JSON clone of a trusted observation",
      products: JSON.parse(JSON.stringify(trusted)),
    },
    {
      name: "observation from another authority",
      products: trusted,
      snapshotAuthority: otherAuthority,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const snapshotAuthority =
        scenario.snapshotAuthority ?? authority;
      const forged = snapshotAuthority.createSnapshot(
        snapshotInput({ products: scenario.products }),
      );
      assert.equal(forged.status, "REVIEW");
      assert.equal(forged.facts.products.length, 0);
      assert.ok(
        forged.issues.some(
          ({ code }) =>
            code === "COINBASE_OBSERVATION_UNTRUSTED",
        ),
      );
      assert.doesNotMatch(
        JSON.stringify(forged.facts),
        /Coinbase observed/,
      );
    });
  }
});

test("missing, stale, unavailable, and clock-mismatched facts go to REVIEW without fallback", async (t) => {
  const cases = [
    {
      name: "missing market facts",
      overrides: { products: [] },
      code: "MARKET_FACTS_MISSING",
    },
    {
      name: "stale market fact",
      overrides: {
        products: products({
          BTC: { observed_at: "2026-07-31T11:00:00.000Z" },
        }),
      },
      code: "MARKET_FACT_STALE",
    },
    {
      name: "unavailable product",
      overrides: {
        products: products({ ETH: { available: false } }),
      },
      code: "PRODUCT_UNAVAILABLE",
    },
    {
      name: "future market clock",
      overrides: {
        products: products({
          BTC: { observed_at: "2026-07-31T12:01:00.000Z" },
        }),
      },
      code: "MARKET_CLOCK_MISMATCH",
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const snapshot = readySnapshot(scenario.overrides);
      if (scenario.code) {
        assert.equal(snapshot.status, "REVIEW");
        assert.ok(
          snapshot.issues.some(
            (candidate) => candidate.code === scenario.code,
          ),
        );
      } else {
        const plan = readyPlan({ snapshot });
        assert.equal(plan.status, "REVIEW");
        assert.ok(
          plan.issues.some(
            (candidate) =>
              candidate.code === scenario.planCode,
          ),
        );
      }
      assert.equal(snapshot.fallback.used, false);
      assert.equal(snapshot.fallback.fixture_used, true);
      assert.equal(snapshot.fallback.substitution_used, false);
    });
  }
});

test("valid user weights produce neutral local concentration and scenario calculations", () => {
  const plan = readyPlan();
  assert.equal(plan.status, "PLAN_VALID_FOR_EDITING");
  assert.equal(
    plan.decision.outcome,
    "PLAN_VALID_FOR_EDITING",
  );
  assert.equal(plan.revision, 1);
  assert.equal(plan.lifecycle, "SESSION_ONLY");
  assert.equal(plan.persistence, "NONE");
  assert.equal(plan.inputs.scenario_acknowledged, true);
  assert.equal(
    plan.inputs.planning_amount.provenance.label,
    "User supplied",
  );
  assert.deepEqual(
    plan.analysis.allocations.map((allocation) => [
      allocation.asset,
      allocation.target_quote_amount.value,
      allocation.provenance.label,
    ]),
    [
      ["BTC", "6000", "Calculated locally"],
      ["ETH", "4000", "Calculated locally"],
    ],
  );
  assert.equal(
    plan.analysis.concentration.largest_weight_bps,
    6000,
  );
  assert.equal(plan.analysis.concentration.hhi_bps, "5200");
  assert.equal(
    plan.analysis.scenarios[0].calculated.weighted_change_bps,
    "-1400",
  );
  assert.equal(
    plan.analysis.scenarios[0].calculated.weighted_change_percent,
    "-14",
  );
  assert.ok(
    plan.analysis.scenarios[0].assumptions.every(
      (assumption) =>
        assumption.provenance.label === "User supplied",
    ),
  );
  assert.match(
    plan.analysis.scenarios[0].calculated.method,
    /not a forecast/i,
  );
  assert.equal(plan.capability_boundary.asset_ranking, false);
  assert.equal(
    plan.capability_boundary.suitability_assessment,
    false,
  );
  assert.equal(
    plan.capability_boundary.automatic_purchase,
    false,
  );
  assert.equal(plan.guard_boundary.eligible_as_guard_evidence, false);
  assert.match(plan.model_integrity.digest, /^[a-f0-9]{64}$/);
  assert.match(
    plan.model_integrity.proof_limit,
    /not Guard evidence, authorization, or a Delta receipt/i,
  );
  assert.equal(Object.isFrozen(plan), true);
});

test("invalid allocations and scenario assumptions BLOCK instead of being inferred", async (t) => {
  const cases = [
    {
      name: "scenario assumptions are not acknowledged",
      overrides: {
        scenario_acknowledged: false,
      },
      code: "SCENARIO_ACKNOWLEDGEMENT_REQUIRED",
    },
    {
      name: "weights do not total 100 percent",
      overrides: {
        allocations: [
          {
            asset: "BTC",
            product_id: "BTC-USDC",
            weight_bps: 5000,
          },
          {
            asset: "ETH",
            product_id: "ETH-USDC",
            weight_bps: 4000,
          },
        ],
      },
      code: "ALLOCATION_TOTAL_INVALID",
    },
    {
      name: "duplicate asset",
      overrides: {
        allocations: [
          {
            asset: "BTC",
            product_id: "BTC-USDC",
            weight_bps: 5000,
          },
          {
            asset: "BTC",
            product_id: "BTC-USD",
            weight_bps: 5000,
          },
        ],
      },
      code: "ALLOCATION_DUPLICATE",
    },
    {
      name: "scenario omits an asset",
      overrides: {
        scenarios: [
          {
            name: "Incomplete",
            changes: [{ asset: "BTC", change_bps: -1000 }],
          },
        ],
      },
      code: "SCENARIO_INVALID",
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const plan = readyPlan(scenario.overrides);
      assert.equal(plan.status, "BLOCK");
      assert.equal(plan.decision.outcome, "BLOCK");
      assert.ok(
        plan.issues.some(
          (candidate) => candidate.code === scenario.code,
        ),
      );
      assert.equal(plan.handoff, null);
    });
  }
});

test("unacknowledged zero scenarios are never attributed to the user", () => {
  const plan = readyPlan({
    scenario_acknowledged: false,
    scenarios: [
      {
        name: "Untouched neutral baseline",
        changes: [
          { asset: "BTC", change_bps: 0 },
          { asset: "ETH", change_bps: 0 },
        ],
      },
    ],
  });
  assert.equal(plan.status, "BLOCK");
  assert.ok(
    plan.issues.some(
      ({ code }) =>
        code === "SCENARIO_ACKNOWLEDGEMENT_REQUIRED",
    ),
  );
  assert.equal(plan.inputs.scenario_acknowledged, false);
  assert.deepEqual(plan.inputs.scenarios, []);
  assert.deepEqual(plan.analysis.scenarios, []);
});

test("unsupported or expired selected product data goes to REVIEW", async (t) => {
  await t.test("selected pair is absent", () => {
    const plan = readyPlan({
      allocations: [
        {
          asset: "DOGE",
          product_id: "DOGE-USDC",
          weight_bps: 10_000,
        },
      ],
      scenarios: [],
    });
    assert.equal(plan.status, "REVIEW");
    assert.ok(
      plan.issues.some(
        ({ code }) => code === "SELECTED_PRODUCT_UNVERIFIABLE",
      ),
    );
    assert.ok(
      plan.issues.some(
        ({ code }) => code === "SELECTED_EDUCATION_MISSING",
      ),
    );
  });

  await t.test("snapshot expires before plan creation", () => {
    const plan = readyPlan({
      created_at: "2026-07-31T12:00:31.000Z",
    });
    assert.equal(plan.status, "REVIEW");
    assert.ok(
      plan.issues.some(({ code }) => code === "SNAPSHOT_STALE"),
    );
  });
});

test("only one exact user-selected leg can become an editable unauthorized draft", () => {
  const plan = readyPlan();
  const multi = selectSingleTradeMandateDraft(plan, {
    draft_id: "draft-multi",
    selected_at: "2026-07-31T12:00:10.000Z",
    selected_legs: [
      {
        asset: "BTC",
        product_id: "BTC-USDC",
        side: "BUY",
      },
      {
        asset: "ETH",
        product_id: "ETH-USDC",
        side: "BUY",
      },
    ],
  });
  assert.equal(multi.decision.outcome, "BLOCK");
  assert.equal(multi.decision.code, "SINGLE_LEG_REQUIRED");

  const noSide = selectSingleTradeMandateDraft(plan, {
    draft_id: "draft-no-side",
    selected_at: "2026-07-31T12:00:10.000Z",
    selected_legs: [
      {
        asset: "BTC",
        product_id: "BTC-USDC",
        leg_id: `${plan.plan_id}:r${plan.revision}:BTC-USDC`,
      },
    ],
  });
  assert.equal(noSide.decision.outcome, "BLOCK");
  assert.equal(
    noSide.decision.code,
    "HANDOFF_SELECTION_INVALID",
  );

  const handoff = selectBtc(plan);
  assert.equal(
    handoff.decision.outcome,
    "DRAFT_CREATED_NOT_AUTHORIZED",
  );
  assert.equal(handoff.draft.artifact_class, "EDITABLE_UNAUTHORIZED_DRAFT");
  assert.equal(handoff.draft.candidate_action.product_id, "BTC-USDC");
  assert.equal(handoff.draft.candidate_action.side, "BUY");
  assert.equal(handoff.draft.candidate_action.size.value, "6000");
  assert.equal(
    handoff.draft.candidate_action.selection_provenance.label,
    "User supplied",
  );
  assert.equal(
    handoff.draft.candidate_action.size.provenance.label,
    "Calculated locally",
  );
  assert.equal(handoff.draft.authorization.state, "NOT_AUTHORIZED");
  assert.equal(
    handoff.draft.authorization.separate_human_authorization_required,
    true,
  );
  assert.equal(
    handoff.draft.authorization.execution_eligible,
    false,
  );
  assert.equal(
    handoff.draft.planning_context.research_used_as_guard_evidence,
    false,
  );
  assert.equal(handoff.draft.boundary.batch, false);
  assert.equal(handoff.draft.boundary.rebalance, false);
  assert.equal(handoff.draft.boundary.multi_leg, false);
  assert.equal(handoff.draft.boundary.order_submission, false);
  assert.match(
    handoff.draft.required_fresh_guard_evidence.join(" "),
    /Coinbase Preview bound to the exact proposal/,
  );
  assert.match(
    handoff.draft.required_before_authorization.join(" "),
    /Authorize the complete mandate separately/,
  );

  const second = selectSingleTradeMandateDraft(handoff.plan, {
    draft_id: "draft-eth-2",
    selected_at: "2026-07-31T12:00:11.000Z",
    selected_legs: [
      {
        asset: "ETH",
        product_id: "ETH-USDC",
        side: "BUY",
      },
    ],
  });
  assert.equal(second.decision.outcome, "BLOCK");
  assert.equal(second.decision.code, "HANDOFF_ALREADY_CREATED");
});

test("an explicit SELL creates only an editable base-sized draft from the observed planning price", () => {
  const handoff = selectBtc(readyPlan(), {
    side: "SELL",
    draft_id: "draft-btc-sell",
  });
  assert.equal(
    handoff.decision.outcome,
    "DRAFT_CREATED_NOT_AUTHORIZED",
  );
  assert.equal(handoff.draft.candidate_action.side, "SELL");
  assert.equal(
    handoff.draft.candidate_action.size.denomination,
    "BASE",
  );
  assert.equal(
    handoff.draft.candidate_action.size.asset,
    "BTC",
  );
  assert.equal(
    handoff.draft.candidate_action.planning_quote_amount.value,
    "6000",
  );
  assert.equal(
    handoff.draft.candidate_action.educational_price_reference
      .reference,
    "BEST_BID",
  );
  assert.match(
    handoff.draft.candidate_action.size.provenance.method,
    /editable; not a holding or Guard fact/i,
  );
  assert.equal(handoff.draft.authorization.state, "NOT_AUTHORIZED");
});

test("plan edits increment revision, invalidate the old handoff, and calculate a fresh leg", () => {
  const first = selectBtc(readyPlan());
  const edited = editEducationalPortfolioPlan(first.plan, {
    edited_at: "2026-07-31T12:00:20.000Z",
    scenario_acknowledged: true,
    allocations: [
      {
        asset: "BTC",
        product_id: "BTC-USDC",
        weight_bps: 5000,
      },
      {
        asset: "ETH",
        product_id: "ETH-USDC",
        weight_bps: 5000,
      },
    ],
  });
  assert.equal(edited.revision, 2);
  assert.equal(edited.created_at, NOW);
  assert.equal(edited.handoff, null);
  assert.equal(edited.invalidated_handoffs.length, 1);
  assert.equal(
    edited.invalidated_handoffs[0].draft_id,
    first.draft.draft_id,
  );

  const oldReview = reviewSingleTradeMandateDraft(
    edited,
    first.draft,
    { reviewed_at: "2026-07-31T12:00:21.000Z" },
  );
  assert.equal(oldReview.decision.outcome, "REVIEW");
  assert.equal(oldReview.decision.code, "STALE_PLAN_REVISION");

  const fresh = selectBtc(edited, {
    draft_id: "draft-btc-revision-2",
    selected_at: "2026-07-31T12:00:21.000Z",
  });
  assert.equal(
    fresh.decision.outcome,
    "DRAFT_CREATED_NOT_AUTHORIZED",
  );
  assert.equal(fresh.draft.candidate_action.size.value, "5000");
  assert.equal(
    fresh.draft.source_plan_binding.plan_revision,
    2,
  );
});

test("stale data and draft tampering fail closed to REVIEW", () => {
  const plan = readyPlan();
  const tamperedPlan = {
    ...plan,
    analysis: {
      ...plan.analysis,
      allocations: plan.analysis.allocations.map((allocation, index) =>
        index === 0
          ? {
              ...allocation,
              target_quote_amount: {
                ...allocation.target_quote_amount,
                value: "9999",
              },
            }
          : allocation,
      ),
    },
  };
  const invalidPlan = selectBtc(tamperedPlan);
  assert.equal(invalidPlan.decision.outcome, "REVIEW");
  assert.equal(
    invalidPlan.decision.code,
    "PLAN_INTEGRITY_UNVERIFIABLE",
  );

  const stale = selectBtc(plan, {
    selected_at: "2026-07-31T12:00:31.000Z",
  });
  assert.equal(stale.decision.outcome, "REVIEW");
  assert.equal(stale.decision.code, "PLANNING_SNAPSHOT_STALE");
  assert.equal(stale.draft, null);

  const handoff = selectBtc(plan);
  const current = reviewSingleTradeMandateDraft(
    handoff.plan,
    handoff.draft,
    { reviewed_at: "2026-07-31T12:00:20.000Z" },
  );
  assert.equal(
    current.decision.outcome,
    "DRAFT_CURRENT_NOT_AUTHORIZED",
  );
  assert.equal(current.decision.code, "CURRENT_UNAUTHORIZED_DRAFT");

  const tampered = {
    ...handoff.draft,
    candidate_action: {
      ...handoff.draft.candidate_action,
      product_id: "ETH-USDC",
    },
  };
  const review = reviewSingleTradeMandateDraft(
    handoff.plan,
    tampered,
    { reviewed_at: "2026-07-31T12:00:20.000Z" },
  );
  assert.equal(review.decision.outcome, "REVIEW");
  assert.equal(review.decision.code, "DRAFT_OR_DATA_UNVERIFIABLE");
});

test("the core is deterministic and contains no network, credential, persistence, or execution primitive", async () => {
  assert.deepEqual(readySnapshot(), readySnapshot());
  assert.deepEqual(readyPlan(), readyPlan());
  const source = await readFile(
    path.join(ROOT, "src", "advisor", "educational-planning.js"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB)\b/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:privateKey|apiKey|Authorization|Bearer)\b/,
  );
  assert.doesNotMatch(source, /\b(?:Date\.now|Math\.random|randomUUID)\b/);
  assert.doesNotMatch(
    source,
    /function\s+(?:execute|createOrder|submitOrder)\b/,
  );
  assert.doesNotMatch(source, /outcome:\s*["']PASS["']/);
});
