import test from "node:test";
import assert from "node:assert/strict";
import {
  COINBASE_DEMO_MANDATE,
  evaluateCoinbaseShowcaseCandidate,
  runCoinbaseDemo,
  verifyCoinbaseDemoReceipt,
  verifyCoinbaseShowcaseAttempt,
} from "../src/coinbase-demo.js";
import { digest } from "../src/evidence.js";

function refreshReceiptDigest(receipt) {
  const {
    receipt_digest: _oldDigest,
    verified: _annotation,
    ...payload
  } = receipt;
  receipt.receipt_digest = digest(payload);
}

function refreshAuthorizationBinding(attempt) {
  attempt.receipt.authorization_digest = digest({
    schema_version: "delta.coinbase.simulated_authorization_instance.v1",
    mandate_digest: digest(COINBASE_DEMO_MANDATE),
    authorized_at: attempt.authorized_at,
    expires_at: attempt.mandate_expires_at,
    max_executions: COINBASE_DEMO_MANDATE.max_executions,
  });
}

test("Coinbase showcase runs the complete credential-free mandate lifecycle", async () => {
  const record = await runCoinbaseDemo();

  assert.equal(record.artifact_class, "SIMULATED_NOT_PRODUCTION_DELTA");
  assert.equal(record.status, "SIMULATED_SINGLE_EXECUTION_ELIGIBLE");
  assert.equal(record.demo.credential_mode, "NO_CREDENTIALS");
  assert.equal(record.decision.verdict, "PASS");
  assert.equal(record.authorization.live_trade_authorized, false);
  assert.equal(record.technical_validation.delta.status, "success");
  assert.equal(record.technical_validation.delta.verifier_confirmed, true);
  assert.equal(record.technical_validation.delta.proof_present, true);
  assert.equal(
    record.technical_validation.execution_adapter_contract_exercised,
    true,
  );
  assert.equal(record.execution.coinbase_adapter_invoked, false);
  assert.equal(record.execution.order_submitted, false);
  assert.equal(record.execution.money_moved, false);
  assert.equal(record.demo.coinbase_contacted, false);
  assert.equal(record.demo.coinbase_create_invoked, false);
  assert.equal(record.technical_validation.reconciliation_check, "PASS");
  assert.equal(record.demo.lifecycle.includes("simulated_reconciliation"), false);
});

test("Coinbase showcase proves bounded retry and one trace-local eligibility", async () => {
  const retry = (await runCoinbaseDemo()).demo.bounded_retry;

  assert.equal(retry.max_attempts, 2);
  assert.equal(retry.terminal_status, "SIMULATED_GATE_REACHED");
  assert.equal(retry.controller_terminal_status, "EXECUTED");
  assert.deepEqual(
    retry.attempts.map(({ disposition }) => disposition),
    ["RETRY", "EXECUTE"],
  );
  assert.deepEqual(
    retry.attempts[0].constraint_failures.map(({ id }) => id),
    [
      "allocation_cap",
      "price_threshold",
      "limit_price_cap",
      "slippage_cap",
      "fee_cap",
      "portfolio_exposure_cap",
    ],
  );
  assert.equal(retry.attempts[0].receipt.verdict, "BLOCK");
  assert.equal(retry.attempts[0].disposition, "RETRY");
  assert.equal(
    Object.hasOwn(retry.attempts[0].receipt, "controller_disposition"),
    false,
  );
  assert.equal(retry.attempts[0].receipt.verified, true);
  assert.equal(
    retry.attempts[0].receipt.authorization_digest,
    retry.attempts[1].receipt.authorization_digest,
  );
  assert.equal(
    retry.attempts[0].receipt.evidence_digest,
    retry.attempts[0].evidence_digest,
  );
  assert.equal(retry.attempts[1].proof_present, true);
  assert.equal(retry.attempts[1].receipt.verdict, "PASS");
  assert.equal(retry.attempts[1].disposition, "EXECUTE");
  assert.equal(retry.attempts[1].receipt.verified, true);
  assert.equal(
    retry.attempts[1].receipt.evidence_digest,
    retry.attempts[1].evidence_digest,
  );
  assert.equal(retry.execution.coinbase_create_invoked, false);
  assert.equal(retry.execution.status, "SIMULATED_SINGLE_EXECUTION_ELIGIBLE");
  assert.equal(
    retry.execution.exact_payload_digest,
    retry.attempts[1].exact_payload_digest,
  );
  assert.equal(
    retry.execution.evidence_digest,
    retry.attempts[1].evidence_digest,
  );
  assert.equal(
    retry.attempts[1].exact_payload.client_order_id,
    "delta-showcase-candidate-2",
  );
  assert.equal(
    retry.attempts[1].exact_payload.preview_id,
    retry.attempts[1].evidence.preview.preview_id,
  );
  assert.equal(
    retry.attempts[1].evidence.collected_by,
    "EXTERNAL_CONTROLLER_FIXTURE",
  );
  assert.equal(retry.execution.simulated_trace_eligibilities, 1);
  assert.equal(retry.execution.durable_one_time_grant_issued, false);
  assert.equal(retry.execution.external_executor_invoked, false);
});

test("Coinbase showcase evaluator fails closed on malformed proposal economics", () => {
  const evaluated = evaluateCoinbaseShowcaseCandidate({
    exact_payload: {
      product_id: "ETH-USDC",
      side: "BUY",
      order_configuration: {
        sor_limit_ioc: { quote_size: "not-a-decimal", limit_price: "3000.00" },
      },
    },
    evidence: {},
  });
  assert.deepEqual(
    evaluated.failures.map(({ id }) => id),
    ["closed_payload_schema", "closed_evidence_schema"],
  );
});

test("Coinbase showcase receipt verification detects tampering", async () => {
  const attempt = (await runCoinbaseDemo()).demo.bounded_retry.attempts[1];
  const { receipt } = attempt;
  assert.equal(verifyCoinbaseDemoReceipt(receipt), true);
  assert.equal(verifyCoinbaseShowcaseAttempt(attempt), true);
  assert.equal(
    verifyCoinbaseDemoReceipt({ ...receipt, exact_payload_digest: "tampered" }),
    false,
  );
  assert.equal(
    verifyCoinbaseShowcaseAttempt({
      ...attempt,
      exact_payload: {
        ...attempt.exact_payload,
        product_id: "BTC-USDC",
      },
    }),
    false,
  );
  assert.equal(
    verifyCoinbaseShowcaseAttempt({
      ...attempt,
      exact_payload: {
        ...attempt.exact_payload,
        preview_id: "different-preview",
      },
    }),
    false,
  );
  assert.equal(
    verifyCoinbaseShowcaseAttempt({
      ...attempt,
      evidence: {
        ...attempt.evidence,
        preview: {
          ...attempt.evidence.preview,
          commission_total: "99.00",
        },
      },
    }),
    false,
  );
  const forgedPass = structuredClone(attempt);
  forgedPass.exact_payload.order_configuration.sor_limit_ioc.quote_size =
    "9999.00";
  forgedPass.exact_payload_digest = forgedPass.receipt.exact_payload_digest =
    "forged";
  forgedPass.constraint_failures = [];
  forgedPass.receipt.constraint_failures = [];
  forgedPass.receipt.verdict = "PASS";
  assert.equal(verifyCoinbaseShowcaseAttempt(forgedPass), false);
});

test("Coinbase showcase rejects self-consistent unmandated Create fields", async () => {
  const passingAttempt = (await runCoinbaseDemo()).demo.bounded_retry.attempts[1];
  for (const mutate of [
    (attempt) => {
      attempt.exact_payload.leverage = "3";
    },
    (attempt) => {
      attempt.exact_payload.attached_order_configuration = {
        trigger_bracket_gtc: {
          limit_price: "5000.00",
          stop_trigger_price: "2500.00",
        },
      };
    },
    (attempt) => {
      attempt.exact_payload.order_configuration.sor_limit_ioc.extra =
        "unsupported";
    },
  ]) {
    const attempt = structuredClone(passingAttempt);
    mutate(attempt);
    attempt.exact_payload_digest = digest(attempt.exact_payload);
    attempt.receipt.exact_payload_digest = attempt.exact_payload_digest;
    refreshReceiptDigest(attempt.receipt);
    assert.equal(verifyCoinbaseDemoReceipt(attempt.receipt), true);
    assert.equal(verifyCoinbaseShowcaseAttempt(attempt), false);
    assert.deepEqual(
      evaluateCoinbaseShowcaseCandidate(attempt).failures.map(({ id }) => id),
      ["closed_payload_schema"],
    );
  }
});

test("Coinbase showcase rejects self-consistent stale evidence and extended authorization", async () => {
  const passingAttempt = (await runCoinbaseDemo()).demo.bounded_retry.attempts[1];

  const agentAuthored = structuredClone(passingAttempt);
  agentAuthored.evidence.collected_by = "AGENT";
  agentAuthored.evidence_digest = digest(agentAuthored.evidence);
  agentAuthored.receipt.evidence_digest = agentAuthored.evidence_digest;
  refreshReceiptDigest(agentAuthored.receipt);
  assert.equal(verifyCoinbaseDemoReceipt(agentAuthored.receipt), true);
  assert.equal(verifyCoinbaseShowcaseAttempt(agentAuthored), false);

  const stale = structuredClone(passingAttempt);
  stale.evidence.market.observed_at = "2020-01-01T00:00:00.000Z";
  stale.evidence.portfolio.observed_at = "2020-01-01T00:00:00.000Z";
  stale.evidence_digest = digest(stale.evidence);
  stale.receipt.evidence_digest = stale.evidence_digest;
  refreshReceiptDigest(stale.receipt);
  assert.equal(verifyCoinbaseDemoReceipt(stale.receipt), true);
  assert.equal(verifyCoinbaseShowcaseAttempt(stale), false);

  const extended = structuredClone(passingAttempt);
  extended.mandate_expires_at = "2126-01-01T00:00:00.000Z";
  extended.receipt.mandate_expires_at = extended.mandate_expires_at;
  refreshAuthorizationBinding(extended);
  refreshReceiptDigest(extended.receipt);
  assert.equal(verifyCoinbaseDemoReceipt(extended.receipt), true);
  assert.equal(verifyCoinbaseShowcaseAttempt(extended), false);

  const beforeAuthorization = structuredClone(passingAttempt);
  beforeAuthorization.evaluated_at = new Date(
    Date.parse(beforeAuthorization.authorized_at) - 1_000,
  ).toISOString();
  beforeAuthorization.receipt.evaluated_at =
    beforeAuthorization.evaluated_at;
  beforeAuthorization.evidence.market.observed_at =
    beforeAuthorization.evaluated_at;
  beforeAuthorization.evidence.portfolio.observed_at =
    beforeAuthorization.evaluated_at;
  beforeAuthorization.evidence_digest = digest(beforeAuthorization.evidence);
  beforeAuthorization.receipt.evidence_digest =
    beforeAuthorization.evidence_digest;
  refreshReceiptDigest(beforeAuthorization.receipt);
  assert.equal(verifyCoinbaseShowcaseAttempt(beforeAuthorization), false);
});

test("Coinbase showcase receipt cannot claim a false provenance or altered reason", async () => {
  const retry = (await runCoinbaseDemo()).demo.bounded_retry;
  const passingReceipt = structuredClone(retry.attempts[1].receipt);

  passingReceipt.artifact_class = "PRODUCTION_DELTA_RECEIPT";
  refreshReceiptDigest(passingReceipt);
  assert.equal(verifyCoinbaseDemoReceipt(passingReceipt), false);

  const falseEvaluator = structuredClone(retry.attempts[1].receipt);
  falseEvaluator.evaluator = "coinbase-official";
  refreshReceiptDigest(falseEvaluator);
  assert.equal(verifyCoinbaseDemoReceipt(falseEvaluator), false);

  const alteredReason = structuredClone(retry.attempts[0]);
  alteredReason.constraint_failures[0].reason = "rewritten reason";
  alteredReason.receipt.constraint_failures[0].reason = "rewritten reason";
  refreshReceiptDigest(alteredReason.receipt);
  assert.equal(verifyCoinbaseDemoReceipt(alteredReason.receipt), true);
  assert.equal(verifyCoinbaseShowcaseAttempt(alteredReason), false);
});
