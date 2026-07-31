import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeConditionalSessionPlan,
  beginConditionalSessionAttempt,
  cancelConditionalSessionAttempt,
  conditionalPlanView,
  finishConditionalSessionAttempt,
  rememberConditionalPlan,
  reviseConditionalSessionPlan,
  revokeConditionalSessionPlan,
} from "../src/advisor/conditional-session.js";
import {
  authorizeConditionalSimulation,
  conditionalFixtureEvidence,
  createConditionalPlan,
  simulateConditionalPlan,
} from "../src/advisor/conditional-plan.js";

const CLOCK = new Date("2026-07-31T12:00:00.000Z");
const now = () => new Date(CLOCK);

function session() {
  return { conditionalPlans: new Map() };
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

function savedPlan(localSession = session()) {
  const plan = createConditionalPlan(planInput(), {
    now,
    planId: "plan-1",
  });
  rememberConditionalPlan(localSession, plan);
  return { localSession, plan };
}

function authorizedSession() {
  const { localSession, plan } = savedPlan();
  const view = authorizeConditionalSessionPlan(localSession, {
    planId: plan.plan_id,
    revision: plan.revision,
    source: "fixture",
    ttlSeconds: 300,
    now,
    authorizationId: "auth-1",
  });
  return { localSession, plan, view };
}

test("saved conditional plans are session-owned and non-executable", () => {
  const { localSession, plan } = savedPlan();
  const view = conditionalPlanView(localSession, plan.plan_id);

  assert.equal(view.session_state, "READY_FOR_SIM_AUTH");
  assert.equal(view.authorization, null);
  assert.equal(view.plan.boundary.executable, false);
  assert.equal(view.plan.boundary.create_available, false);
});

test("authorization is server-owned, redacted, and one-check only", () => {
  const { view } = authorizedSession();

  assert.equal(
    view.session_state,
    "AUTHORIZED_FOR_SIMULATION",
  );
  assert.equal(view.authorization.max_uses, 1);
  assert.equal(view.authorization.consumed, false);
  assert.equal(
    view.authorization.authorization_digest,
    undefined,
  );
  assert.equal(view.authorization.boundary.create_available, false);
});

test("double-submit consumes synchronously before evidence fetch", () => {
  const { localSession, plan } = authorizedSession();
  const first = beginConditionalSessionAttempt(localSession, {
    planId: plan.plan_id,
    revision: plan.revision,
    authorizationId: "auth-1",
    now,
    attemptId: "attempt-1",
  });

  assert.equal(first.signal.aborted, false);
  assert.throws(
    () =>
      beginConditionalSessionAttempt(localSession, {
        planId: plan.plan_id,
        revision: plan.revision,
        authorizationId: "auth-1",
        now,
        attemptId: "attempt-2",
      }),
    (error) =>
      error?.code ===
        "CONDITIONAL_AUTHORIZATION_CONSUMED" &&
      /no second result/i.test(error.message),
  );
  assert.equal(
    conditionalPlanView(localSession, plan.plan_id)
      .authorization.consumed,
    true,
  );
});

test("one consumed attempt can finish exactly once", () => {
  const { localSession, plan } = authorizedSession();
  const attempt = beginConditionalSessionAttempt(localSession, {
    planId: plan.plan_id,
    revision: plan.revision,
    authorizationId: "auth-1",
    now,
    attemptId: "attempt-1",
  });
  const result = simulateConditionalPlan({
    plan: attempt.plan,
    authorization: attempt.authorization,
    evidence: conditionalFixtureEvidence(
      attempt.plan,
      "pass",
      { now },
    ),
    scenario: "pass",
    now,
  });

  const completed = finishConditionalSessionAttempt(
    localSession,
    {
      planId: plan.plan_id,
      revision: plan.revision,
      attemptId: attempt.attempt_id,
      result,
      now,
    },
  );
  assert.equal(
    completed.session_state,
    "WOULD_TRIGGER_SIMULATION",
  );
  assert.equal(completed.result.receipt.verified, true);
  assert.throws(
    () =>
      finishConditionalSessionAttempt(localSession, {
        planId: plan.plan_id,
        revision: plan.revision,
        attemptId: attempt.attempt_id,
        result,
        now,
      }),
    (error) =>
      error?.code === "CONDITIONAL_ATTEMPT_CONFLICT",
  );
});

test("server cancellation tombstones an authorization before a delayed attempt can start", () => {
  const { localSession, plan } = authorizedSession();
  const cancelled = cancelConditionalSessionAttempt(
    localSession,
    {
      planId: plan.plan_id,
      revision: plan.revision,
      authorizationId: "auth-1",
      now,
    },
  );

  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.already_cancelled, false);
  assert.equal(
    cancelled.saved_plan.session_state,
    "REVIEW",
  );
  assert.equal(
    cancelled.saved_plan.authorization.consumed,
    true,
  );
  assert.equal(
    cancelled.saved_plan.cancellation
      .late_result_disposition,
    "DISCARD",
  );
  assert.throws(
    () =>
      beginConditionalSessionAttempt(localSession, {
        planId: plan.plan_id,
        revision: plan.revision,
        authorizationId: "auth-1",
        now,
        attemptId: "attempt-after-cancel",
      }),
    (error) =>
      error?.code ===
      "CONDITIONAL_AUTHORIZATION_CONSUMED",
  );

  const repeated = cancelConditionalSessionAttempt(
    localSession,
    {
      planId: plan.plan_id,
      revision: plan.revision,
      authorizationId: "auth-1",
      now,
    },
  );
  assert.equal(repeated.cancelled, true);
  assert.equal(repeated.already_cancelled, true);
});

test("server cancellation aborts an in-flight attempt and discards its late PASS", () => {
  const { localSession, plan } = authorizedSession();
  const attempt = beginConditionalSessionAttempt(
    localSession,
    {
      planId: plan.plan_id,
      revision: plan.revision,
      authorizationId: "auth-1",
      now,
      attemptId: "attempt-cancelled",
    },
  );
  const latePass = simulateConditionalPlan({
    plan: attempt.plan,
    authorization: attempt.authorization,
    evidence: conditionalFixtureEvidence(
      attempt.plan,
      "pass",
      { now },
    ),
    scenario: "pass",
    now,
  });

  const cancelled = cancelConditionalSessionAttempt(
    localSession,
    {
      planId: plan.plan_id,
      revision: plan.revision,
      authorizationId: "auth-1",
      now,
    },
  );
  assert.equal(cancelled.cancelled, true);
  assert.equal(attempt.signal.aborted, true);
  assert.throws(
    () =>
      finishConditionalSessionAttempt(localSession, {
        planId: plan.plan_id,
        revision: plan.revision,
        attemptId: attempt.attempt_id,
        result: latePass,
        now,
      }),
    (error) =>
      error?.code === "CONDITIONAL_ATTEMPT_CONFLICT",
  );
  assert.equal(
    conditionalPlanView(localSession, plan.plan_id).result,
    null,
  );
});

test("a completed result wins a later cancellation request and remains visible", () => {
  const { localSession, plan } = authorizedSession();
  const attempt = beginConditionalSessionAttempt(
    localSession,
    {
      planId: plan.plan_id,
      revision: plan.revision,
      authorizationId: "auth-1",
      now,
      attemptId: "attempt-completed",
    },
  );
  const result = simulateConditionalPlan({
    plan: attempt.plan,
    authorization: attempt.authorization,
    evidence: conditionalFixtureEvidence(
      attempt.plan,
      "pass",
      { now },
    ),
    scenario: "pass",
    now,
  });
  finishConditionalSessionAttempt(localSession, {
    planId: plan.plan_id,
    revision: plan.revision,
    attemptId: attempt.attempt_id,
    result,
    now,
  });

  const cancellation = cancelConditionalSessionAttempt(
    localSession,
    {
      planId: plan.plan_id,
      revision: plan.revision,
      authorizationId: "auth-1",
      now,
    },
  );
  assert.equal(cancellation.cancelled, false);
  assert.equal(
    cancellation.saved_plan.result.receipt
      .receipt_digest,
    result.receipt.receipt_digest,
  );
  assert.equal(
    cancellation.saved_plan.session_state,
    "WOULD_TRIGGER_SIMULATION",
  );
});

test("revoke aborts an in-flight check and late PASS is discarded", () => {
  const { localSession, plan } = authorizedSession();
  const attempt = beginConditionalSessionAttempt(localSession, {
    planId: plan.plan_id,
    revision: plan.revision,
    authorizationId: "auth-1",
    now,
    attemptId: "attempt-1",
  });
  const latePass = simulateConditionalPlan({
    plan: attempt.plan,
    authorization: attempt.authorization,
    evidence: conditionalFixtureEvidence(
      attempt.plan,
      "pass",
      { now },
    ),
    scenario: "pass",
    now,
  });

  const revoked = revokeConditionalSessionPlan(localSession, {
    planId: plan.plan_id,
    revision: plan.revision,
    now,
  });
  assert.equal(revoked.session_state, "REVOKED");
  assert.equal(attempt.signal.aborted, true);
  assert.throws(
    () =>
      finishConditionalSessionAttempt(localSession, {
        planId: plan.plan_id,
        revision: plan.revision,
        attemptId: attempt.attempt_id,
        result: latePass,
        now,
      }),
    (error) => error?.code === "CONDITIONAL_PLAN_REVOKED",
  );
  assert.equal(
    conditionalPlanView(localSession, plan.plan_id)
      .session_state,
    "REVOKED",
  );
  assert.equal(
    conditionalPlanView(localSession, plan.plan_id).result,
    null,
  );
});

test("edit supersedes an in-flight revision and late PASS cannot revive it", () => {
  const { localSession, plan } = authorizedSession();
  const attempt = beginConditionalSessionAttempt(localSession, {
    planId: plan.plan_id,
    revision: plan.revision,
    authorizationId: "auth-1",
    now,
    attemptId: "attempt-1",
  });
  const latePass = simulateConditionalPlan({
    plan: attempt.plan,
    authorization: attempt.authorization,
    evidence: conditionalFixtureEvidence(
      attempt.plan,
      "pass",
      { now },
    ),
    scenario: "pass",
    now,
  });

  const edited = reviseConditionalSessionPlan(localSession, {
    planId: plan.plan_id,
    revision: plan.revision,
    patch: { threshold_value: "2900" },
    now: () =>
      new Date("2026-07-31T12:00:01.000Z"),
  });
  assert.equal(edited.superseded.session_state, "SUPERSEDED");
  assert.equal(edited.current.plan.revision, 2);
  assert.equal(attempt.signal.aborted, true);
  assert.throws(
    () =>
      finishConditionalSessionAttempt(localSession, {
        planId: plan.plan_id,
        revision: plan.revision,
        attemptId: attempt.attempt_id,
        result: latePass,
        now,
      }),
    (error) =>
      error?.code === "CONDITIONAL_PLAN_SUPERSEDED",
  );
});

test("expired plan wins over a late result and never exposes it", () => {
  const localSession = session();
  const expiring = createConditionalPlan(
    planInput({
      expires_at: "2026-07-31T12:00:31.000Z",
    }),
    { now, planId: "plan-expiring" },
  );
  rememberConditionalPlan(localSession, expiring);
  authorizeConditionalSessionPlan(localSession, {
    planId: expiring.plan_id,
    revision: 1,
    source: "fixture",
    ttlSeconds: 30,
    now,
    authorizationId: "auth-expiring",
  });
  const attempt = beginConditionalSessionAttempt(localSession, {
    planId: expiring.plan_id,
    revision: 1,
    authorizationId: "auth-expiring",
    now,
    attemptId: "attempt-expiring",
  });
  const standaloneAuthorization =
    authorizeConditionalSimulation(expiring, {
      source: "fixture",
      ttlSeconds: 30,
      now,
      authorizationId: "standalone",
    });
  const lateResult = simulateConditionalPlan({
    plan: expiring,
    authorization: standaloneAuthorization,
    evidence: conditionalFixtureEvidence(
      expiring,
      "pass",
      { now },
    ),
    now,
  });

  assert.throws(
    () =>
      finishConditionalSessionAttempt(localSession, {
        planId: expiring.plan_id,
        revision: 1,
        attemptId: attempt.attempt_id,
        result: lateResult,
        now: () =>
          new Date("2026-07-31T12:00:31.000Z"),
      }),
    (error) => error?.code === "CONDITIONAL_PLAN_EXPIRED",
  );
  assert.equal(
    conditionalPlanView(localSession, expiring.plan_id)
      .session_state,
    "EXPIRED",
  );
});

test("EXPIRED remains a sticky terminal tombstone after wall-clock rollback", () => {
  const localSession = session();
  const expiring = createConditionalPlan(
    planInput({
      expires_at: "2026-07-31T12:00:30.000Z",
    }),
    { now, planId: "sticky-expiry" },
  );
  rememberConditionalPlan(localSession, expiring);
  const afterExpiry = () =>
    new Date("2026-07-31T12:00:31.000Z");
  const beforeExpiry = () =>
    new Date("2026-07-31T12:00:01.000Z");

  assert.throws(
    () =>
      authorizeConditionalSessionPlan(localSession, {
        planId: expiring.plan_id,
        revision: 1,
        source: "fixture",
        ttlSeconds: 30,
        now: afterExpiry,
        authorizationId: "too-late",
      }),
    (error) =>
      error?.code === "CONDITIONAL_PLAN_EXPIRED",
  );
  assert.equal(
    conditionalPlanView(localSession, expiring.plan_id)
      .session_state,
    "EXPIRED",
  );
  assert.throws(
    () =>
      reviseConditionalSessionPlan(localSession, {
        planId: expiring.plan_id,
        revision: 1,
        patch: { threshold_value: "2900" },
        now: beforeExpiry,
      }),
    (error) =>
      error?.code === "CONDITIONAL_PLAN_EXPIRED",
  );
  assert.throws(
    () =>
      authorizeConditionalSessionPlan(localSession, {
        planId: expiring.plan_id,
        revision: 1,
        source: "fixture",
        ttlSeconds: 30,
        now: beforeExpiry,
        authorizationId: "rolled-back-auth",
      }),
    (error) =>
      error?.code === "CONDITIONAL_PLAN_EXPIRED",
  );
  assert.throws(
    () =>
      beginConditionalSessionAttempt(localSession, {
        planId: expiring.plan_id,
        revision: 1,
        authorizationId: "rolled-back-auth",
        now: beforeExpiry,
        attemptId: "rolled-back-attempt",
      }),
    (error) =>
      error?.code === "CONDITIONAL_PLAN_EXPIRED",
  );
});
