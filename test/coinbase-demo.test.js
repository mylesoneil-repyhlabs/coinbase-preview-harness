import test from "node:test";
import assert from "node:assert/strict";
import {
  runCoinbaseDemo,
  verifyCoinbaseDemoReceipt,
} from "../src/coinbase-demo.js";

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
  assert.deepEqual(
    retry.attempts[0].constraint_failures.map(({ id }) => id),
    [
      "allocation_cap",
      "price_threshold",
      "slippage_cap",
      "fee_cap",
      "portfolio_exposure_cap",
    ],
  );
  assert.equal(retry.attempts[0].receipt.verdict, "BLOCK");
  assert.equal(retry.attempts[0].receipt.controller_disposition, "RETRY");
  assert.equal(retry.attempts[0].receipt.verified, true);
  assert.equal(retry.attempts[1].proof_present, true);
  assert.equal(retry.attempts[1].receipt.verdict, "PASS");
  assert.equal(retry.attempts[1].receipt.controller_disposition, "EXECUTE");
  assert.equal(retry.attempts[1].receipt.verified, true);
  assert.equal(retry.execution.coinbase_create_invoked, false);
  assert.equal(retry.execution.status, "SIMULATED_SINGLE_EXECUTION_ELIGIBLE");
  assert.equal(
    retry.execution.exact_payload_digest,
    retry.attempts[1].exact_payload_digest,
  );
});

test("Coinbase showcase receipt verification detects tampering", async () => {
  const receipt = (await runCoinbaseDemo()).demo.bounded_retry.attempts[1]
    .receipt;
  assert.equal(verifyCoinbaseDemoReceipt(receipt), true);
  assert.equal(
    verifyCoinbaseDemoReceipt({ ...receipt, exact_payload_digest: "tampered" }),
    false,
  );
});
