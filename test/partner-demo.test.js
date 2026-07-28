import test from "node:test";
import assert from "node:assert/strict";
import {
  createPartnerDemoMandate,
  inspectPartnerDemoReceipt,
  partnerDemoProposal,
  runPartnerDemo,
  verifyPartnerDemoReceipt,
} from "../src/partner-demo.js";
import { digest } from "../src/evidence.js";

const FIXED = new Date("2026-07-27T14:00:00.000Z");

function receiptOptions(record, current = FIXED) {
  return {
    trustedPublicKeyPem: record.receipt.public_key_pem,
    mandate: record.mandate,
    proposal: record.proposal,
    evidence: record.evidence,
    executionPayload: record.execution_payload,
    decision: record.decision,
    current,
  };
}

test("PASS binds authoritative fixtures and exact payment payload before one simulated submission", async () => {
  const calls = [];
  const record = await runPartnerDemo({
    scenario: "pass",
    now: () => new Date(FIXED),
    executePayment: async (executionPayload, receipt) => {
      calls.push({ executionPayload, receipt });
      return {
        execution_id: "sim-execution-1",
        status: "SIMULATED_ACCEPTED",
        secret: "must-not-leak",
      };
    },
  });

  assert.equal(record.decision.decision, "PASS");
  assert.equal(record.receipt_verification.artifact_verified, true);
  assert.equal(record.receipt_verification.execution_authorized, true);
  assert.equal(
    verifyPartnerDemoReceipt(record.receipt, receiptOptions(record)),
    true,
  );
  assert.equal(record.execution.adapter_invoked, true);
  assert.equal(record.execution.grant_consumed, true);
  assert.equal(record.execution.money_moved, false);
  assert.equal(calls.length, 1);
  assert.equal(
    digest(calls[0].executionPayload),
    record.decision.execution_payload_digest,
  );
  assert.equal(
    calls[0].receipt.payload.execution_payload_digest,
    record.decision.execution_payload_digest,
  );
  assert.deepEqual(record.execution.result, {
    execution_id: "sim-execution-1",
    status: "SIMULATED_ACCEPTED",
  });
  assert.equal(JSON.stringify(record).includes("must-not-leak"), false);
});

test("BLOCK returns every material violation and keeps the adapter unreachable", async () => {
  let calls = 0;
  const record = await runPartnerDemo({
    scenario: "block",
    now: () => new Date(FIXED),
    executePayment: async () => {
      calls += 1;
    },
  });

  assert.equal(record.decision.decision, "BLOCK");
  assert.deepEqual(
    record.decision.blocking_failures.map(({ id }) => id),
    [
      "vendor_allowlist",
      "invoice_not_duplicate",
      "purchase_order_match",
      "bank_details_unchanged",
      "payment_cap",
    ],
  );
  assert.equal(record.receipt_verification.artifact_verified, true);
  assert.equal(record.receipt_verification.execution_authorized, false);
  assert.equal(record.receipt.payload.execution_grant, null);
  assert.equal(record.execution.adapter_invoked, false);
  assert.equal(calls, 0);
});

test("REVIEW is a signed non-PASS disposition that requires workflow suspension", async () => {
  let calls = 0;
  const record = await runPartnerDemo({
    scenario: "review",
    now: () => new Date(FIXED),
    executePayment: async () => {
      calls += 1;
    },
  });

  assert.equal(record.decision.decision, "REVIEW");
  assert.equal(record.decision.blocking_failures.length, 0);
  assert.deepEqual(
    record.decision.review_reasons.map(({ id }) => id),
    ["human_review_threshold"],
  );
  assert.equal(record.receipt_verification.artifact_verified, true);
  assert.equal(record.receipt_verification.execution_authorized, false);
  assert.equal(record.receipt.payload.execution_grant, null);
  assert.equal(record.execution.eligibility, "SUSPEND_FOR_REVIEW");
  assert.equal(record.execution.adapter_invoked, false);
  assert.equal(calls, 0);
});

test("receipt verification rejects decision, proposal, and execution-payload tampering", async () => {
  const record = await runPartnerDemo({
    scenario: "pass",
    now: () => new Date(FIXED),
  });
  for (const mutate of [
    (receipt) => {
      receipt.payload.decision = "BLOCK";
    },
    (receipt) => {
      receipt.payload.proposal_digest = "0".repeat(64);
    },
    (receipt) => {
      receipt.payload.execution_payload_digest = "f".repeat(64);
    },
  ]) {
    const changed = structuredClone(record.receipt);
    mutate(changed);
    assert.equal(
      verifyPartnerDemoReceipt(changed, receiptOptions(record)),
      false,
    );
  }
});

test("embedded public key is not trusted unless the controller pins it", async () => {
  const record = await runPartnerDemo({
    scenario: "pass",
    now: () => new Date(FIXED),
  });
  const unpinned = inspectPartnerDemoReceipt(record.receipt, {
    ...receiptOptions(record),
    trustedPublicKeyPem: undefined,
  });
  assert.equal(unpinned.artifact_verified, false);
  assert.equal(unpinned.checks.cryptographic_signature_valid, true);
  assert.equal(unpinned.checks.signer_key_pinned, false);
});

test("an expired receipt can still be integrity-valid but cannot authorize execution", async () => {
  const record = await runPartnerDemo({
    scenario: "pass",
    now: () => new Date(FIXED),
  });
  const inspected = inspectPartnerDemoReceipt(record.receipt, {
    ...receiptOptions(record),
    current: new Date(FIXED.getTime() + 2 * 60 * 60 * 1000),
  });
  assert.equal(inspected.artifact_verified, true);
  assert.equal(inspected.execution_authorized, false);
  assert.equal(inspected.checks.time_window_active, false);
});

test("partner proposals and mandates are bound to one authorization instance", () => {
  const mandate = createPartnerDemoMandate({ authorizedAt: FIXED });
  const proposal = partnerDemoProposal("pass", {
    authorizationContext: {
      tenant_id: "tenant-1",
      user_id: "user-1",
      workflow_run_id: "run-1",
      mandate_authorization_id: mandate.authorization_id,
    },
  });
  assert.equal(
    proposal.authorization_context.mandate_authorization_id,
    mandate.authorization_id,
  );
});

test("only the three pinned partner scenarios are accepted", () => {
  assert.throws(
    () => partnerDemoProposal("custom"),
    /exactly pass, block, or review/,
  );
});
