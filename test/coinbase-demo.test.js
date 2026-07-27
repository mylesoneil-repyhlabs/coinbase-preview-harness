import test from "node:test";
import assert from "node:assert/strict";
import { runCoinbaseDemo } from "../src/coinbase-demo.js";

test("Coinbase showcase runs the complete credential-free mandate lifecycle", async () => {
  const record = await runCoinbaseDemo();

  assert.equal(record.artifact_class, "SIMULATED");
  assert.equal(record.status, "FILLED");
  assert.equal(record.demo.credential_mode, "NO_CREDENTIALS");
  assert.equal(record.delta.status, "success");
  assert.equal(record.delta.verifier_confirmed, true);
  assert.equal(record.delta.proof_present, true);
  assert.equal(record.execution.adapter_invoked, true);
  assert.equal(record.demo.coinbase_contacted, false);
  assert.equal(record.demo.coinbase_create_invoked, false);
  assert.equal(record.reconciliation.checks.verdict, "PASS");
});

test("Coinbase showcase proves bounded constraint retry and one external execution", async () => {
  const retry = (await runCoinbaseDemo()).demo.bounded_retry;

  assert.equal(retry.max_attempts, 2);
  assert.equal(retry.terminal_status, "EXECUTED");
  assert.deepEqual(
    retry.attempts.map(({ disposition }) => disposition),
    ["RETRY", "EXECUTE"],
  );
  assert.equal(retry.attempts[0].constraint_failures.length, 1);
  assert.equal(retry.attempts[1].proof_present, true);
  assert.equal(retry.execution.coinbase_create_invoked, false);
  assert.equal(
    retry.execution.exact_payload_digest,
    retry.attempts[1].exact_payload_digest,
  );
});
