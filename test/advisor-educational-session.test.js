import test from "node:test";
import assert from "node:assert/strict";
import {
  createGeneratedEducationalMarketSnapshot,
} from "../src/advisor/educational-planning.js";
import {
  EducationalSessionError,
  createEducationalSessionHandoff,
  createEducationalSessionPlan,
  reviseEducationalSessionPlan,
} from "../src/advisor/educational-session.js";
import {
  compileDeterministicIntent,
} from "../src/intent-compiler.js";

const NOW = "2026-07-31T12:00:00.000Z";

function session() {
  return { educationalPlans: new Map() };
}

function snapshot() {
  return createGeneratedEducationalMarketSnapshot({
    snapshot_id: "snapshot-education-session",
    evaluated_at: NOW,
    market_max_age_seconds: 60,
    education_max_age_seconds: 31_536_000,
    requested_product_ids: ["BTC-USDC", "ETH-USDC"],
    products: [
      {
        product_id: "BTC-USDC",
        base_asset: "BTC",
        quote_asset: "USDC",
        product_type: "SPOT",
        available: true,
        best_bid: "118500.20",
        best_ask: "118500.30",
        observed_at: NOW,
      },
      {
        product_id: "ETH-USDC",
        base_asset: "ETH",
        quote_asset: "USDC",
        product_type: "SPOT",
        available: true,
        best_bid: "3820.05",
        best_ask: "3820.15",
        observed_at: NOW,
      },
    ],
  });
}

function inputs() {
  return {
    snapshot: snapshot(),
    planning_amount: { asset: "USDC", value: "10000" },
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
        name: "User-supplied stress scenario",
        changes: [
          { asset: "BTC", change_bps: -1000 },
          { asset: "ETH", change_bps: -2000 },
        ],
      },
    ],
    scenario_acknowledged: true,
  };
}

function createPlan(target = session()) {
  const ids = ["plan-session-owned", "education-local-session"];
  return {
    target,
    saved: createEducationalSessionPlan(
      target,
      inputs(),
      {
        now: () => new Date(NOW),
        idFactory: () => ids.shift(),
      },
    ),
  };
}

test("session creates an opaque redacted editable plan view", () => {
  const { target, saved } = createPlan();
  assert.equal(target.educationalPlans.size, 1);
  assert.equal(saved.session_state, "PLAN_VALID_FOR_EDITING");
  assert.equal(
    saved.plan.decision.outcome,
    "PLAN_VALID_FOR_EDITING",
  );
  assert.equal(saved.boundary.trade_authorized, false);
  assert.equal(saved.boundary.guard_evidence_created, false);
  assert.equal(saved.boundary.order_submitted, false);
  assert.equal(saved.plan.session_id, undefined);
  assert.equal(saved.plan.model_integrity, undefined);
  assert.equal(
    saved.plan.snapshot_binding.snapshot_digest,
    undefined,
  );
  assert.equal(
    saved.plan.market_snapshot.guard_boundary
      .eligible_as_guard_evidence,
    false,
  );
  assert.match(
    saved.plan.analysis.allocations[0].leg_id,
    /^plan-session-owned:r1:BTC-USDC$/,
  );
});

test("one atomic handoff creates an editable draft only and blocks replay", () => {
  const { target, saved } = createPlan();
  const legId =
    saved.plan.analysis.allocations[0].leg_id;
  const handoff = createEducationalSessionHandoff(
    target,
    {
      planId: saved.plan.plan_id,
      revision: saved.plan.revision,
      legId,
      side: "BUY",
    },
    {
      now: () => new Date("2026-07-31T12:00:10.000Z"),
      idFactory: () => "draft-session-owned",
    },
  );
  assert.equal(
    handoff.saved_plan.session_state,
    "DRAFT_CREATED_NOT_AUTHORIZED",
  );
  assert.equal(
    handoff.result.decision.outcome,
    "DRAFT_CREATED_NOT_AUTHORIZED",
  );
  assert.equal(
    handoff.saved_plan.draft.authorization.state,
    "NOT_AUTHORIZED",
  );
  assert.equal(
    handoff.saved_plan.draft.authorization.execution_eligible,
    false,
  );
  assert.equal(
    handoff.saved_plan.draft.draft_digest,
    undefined,
  );
  assert.equal(
    handoff.saved_plan.advisor_prefill_defaults
      .classification,
    "EDITABLE_GUARD_DEFAULTS",
  );
  assert.equal(
    handoff.saved_plan.advisor_prefill_defaults
      .inherited_user_constraints,
    false,
  );
  assert.doesNotMatch(
    handoff.saved_plan.advisor_prefill,
    /isolated Coinbase Advanced portfolio/i,
  );
  const compilation = compileDeterministicIntent(
    handoff.saved_plan.advisor_prefill,
  );
  assert.equal(compilation.status, "READY_FOR_CONFIRMATION");
  assert.equal(compilation.policy.market_condition, null);

  assert.throws(
    () =>
      createEducationalSessionHandoff(target, {
        planId: saved.plan.plan_id,
        revision: saved.plan.revision,
        legId,
        side: "BUY",
      }),
    (error) =>
      error instanceof EducationalSessionError &&
      error.code ===
        "EDUCATIONAL_HANDOFF_ALREADY_CREATED",
  );
});

test("an explicit SELL remains an editable unauthorized draft and compiles only after handoff", () => {
  const { target, saved } = createPlan();
  const handoff = createEducationalSessionHandoff(
    target,
    {
      planId: saved.plan.plan_id,
      revision: saved.plan.revision,
      legId:
        saved.plan.analysis.allocations[0].leg_id,
      side: "SELL",
    },
    {
      now: () =>
        new Date("2026-07-31T12:00:10.000Z"),
      idFactory: () => "draft-session-sell",
    },
  );
  assert.equal(
    handoff.saved_plan.draft.candidate_action.side,
    "SELL",
  );
  assert.equal(
    handoff.saved_plan.draft.candidate_action.size.asset,
    "BTC",
  );
  assert.equal(
    handoff.saved_plan.advisor_prefill_defaults.settlement
      .kind,
    "MIN_NET_PROCEEDS",
  );
  const compilation = compileDeterministicIntent(
    handoff.saved_plan.advisor_prefill,
  );
  assert.equal(compilation.status, "READY_FOR_CONFIRMATION");
  assert.equal(compilation.policy.side, "SELL");
  assert.equal(compilation.policy.size.asset, "BTC");
  assert.equal(
    handoff.saved_plan.boundary.trade_authorized,
    false,
  );
});

test("edit supersedes the old handoff and stale or cross-session replay fails", () => {
  const { target, saved } = createPlan();
  const legId =
    saved.plan.analysis.allocations[0].leg_id;
  createEducationalSessionHandoff(
    target,
    {
      planId: saved.plan.plan_id,
      revision: 1,
      legId,
      side: "BUY",
    },
    {
      now: () => new Date("2026-07-31T12:00:10.000Z"),
      idFactory: () => "draft-before-edit",
    },
  );
  const revised = reviseEducationalSessionPlan(
    target,
    {
      planId: saved.plan.plan_id,
      revision: 1,
      planning_amount: {
        asset: "USDC",
        value: "10000",
      },
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
      scenarios: inputs().scenarios,
      scenario_acknowledged: true,
    },
    {
      now: () =>
        new Date("2026-07-31T12:00:20.000Z"),
    },
  );
  assert.equal(revised.prior.session_state, "SUPERSEDED");
  assert.equal(revised.current.plan.revision, 2);
  assert.equal(revised.current.draft, null);
  assert.equal(
    revised.current.plan.invalidated_handoffs.length,
    1,
  );
  assert.throws(
    () =>
      createEducationalSessionHandoff(target, {
        planId: saved.plan.plan_id,
        revision: 1,
        legId,
        side: "BUY",
      }),
    (error) =>
      error.code === "EDUCATIONAL_PLAN_REVISION_STALE",
  );
  assert.throws(
    () =>
      createEducationalSessionHandoff(session(), {
        planId: saved.plan.plan_id,
        revision: 2,
        legId:
          revised.current.plan.analysis.allocations[0]
            .leg_id,
        side: "BUY",
      }),
    (error) =>
      error.code === "EDUCATIONAL_PLAN_NOT_FOUND",
  );
});

test("the exact snapshot expiry boundary fails closed without a draft", () => {
  const { target, saved } = createPlan();
  const result = createEducationalSessionHandoff(
    target,
    {
      planId: saved.plan.plan_id,
      revision: 1,
      legId:
        saved.plan.analysis.allocations[0].leg_id,
      side: "BUY",
    },
    {
      now: () => new Date("2026-07-31T12:01:00.000Z"),
      idFactory: () => "draft-at-expiry",
    },
  );
  assert.equal(result.result.decision.outcome, "REVIEW");
  assert.equal(
    result.result.decision.code,
    "PLANNING_SNAPSHOT_STALE",
  );
  assert.equal(result.saved_plan.draft, null);
  assert.equal(result.saved_plan.boundary.trade_authorized, false);
});
