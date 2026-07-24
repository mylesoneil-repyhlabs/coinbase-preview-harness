import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBoundExecution,
  createBoundExecution,
} from "../src/execution-binding.js";
import { createExecutionPlan } from "../src/plan.js";

const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";

const attestation = Object.freeze({
  jwt_profile: "CDP_URIS_V1",
  can_view: true,
  can_trade: true,
  can_transfer: false,
  can_receive: false,
  portfolio_fingerprint: "portfolio-a",
  key_fingerprint: "credential-a",
});

test("human confirmation binds the policy to one credential-scoped portfolio", async () => {
  const plan = await createExecutionPlan(INTENT);
  const bound = createBoundExecution(plan, attestation, plan.policy_digest);
  assert.equal(
    assertBoundExecution(bound, attestation, bound.execution_digest).plan_id,
    plan.plan_id,
  );
  assert.equal(
    bound.authorization_scope.credential_binding.portfolio_fingerprint,
    "portfolio-a",
  );
  assert.equal(JSON.stringify(bound).includes("PRIVATE KEY"), false);
  assert.equal(bound.policy_confirmation.matched, true);
});

test("changed portfolio, key, plan, or confirmation digest fails before execution", async () => {
  const plan = await createExecutionPlan(INTENT);
  const bound = createBoundExecution(plan, attestation, plan.policy_digest);
  assert.throws(
    () => createBoundExecution(plan, attestation, "wrong"),
    /compiled policy/,
  );
  assert.throws(
    () =>
      assertBoundExecution(
        bound,
        { ...attestation, portfolio_fingerprint: "portfolio-b" },
        bound.execution_digest,
      ),
    /does not match/,
  );
  assert.throws(
    () =>
      assertBoundExecution(
        bound,
        { ...attestation, key_fingerprint: "credential-b" },
        bound.execution_digest,
      ),
    /does not match/,
  );
  assert.throws(
    () => assertBoundExecution(bound, attestation, "wrong"),
    /confirmation digest/,
  );
  assert.throws(
    () =>
      assertBoundExecution(
        {
          ...bound,
          plan: {
            ...bound.plan,
            policy: { ...bound.plan.policy, product_id: "ETH-USD" },
          },
        },
        attestation,
        bound.execution_digest,
      ),
    /plan digest mismatch/,
  );
});
