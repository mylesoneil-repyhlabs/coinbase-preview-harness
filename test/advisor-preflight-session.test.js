import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/evidence.js";
import { reviewError } from "../src/guard-errors.js";
import { createExecutionPlan } from "../src/plan.js";
import { runGuardPreflight } from "../src/preflight.js";

const INTENT =
  "Using held USDC, buy exactly 250 USDC of SOL on SOL-USDC once with a price-bounded IOC limit order and allow partial fills. Do not pay more than 40 bps above Coinbase's fresh best ask, more than 2 USDC in fees, or more than 252 USDC total. The authorization expires 2 minutes after I confirm it.";
const PRIVATE_KEY_CANARY = [
  "-----BEGIN EC PRIVATE KEY-----",
  "session-only-canary",
  "-----END EC PRIVATE KEY-----",
].join("\n");

function verifiedViewCredential() {
  const result = {
    attestation: {
      schema: "delta.coinbase.view_permission_attestation.v2",
      verified_at: new Date().toISOString(),
      environment: "coinbase-read-preview",
      jwt_profile: "CDP_URIS_V1",
      can_view: true,
      can_trade: false,
      can_transfer: false,
      can_receive: false,
      can_receive_reported: true,
      portfolio_fingerprint: digest("session-portfolio"),
      key_fingerprint: digest("session-key"),
    },
  };
  Object.defineProperty(result, "credentials", {
    enumerable: false,
    value: {
      keyId: "organizations/test/apiKeys/view-only",
      privateKey: PRIVATE_KEY_CANARY,
    },
  });
  return result;
}

function passRecord() {
  return {
    decision: "PASS",
    status: "PREVIEW_PROBE_PASS",
    boundary: {
      coinbase_contacted: true,
      create_available: false,
      no_order_submitted: true,
      money_moved: false,
    },
    execution: {
      adapter_invoked: false,
      order_submitted: false,
    },
    guard_receipt: {
      receipt_digest: digest("test-pass-receipt"),
    },
  };
}

test("advisor preflight accepts one verified in-memory View-only source without a key path", async () => {
  const plan = await createExecutionPlan(INTENT);
  const verified = verifiedViewCredential();
  let pipelineInput = null;
  let currentChecks = 0;
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    verifiedViewCredential: verified,
    assertViewCredentialCurrent: () => {
      currentChecks += 1;
    },
    nonce: "session-source-pass",
    history: { enabled: false },
    verifyViewCredentials: async () => {
      throw new Error("filesystem verifier must not run");
    },
    createViewAdapter: () => ({}),
    loadCapabilityProfile: async () => ({}),
    runPipeline: async (input) => {
      pipelineInput = input;
      return passRecord();
    },
  });

  assert.equal(result.record.decision, "PASS");
  assert.equal(currentChecks, 1);
  assert.equal(
    pipelineInput.attestation.key_fingerprint,
    verified.attestation.key_fingerprint,
  );
  assert.equal(
    JSON.stringify({ result, pipelineInput }).includes(
      PRIVATE_KEY_CANARY,
    ),
    false,
  );
});

test("a changed in-memory connection replaces a prospective PASS with REVIEW before history", async () => {
  const plan = await createExecutionPlan(INTENT);
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    verifiedViewCredential: verifiedViewCredential(),
    assertViewCredentialCurrent: () => {
      throw reviewError(
        "VIEW_ONLY_SESSION_SUPERSEDED",
        "The local View-only connection changed",
        {
          stage: "VIEW_ONLY_CREDENTIAL",
          retryable: false,
        },
      );
    },
    nonce: "session-source-changed",
    history: { enabled: false },
    createViewAdapter: () => ({}),
    loadCapabilityProfile: async () => ({}),
    runPipeline: async () => passRecord(),
  });

  assert.equal(result.record.decision, "REVIEW");
  assert.equal(
    result.record.failure.code,
    "VIEW_ONLY_SESSION_SUPERSEDED",
  );
  assert.equal(result.record.execution.order_submitted, false);
  assert.equal(result.record.boundary.create_available, false);
  assert.equal(result.record.boundary.coinbase_contacted, true);
  assert.notEqual(result.record.status, "PREVIEW_PROBE_PASS");
});

test("advisor preflight refuses ambiguous View-only credential sources", async () => {
  const plan = await createExecutionPlan(INTENT);
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    viewKeyFile: "/not-read/session-key.json",
    verifiedViewCredential: verifiedViewCredential(),
    nonce: "session-source-conflict",
    history: { enabled: false },
    verifyViewCredentials: async () => {
      throw new Error("conflicting sources must stop first");
    },
  });

  assert.equal(result.record.decision, "REVIEW");
  assert.equal(
    result.record.failure.code,
    "VIEW_ONLY_CREDENTIAL_SOURCE_CONFLICT",
  );
  assert.equal(result.record.boundary.coinbase_contacted, false);
  assert.equal(result.record.execution.order_submitted, false);
});

test("an explicitly requested View-only preflight never falls back to simulation", async () => {
  const plan = await createExecutionPlan(INTENT);
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    viewOnlyRequested: true,
    nonce: "session-source-missing",
    history: { enabled: false },
  });

  assert.equal(result.record.guard_mode, "view_only_preflight");
  assert.equal(result.record.decision, "REVIEW");
  assert.equal(
    result.record.failure.code,
    "VIEW_ONLY_SESSION_NOT_CONNECTED",
  );
  assert.equal(result.record.artifact_class, "PROBE");
  assert.equal(result.record.boundary.dry_run, false);
  assert.equal(result.record.boundary.coinbase_contacted, false);
});

test("a permission-check failure becomes a bound REVIEW rather than a dry run", async () => {
  const plan = await createExecutionPlan(INTENT);
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    viewOnlyRequested: true,
    viewCredentialError: reviewError(
      "VIEW_ONLY_PERMISSION_RATE_LIMITED",
      "Coinbase permission check was rate limited",
      {
        stage: "VIEW_ONLY_CREDENTIAL",
        retryable: true,
        httpStatus: 429,
      },
    ),
    nonce: "session-permission-review",
    history: { enabled: false },
  });

  assert.equal(result.record.guard_mode, "view_only_preflight");
  assert.equal(result.record.decision, "REVIEW");
  assert.equal(
    result.record.failure.code,
    "VIEW_ONLY_PERMISSION_RATE_LIMITED",
  );
  assert.equal(result.record.failure.http_status, 429);
  assert.equal(result.record.boundary.coinbase_contacted, true);
  assert.equal(result.record.guard_receipt.decision.outcome, "REVIEW");
});
