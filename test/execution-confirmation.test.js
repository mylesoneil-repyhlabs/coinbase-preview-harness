import test from "node:test";
import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import { createBoundExecution } from "../src/execution-binding.js";
import {
  assertExecutionConfirmation,
  createExecutionConfirmation,
  writeExecutionConfirmation,
} from "../src/execution-confirmation.js";
import { createExecutionPlan } from "../src/plan.js";

const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";
const attestation = Object.freeze({
  jwt_profile: "CDP_URIS_V1",
  can_view: true,
  can_trade: true,
  can_transfer: false,
  can_receive: false,
  portfolio_fingerprint: "portfolio-confirmation",
  key_fingerprint: "credential-confirmation",
});
const confirmedAt = new Date("2026-07-23T18:00:00.000Z");

async function fixture() {
  const plan = await createExecutionPlan(INTENT);
  const boundExecution = createBoundExecution(
    plan,
    attestation,
    plan.policy_digest,
  );
  const receipt = createExecutionConfirmation({
    boundExecution,
    attestation,
    confirmedExecutionDigest: boundExecution.execution_digest,
    confirmedAt,
  });
  return { plan, boundExecution, receipt };
}

test("confirmation receipt binds one execution, credential, and immutable expiry", async () => {
  const { plan, boundExecution, receipt } = await fixture();
  assert.equal(
    new Date(receipt.expires_at).getTime() -
      new Date(receipt.confirmed_at).getTime(),
    plan.policy.validity.ttl_seconds * 1_000,
  );
  assert.equal(
    assertExecutionConfirmation({
      receipt,
      boundExecution,
      attestation,
      current: new Date(confirmedAt.getTime() + 119_999),
    }).plan.plan_id,
    plan.plan_id,
  );
  assert.throws(
    () =>
      assertExecutionConfirmation({
        receipt,
        boundExecution,
        attestation,
        current: new Date(confirmedAt.getTime() + 120_000),
      }),
    /receipt expired/,
  );
});

test("tampering with receipt time, scope, or credential fails closed", async () => {
  const { boundExecution, receipt } = await fixture();
  for (const tampered of [
    { ...receipt, expires_at: "2026-07-23T20:00:00.000Z" },
    { ...receipt, binding_id: "other-binding" },
    { ...receipt, execution_digest: "other-execution" },
  ]) {
    assert.throws(
      () =>
        assertExecutionConfirmation({
          receipt: tampered,
          boundExecution,
          attestation,
          current: new Date(confirmedAt.getTime() + 1_000),
        }),
      /digest is invalid|does not match/,
    );
  }
  assert.throws(
    () =>
      assertExecutionConfirmation({
        receipt,
        boundExecution,
        attestation: {
          ...attestation,
          portfolio_fingerprint: "other-portfolio",
        },
        current: new Date(confirmedAt.getTime() + 1_000),
      }),
    /does not match/,
  );
});

test("a stored confirmation cannot be re-timestamped for the same binding", async () => {
  const { boundExecution, receipt } = await fixture();
  const filePath = await writeExecutionConfirmation(receipt);
  try {
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    const refreshed = createExecutionConfirmation({
      boundExecution,
      attestation,
      confirmedExecutionDigest: boundExecution.execution_digest,
      confirmedAt: new Date(confirmedAt.getTime() + 86_400_000),
    });
    await assert.rejects(
      () => writeExecutionConfirmation(refreshed),
      /cannot be re-timestamped/,
    );
  } finally {
    await rm(filePath, { force: true });
  }
});
