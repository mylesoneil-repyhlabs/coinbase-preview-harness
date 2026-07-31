import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeConditionalSimulation,
  conditionalFixtureEvidence,
  createConditionalPlan,
  reviseConditionalPlan,
  revokeConditionalPlan,
  simulateConditionalPlan,
  verifyConditionalSimulationReceipt,
} from "../src/advisor/conditional-plan.js";
import { digest } from "../src/evidence.js";

const CLOCK = new Date("2026-07-31T12:00:00.000Z");
const now = () => new Date(CLOCK);

function input(overrides = {}) {
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

function ready(options = {}) {
  const plan = createConditionalPlan(input(options.plan), {
    now,
    planId: "plan-1",
  });
  const authorization = authorizeConditionalSimulation(plan, {
    source: options.source ?? "fixture",
    ttlSeconds: options.ttlSeconds ?? 300,
    now,
    authorizationId: "auth-1",
  });
  return { plan, authorization };
}

function resealProposal(proposal, patch) {
  const next = { ...proposal, ...patch };
  next.proposal_digest = digest({
    schema_version: next.schema_version,
    product_id: next.product_id,
    side: next.side,
    order_type: next.order_type,
    size: next.size,
    condition_reference: next.condition_reference,
    slippage_reference_price:
      next.slippage_reference_price,
    observed_slippage_bound:
      next.observed_slippage_bound,
    authorized_limit_price:
      next.authorized_limit_price,
    limit_price: next.limit_price,
    max_slippage_bps: next.max_slippage_bps,
    estimated_fee: next.estimated_fee,
    simulated_only: next.simulated_only,
    create_available: next.create_available,
  });
  return next;
}

function resealReceipt(receipt, patch) {
  const next = { ...receipt, ...patch };
  next.receipt_digest = digest({
    schema_version: next.schema_version,
    receipt_id: next.receipt_id,
    plan_id: next.plan_id,
    plan_revision: next.plan_revision,
    plan_digest: next.plan_digest,
    authorization_digest: next.authorization_digest,
    evidence_digest: next.evidence_digest,
    proposal_digest: next.proposal_digest,
    decision: next.decision,
    code: next.code,
    evaluated_at: next.evaluated_at,
    source: next.source,
    execution_state: next.execution_state,
    proof_class: next.proof_class,
  });
  return next;
}

test("creates a non-executable one-shot BUY template with side-correct trigger", () => {
  const plan = createConditionalPlan(input(), {
    now,
    planId: "plan-1",
  });

  assert.equal(plan.state, "READY_FOR_SIM_AUTH");
  assert.equal(plan.revision, 1);
  assert.equal(plan.template.condition.reference, "BEST_ASK");
  assert.equal(plan.template.condition.operator, "LTE");
  assert.equal(plan.template.size.asset, "USDC");
  assert.equal(plan.template.one_shot, true);
  assert.equal(plan.boundary.executable, false);
  assert.equal(plan.boundary.monitoring, false);
  assert.equal(plan.boundary.background_work, false);
  assert.equal(plan.boundary.create_available, false);
  assert.match(plan.boundary.statement, /nothing is watching/i);
});

test("creates a side-correct SELL template funded in the base asset", () => {
  const plan = createConditionalPlan(
    input({
      product_id: "SOL-USD",
      side: "SELL",
      size_value: "2.5",
      threshold_value: "200",
      max_fee_value: "4",
    }),
    { now, planId: "plan-2" },
  );

  assert.equal(plan.template.condition.reference, "BEST_BID");
  assert.equal(plan.template.condition.operator, "GTE");
  assert.equal(plan.template.size.asset, "SOL");
  assert.equal(plan.template.condition.asset, "USD");
});

test("rejects unsupported pairs, sides, amounts, and expired templates", () => {
  assert.throws(
    () => createConditionalPlan(input({ product_id: "eth-usdc" }), { now }),
    /product_id/,
  );
  assert.throws(
    () => createConditionalPlan(input({ side: "SWAP" }), { now }),
    /BUY or SELL/,
  );
  assert.throws(
    () => createConditionalPlan(input({ size_value: "-1" }), { now }),
    /positive decimal/,
  );
  assert.throws(
    () =>
      createConditionalPlan(
        input({ timezone: "Mars/Olympus_Mons" }),
        { now },
      ),
    /valid IANA timezone/,
  );
  assert.throws(
    () =>
      createConditionalPlan(
        input({ expires_at: "2026-07-31T11:59:59.000Z" }),
        { now },
      ),
    /future/,
  );
});

test("simulation authorization is fresh, one-use scoped, and 30–600 seconds", () => {
  const plan = createConditionalPlan(input(), {
    now,
    planId: "plan-1",
  });
  assert.throws(
    () =>
      authorizeConditionalSimulation(plan, {
        source: "fixture",
        ttlSeconds: 29,
        now,
      }),
    /30 through 600/,
  );
  assert.throws(
    () =>
      authorizeConditionalSimulation(plan, {
        source: "live",
        ttlSeconds: 60,
        now,
      }),
    /fixture or view_only/,
  );

  const authorization = authorizeConditionalSimulation(plan, {
    source: "view_only",
    ttlSeconds: 600,
    now,
    authorizationId: "auth-1",
  });
  assert.equal(authorization.max_uses, 1);
  assert.equal(
    authorization.mode,
    "ONE_CHECK_SIMULATION_ONLY",
  );
  assert.equal(
    authorization.boundary.future_live_authorization,
    false,
  );
  assert.equal(
    authorization.boundary.consumption_enforcement,
    "SERVER_SESSION_ATOMIC_BEFORE_EVIDENCE",
  );
  assert.throws(
    () =>
      authorizeConditionalSimulation(
        createConditionalPlan(
          input({
            expires_at: "2026-07-31T12:00:29.999Z",
          }),
          { now, planId: "too-short" },
        ),
        {
          source: "fixture",
          ttlSeconds: 30,
          now,
        },
      ),
    /at least 30 seconds/,
  );
});

test("one fixture observation can stop at CONDITION_NOT_MET without proposal", () => {
  const { plan, authorization } = ready();
  const result = simulateConditionalPlan({
    plan,
    authorization,
    evidence: conditionalFixtureEvidence(plan, "not_met", {
      now,
    }),
    scenario: "not_met",
    now,
  });

  assert.equal(result.state, "CONDITION_NOT_MET");
  assert.equal(result.proposal, null);
  assert.equal(result.receipt.verified, true);
  assert.match(result.recovery, /Nothing is watching/);
  assert.equal(result.timeline.at(-1).detail, "LOCKED · no order submitted");
});

test("a condition-met over-allocation is BLOCKED with a bound receipt", () => {
  const { plan, authorization } = ready();
  const result = simulateConditionalPlan({
    plan,
    authorization,
    evidence: conditionalFixtureEvidence(plan, "block", {
      now,
    }),
    scenario: "block",
    now,
  });

  assert.equal(result.state, "BLOCKED");
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.code, "PROPOSAL_SIZE_EXCEEDS_PLAN");
  assert.equal(result.proposal.size.value, "3001");
  assert.equal(result.receipt.verified, true);
  assert.equal(result.boundary.order_submitted, false);
});

test("a condition-met exact proposal reaches WOULD_TRIGGER_SIMULATION only", () => {
  const { plan, authorization } = ready();
  const result = simulateConditionalPlan({
    plan,
    authorization,
    evidence: conditionalFixtureEvidence(plan, "pass", {
      now,
    }),
    scenario: "pass",
    now,
  });

  assert.equal(result.state, "WOULD_TRIGGER_SIMULATION");
  assert.equal(result.decision, "PASS");
  assert.equal(result.receipt.verified, true);
  assert.equal(result.receipt.execution_state, "LOCKED");
  assert.match(result.receipt.proof_class, /NOT_PRODUCTION_DELTA/);
  assert.equal(
    result.proposal.slippage_reference_price,
    "3000",
  );
  assert.equal(
    result.proposal.observed_slippage_bound,
    "3010.5",
  );
  assert.equal(
    result.proposal.authorized_limit_price,
    "3000",
  );
  assert.equal(result.proposal.limit_price, "3000");
  assert.equal(result.proposal.max_slippage_bps, 35);
  assert.deepEqual(result.proposal.estimated_fee, {
    asset: "USDC",
    value: "15",
  });
  assert.equal(result.proposal.create_available, false);
  assert.equal(result.boundary.create_available, false);
  assert.equal(result.boundary.autonomous_execution, false);
  assert.equal(
    result.receipt.proposal_digest,
    result.proposal.proposal_digest,
  );
  assert.match(
    result.timeline.find(
      ({ step }) =>
        step === "OBSERVED_SLIPPAGE_BOUND",
    ).detail,
    /3000 → raw 3010\.5 → effective 3000/,
  );
});

test("an extreme trigger gap cannot turn the absolute trigger into an unsafe price limit", () => {
  const { plan, authorization } = ready();
  const evidence = {
    source: "fixture",
    product_id: "ETH-USDC",
    best_bid: "999",
    best_ask: "1000",
    observed_at: CLOCK.toISOString(),
  };
  const unsafeAttempt = simulateConditionalPlan({
    plan,
    authorization,
    evidence,
    scenario: "block",
    now,
  });

  assert.equal(unsafeAttempt.state, "BLOCKED");
  assert.equal(unsafeAttempt.decision, "BLOCK");
  assert.equal(
    unsafeAttempt.code,
    "PROPOSAL_PRICE_OUTSIDE_EFFECTIVE_LIMIT",
  );
  assert.equal(
    unsafeAttempt.proposal.slippage_reference_price,
    "1000",
  );
  assert.equal(
    unsafeAttempt.proposal.observed_slippage_bound,
    "1003.5",
  );
  assert.equal(
    unsafeAttempt.proposal.authorized_limit_price,
    "1003.5",
  );
  assert.equal(
    unsafeAttempt.proposal.limit_price,
    "3000",
  );
  assert.ok(
    unsafeAttempt.violations.includes(
      "PRICE_OUTSIDE_EFFECTIVE_AUTHORIZED_LIMIT",
    ),
  );
  assert.equal(unsafeAttempt.receipt.verified, true);

  const safeAttempt = simulateConditionalPlan({
    plan,
    authorization,
    evidence,
    scenario: "pass",
    now,
  });
  assert.equal(
    safeAttempt.state,
    "WOULD_TRIGGER_SIMULATION",
  );
  assert.equal(
    safeAttempt.proposal.limit_price,
    "1003.5",
  );
  assert.equal(safeAttempt.receipt.verified, true);
});

test("SELL limit floor is derived inversely from the observed best bid", () => {
  const { plan, authorization } = ready({
    plan: {
      product_id: "SOL-USDC",
      side: "SELL",
      size_value: "10",
      threshold_value: "100",
      max_fee_value: "10",
    },
  });
  const evidence = {
    source: "fixture",
    product_id: "SOL-USDC",
    best_bid: "1000",
    best_ask: "1001",
    observed_at: CLOCK.toISOString(),
  };
  const safeAttempt = simulateConditionalPlan({
    plan,
    authorization,
    evidence,
    scenario: "pass",
    now,
  });
  assert.equal(
    safeAttempt.proposal.slippage_reference_price,
    "1000",
  );
  assert.equal(
    safeAttempt.proposal.observed_slippage_bound,
    "996.5",
  );
  assert.equal(
    safeAttempt.proposal.authorized_limit_price,
    "996.5",
  );
  assert.equal(safeAttempt.proposal.limit_price, "996.5");
  assert.equal(
    safeAttempt.state,
    "WOULD_TRIGGER_SIMULATION",
  );

  const unsafeAttempt = simulateConditionalPlan({
    plan,
    authorization,
    evidence,
    scenario: "block",
    now,
  });
  assert.equal(unsafeAttempt.state, "BLOCKED");
  assert.equal(
    unsafeAttempt.code,
    "PROPOSAL_PRICE_OUTSIDE_EFFECTIVE_LIMIT",
  );
  assert.equal(unsafeAttempt.proposal.limit_price, "100");
  assert.equal(unsafeAttempt.receipt.verified, true);
});

test("the absolute trigger remains independent when it is the tighter BUY or SELL price constraint", () => {
  const buy = ready();
  const buyResult = simulateConditionalPlan({
    ...buy,
    evidence: {
      source: "fixture",
      product_id: "ETH-USDC",
      best_bid: "2999",
      best_ask: "3000",
      observed_at: CLOCK.toISOString(),
    },
    scenario: "pass",
    now,
  });
  assert.equal(
    buyResult.proposal.observed_slippage_bound,
    "3010.5",
  );
  assert.equal(
    buyResult.proposal.authorized_limit_price,
    "3000",
  );
  assert.equal(buyResult.proposal.limit_price, "3000");

  const sell = ready({
    plan: {
      product_id: "SOL-USDC",
      side: "SELL",
      size_value: "10",
      threshold_value: "1000",
      max_fee_value: "10",
    },
  });
  const sellResult = simulateConditionalPlan({
    ...sell,
    evidence: {
      source: "fixture",
      product_id: "SOL-USDC",
      best_bid: "1000",
      best_ask: "1001",
      observed_at: CLOCK.toISOString(),
    },
    scenario: "pass",
    now,
  });
  assert.equal(
    sellResult.proposal.observed_slippage_bound,
    "996.5",
  );
  assert.equal(
    sellResult.proposal.authorized_limit_price,
    "1000",
  );
  assert.equal(sellResult.proposal.limit_price, "1000");
});

test("SELL at 10000 bps retains the positive raw floor and never drops below the absolute condition", () => {
  const { plan, authorization } = ready({
    plan: {
      product_id: "SOL-USDC",
      side: "SELL",
      size_value: "10",
      threshold_value: "100",
      max_slippage_bps: 10_000,
      max_fee_value: "10",
    },
  });
  const result = simulateConditionalPlan({
    plan,
    authorization,
    evidence: {
      source: "fixture",
      product_id: "SOL-USDC",
      best_bid: "1000",
      best_ask: "1001",
      observed_at: CLOCK.toISOString(),
    },
    scenario: "pass",
    now,
  });

  assert.equal(
    result.proposal.observed_slippage_bound,
    "0.000000000000000001",
  );
  assert.equal(
    result.proposal.authorized_limit_price,
    "100",
  );
  assert.equal(result.proposal.limit_price, "100");
  assert.equal(result.state, "WOULD_TRIGGER_SIMULATION");
  assert.equal(result.receipt.verified, true);
});

test("18-decimal BBO evidence produces a conservative exact bound instead of a precision failure", () => {
  const { plan, authorization } = ready({
    plan: {
      size_value: "1",
      threshold_value: "1",
      max_fee_value: "0.01",
    },
  });
  const result = simulateConditionalPlan({
    plan,
    authorization,
    evidence: {
      source: "fixture",
      product_id: "ETH-USDC",
      best_bid: "0.123456789012345677",
      best_ask: "0.123456789012345678",
      observed_at: CLOCK.toISOString(),
    },
    scenario: "pass",
    now,
  });

  assert.equal(result.state, "WOULD_TRIGGER_SIMULATION");
  assert.equal(result.receipt.verified, true);
  assert.match(
    result.proposal.observed_slippage_bound,
    /^\d+\.\d{18}$/,
  );
  assert.equal(
    result.proposal.authorized_limit_price,
    result.proposal.observed_slippage_bound,
  );
});

test("fixture BBO arithmetic is decimal-exact without floating point", () => {
  const plan = createConditionalPlan(
    input({
      threshold_value: "0.005",
      max_fee_value: "0.001",
    }),
    { now, planId: "small-price" },
  );
  const met = conditionalFixtureEvidence(plan, "pass", {
    now,
  });
  const notMet = conditionalFixtureEvidence(plan, "not_met", {
    now,
  });

  assert.equal(met.best_ask, "0.005");
  assert.equal(met.best_bid, "0.004999999999999999");
  assert.equal(notMet.best_bid, "0.005");
  assert.equal(notMet.best_ask, "0.015");
});

test("BUY and SELL conditions use ask<= and bid>= respectively", () => {
  const buy = ready();
  assert.equal(
    simulateConditionalPlan({
      ...buy,
      evidence: {
        source: "fixture",
        product_id: "ETH-USDC",
        best_bid: "2999.99",
        best_ask: "3000",
        observed_at: CLOCK.toISOString(),
      },
      now,
    }).state,
    "WOULD_TRIGGER_SIMULATION",
  );

  const sell = ready({
    plan: {
      product_id: "BTC-USDC",
      side: "SELL",
      size_value: "0.1",
      threshold_value: "100000",
      max_fee_value: "10",
    },
  });
  assert.equal(
    simulateConditionalPlan({
      ...sell,
      evidence: {
        source: "fixture",
        product_id: "BTC-USDC",
        best_bid: "99999.99",
        best_ask: "100000",
        observed_at: CLOCK.toISOString(),
      },
      scenario: "not_met",
      now,
    }).state,
    "CONDITION_NOT_MET",
  );
});

test("source mismatch, stale evidence, and crossed BBO fail closed to REVIEW", () => {
  const { plan, authorization } = ready();
  for (const evidence of [
    {
      source: "view_only",
      product_id: "ETH-USDC",
      best_bid: "2999",
      best_ask: "3000",
      observed_at: CLOCK.toISOString(),
    },
    {
      source: "fixture",
      product_id: "ETH-USDC",
      best_bid: "2999",
      best_ask: "3000",
      observed_at: "2026-07-31T11:59:40.000Z",
    },
    {
      source: "fixture",
      product_id: "ETH-USDC",
      best_bid: "3000",
      best_ask: "3000",
      observed_at: CLOCK.toISOString(),
    },
  ]) {
    const result = simulateConditionalPlan({
      plan,
      authorization,
      evidence,
      now,
    });
    assert.equal(result.state, "REVIEW");
    assert.equal(result.receipt.verified, true);
    assert.equal(result.proposal, null);
  }
});

test("View-only authorization never accepts fixture evidence as fallback", () => {
  const { plan, authorization } = ready({
    source: "view_only",
  });
  const result = simulateConditionalPlan({
    plan,
    authorization,
    evidence: conditionalFixtureEvidence(plan, "pass", {
      now,
    }),
    now,
  });

  assert.equal(result.state, "REVIEW");
  assert.equal(result.evidence.unavailable, true);
});

test("edits create a new revision and supersede prior authorization", () => {
  const { plan, authorization } = ready();
  const { superseded, revision } = reviseConditionalPlan(
    plan,
    { threshold_value: "2900" },
    {
      now: () => new Date("2026-07-31T12:01:00.000Z"),
    },
  );

  assert.equal(superseded.state, "SUPERSEDED");
  assert.equal(revision.revision, 2);
  assert.equal(revision.template.condition.value, "2900");
  assert.equal(revision.supersedes_digest, plan.plan_digest);
  assert.throws(
    () =>
      simulateConditionalPlan({
        plan,
        authorization,
        evidence: conditionalFixtureEvidence(plan, "pass", {
          now,
        }),
        currentRevision: revision.revision,
        now,
      }),
    /SUPERSEDED/,
  );
});

test("revocation has terminal precedence and invalidates simulation", () => {
  const { plan, authorization } = ready();
  const revoked = revokeConditionalPlan(plan, { now });
  assert.equal(revoked.state, "REVOKED");
  assert.throws(
    () =>
      simulateConditionalPlan({
        plan: revoked,
        authorization,
        evidence: conditionalFixtureEvidence(plan, "pass", {
          now,
        }),
        now,
      }),
    /REVOKED/,
  );
});

test("terminal precedence is REVOKED then EXPIRED then SUPERSEDED", () => {
  const expiring = createConditionalPlan(
    input({
      expires_at: "2026-07-31T12:01:00.000Z",
    }),
    { now, planId: "terminal-plan" },
  );
  const authorization = authorizeConditionalSimulation(
    expiring,
    {
      source: "fixture",
      ttlSeconds: 60,
      now,
      authorizationId: "terminal-auth",
    },
  );
  const { superseded, revision } = reviseConditionalPlan(
    expiring,
    { threshold_value: "2900" },
    {
      now: () =>
        new Date("2026-07-31T12:00:01.000Z"),
    },
  );
  const afterExpiry = () =>
    new Date("2026-07-31T12:01:00.000Z");

  assert.throws(
    () =>
      simulateConditionalPlan({
        plan: superseded,
        authorization,
        evidence: null,
        currentRevision: revision.revision,
        now: afterExpiry,
      }),
    /EXPIRED/,
  );

  const revoked = revokeConditionalPlan(expiring, {
    now: afterExpiry,
  });
  assert.throws(
    () =>
      simulateConditionalPlan({
        plan: revoked,
        authorization,
        evidence: null,
        currentRevision: revision.revision,
        now: afterExpiry,
      }),
    /REVOKED/,
  );
});

test("expired authorization and plan fail before evidence evaluation", () => {
  const { plan, authorization } = ready({
    ttlSeconds: 30,
  });
  const late = () =>
    new Date("2026-07-31T12:00:31.000Z");
  assert.throws(
    () =>
      simulateConditionalPlan({
        plan,
        authorization,
        evidence: conditionalFixtureEvidence(plan, "pass", {
          now: late,
        }),
        now: late,
      }),
    /authorization expired/,
  );

  const shortPlan = createConditionalPlan(
    input({ expires_at: "2026-07-31T12:00:10.000Z" }),
    { now, planId: "short" },
  );
  assert.throws(
    () =>
      authorizeConditionalSimulation(shortPlan, {
        source: "fixture",
        ttlSeconds: 30,
        now: late,
      }),
    /EXPIRED/,
  );
});

test("receipt verification rejects plan, evidence, proposal, and receipt tampering", () => {
  const { plan, authorization } = ready();
  const result = simulateConditionalPlan({
    plan,
    authorization,
    evidence: conditionalFixtureEvidence(plan, "pass", {
      now,
    }),
    now,
  });
  const verify = (overrides = {}) =>
    verifyConditionalSimulationReceipt(
      overrides.receipt ?? result.receipt,
      {
        plan: overrides.plan ?? plan,
        authorization:
          overrides.authorization ?? authorization,
        evidence: overrides.evidence ?? result.evidence,
        proposal: overrides.proposal ?? result.proposal,
      },
    );

  assert.equal(verify(), true);
  assert.equal(
    verify({
      receipt: {
        ...result.receipt,
        decision: "BLOCK",
      },
    }),
    false,
  );
  assert.equal(
    verify({
      evidence: { ...result.evidence, best_ask: "2999" },
    }),
    false,
  );
  assert.equal(
    verify({
      proposal: {
        ...result.proposal,
        size: { ...result.proposal.size, value: "1" },
      },
    }),
    false,
  );
  const rawBoundTamper = resealProposal(
    result.proposal,
    { observed_slippage_bound: "9999" },
  );
  const rawBoundReceipt = resealReceipt(
    result.receipt,
    {
      proposal_digest:
        rawBoundTamper.proposal_digest,
    },
  );
  assert.equal(
    verify({
      proposal: rawBoundTamper,
      receipt: rawBoundReceipt,
    }),
    false,
  );

  const effectiveLimitTamper = resealProposal(
    result.proposal,
    {
      authorized_limit_price: "3010.5",
      limit_price: "3010.5",
    },
  );
  const effectiveLimitReceipt = resealReceipt(
    result.receipt,
    {
      proposal_digest:
        effectiveLimitTamper.proposal_digest,
    },
  );
  assert.equal(
    verify({
      proposal: effectiveLimitTamper,
      receipt: effectiveLimitReceipt,
    }),
    false,
  );
  const declaredBpsTamper = resealProposal(
    result.proposal,
    { max_slippage_bps: 0 },
  );
  const declaredBpsReceipt = resealReceipt(
    result.receipt,
    {
      proposal_digest:
        declaredBpsTamper.proposal_digest,
    },
  );
  assert.equal(
    verify({
      proposal: declaredBpsTamper,
      receipt: declaredBpsReceipt,
    }),
    false,
  );
  assert.equal(
    verify({
      authorization: {
        ...authorization,
        source: "view_only",
      },
    }),
    false,
  );

  const freshAuthorization =
    authorizeConditionalSimulation(plan, {
      source: "fixture",
      ttlSeconds: 300,
      now,
      authorizationId: "auth-fresh",
    });
  assert.equal(
    verify({
      authorization: freshAuthorization,
    }),
    false,
  );
  assert.equal(
    verify({
      plan: {
        ...plan,
        boundary: {
          ...plan.boundary,
          create_available: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    verify({
      receipt: {
        ...result.receipt,
        source: "view_only",
      },
    }),
    false,
  );
});

test("server-owned revision and clock inputs fail closed before evidence", () => {
  const { plan, authorization } = ready();
  const evidence = conditionalFixtureEvidence(plan, "pass", {
    now,
  });

  assert.throws(
    () =>
      simulateConditionalPlan({
        plan,
        authorization,
        evidence,
        currentRevision: "1",
        now,
      }),
    /server-owned integer/,
  );
  assert.throws(
    () =>
      simulateConditionalPlan({
        plan,
        authorization,
        evidence,
        now: () =>
          new Date("2026-07-31T11:59:59.999Z"),
      }),
    /not active yet/,
  );
});

test("core contains no watcher, timer, network, persistence, or execution primitive", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../src/advisor/conditional-plan.js",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bNumber\s*\(/);
  assert.doesNotMatch(source, /\bset(?:Interval|Timeout)\s*\(/);
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|writeFile)\b/);
  assert.doesNotMatch(source, /createOrder|\/orders\b|submitOrder/i);
  assert.doesNotMatch(source, /from\s+["'][^"']*execution/i);
  assert.doesNotMatch(source, /\b(?:poll|watch|schedule|recurr|trailing)\w*\s*\(/i);
});
