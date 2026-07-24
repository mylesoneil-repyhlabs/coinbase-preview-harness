import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  signDeltaDecisionForTest,
  verifyDeltaDecision,
} from "../src/delta-client.js";

const bindings = Object.freeze({
  plan_id: "plan-1",
  execution_digest: "execution",
  execution_confirmed_at: "2026-07-23T17:59:00.000Z",
  policy_expires_at: "2026-07-23T18:01:00.000Z",
  policy_digest: "policy",
  proposal_digest: "proposal",
  evidence_digest: "evidence",
  create_payload_digest: "create",
  portfolio_fingerprint: "portfolio",
  credential_fingerprint: "credential",
  client_order_id: "client-order",
  preview_id: "preview",
});

function decision(overrides = {}) {
  return {
    schema_version: "delta.coinbase.decision.v1",
    decision_id: randomUUID(),
    decision: "ALLOW",
    evaluated_at: "2026-07-23T18:00:00.000Z",
    expires_at: "2026-07-23T18:00:10.000Z",
    bindings,
    checks: [{ id: "all_constraints", result: "PASS" }],
    reason_codes: [],
    authorization: {
      algorithm: "Ed25519",
      key_id: "delta-test",
      audience: "delta-coinbase-executor",
      jti: randomUUID(),
      signature: "",
    },
    ...overrides,
  };
}

test("verifies a signed ALLOW only when every exact binding matches", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signed = signDeltaDecisionForTest(decision(), privateKey);
  assert.equal(
    verifyDeltaDecision(signed, bindings, publicKey, {
      now: new Date("2026-07-23T18:00:01.000Z"),
    }).decision,
    "ALLOW",
  );

  for (const field of Object.keys(bindings)) {
    assert.throws(
      () =>
        verifyDeltaDecision(
          signed,
          { ...bindings, [field]: `${bindings[field]}-changed` },
          publicKey,
          { now: new Date("2026-07-23T18:00:01.000Z") },
        ),
      new RegExp(field),
    );
  }
});

test("unsigned, failed-check, expired, and reversed delta decisions fail closed", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const now = new Date("2026-07-23T18:00:01.000Z");
  assert.throws(
    () => verifyDeltaDecision(decision(), bindings, publicKey, { now }),
    /signature verification failed/,
  );

  const failedCheck = signDeltaDecisionForTest(
    decision({ checks: [{ id: "amount", result: "FAIL" }] }),
    privateKey,
  );
  assert.throws(
    () => verifyDeltaDecision(failedCheck, bindings, publicKey, { now }),
    /named PASS/,
  );

  const expired = signDeltaDecisionForTest(
    decision({
      evaluated_at: "2026-07-23T17:59:40.000Z",
      expires_at: "2026-07-23T17:59:50.000Z",
    }),
    privateKey,
  );
  assert.throws(
    () => verifyDeltaDecision(expired, bindings, publicKey, { now }),
    /expired/,
  );

  const reversed = signDeltaDecisionForTest(
    decision({
      evaluated_at: "2026-07-23T18:00:05.000Z",
      expires_at: "2026-07-23T18:00:04.000Z",
    }),
    privateKey,
  );
  assert.throws(
    () => verifyDeltaDecision(reversed, bindings, publicKey, { now }),
    /must be after/,
  );
});
