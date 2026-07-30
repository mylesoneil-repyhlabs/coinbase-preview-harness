import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCoinbaseViewOnlyPreflightAdapter } from "../src/coinbase-rest.js";
import {
  assertReceiptActiveInHistory,
  createHistoryEntry,
  readHistory,
  writeHistoryEntry,
} from "../src/dry-run-history.js";
import { digest } from "../src/evidence.js";
import { evaluateExecutionPreview } from "../src/execution-policy.js";
import {
  runBuiltInSimulation,
} from "../src/execution-pipeline.js";
import { verifyGuardReceipt } from "../src/guard-receipt.js";
import { createExecutionPlan } from "../src/plan.js";
import { runGuardPreflight } from "../src/preflight.js";

const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 250 USDC to buy SOL on SOL-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 40 bps above Coinbase's fresh best ask, more than 2 USDC in commission, or more than 252 USDC total. This authorization expires 2 minutes after I confirm it.";

async function temporaryHistory(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delta-guard-security-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function repairRecordDigest(record) {
  const { record_digest: _oldDigest, ...payload } = record;
  return { ...payload, record_digest: digest(payload) };
}

function viewVerification(seed) {
  return {
    attestation: {
      can_view: true,
      can_trade: false,
      can_transfer: false,
      can_receive: false,
      jwt_profile: "CDP_URIS_V1",
      portfolio_fingerprint: digest(`portfolio-${seed}`),
      key_fingerprint: digest(`credential-${seed}`),
    },
    credentials: {
      keyId: `organizations/example/apiKeys/${seed}`,
      privateKey: "ephemeral-test-value",
    },
  };
}

test("receipt verification derives every exact binding and rejects underlying mutation", async () => {
  const plan = await createExecutionPlan(INTENT);
  const record = await runBuiltInSimulation(
    plan,
    plan.policy_digest,
    { preflightNonce: "security-binding-nonce" },
  );
  assert.equal(
    verifyGuardReceipt(record.guard_receipt, record).verified,
    true,
  );

  const mutations = [
    {
      name: "policy",
      apply(value) {
        value.policy.limits.max_slippage_bps += 1;
      },
    },
    {
      name: "proposal",
      apply(value) {
        value.proposal.action.limit_price = "999999";
      },
    },
    {
      name: "evidence",
      apply(value) {
        value.preview.evidence.commission_total = "1";
      },
    },
    {
      name: "Preview request",
      apply(value) {
        value.preview.request_digest = digest("forged-request");
      },
    },
    {
      name: "prospective Create",
      apply(value) {
        value.execution.client_order_id = "forged-client-order";
      },
    },
    {
      name: "preflight",
      apply(value) {
        value.sources.best_bid_ask.observed_at =
          "2026-07-30T00:00:00.000Z";
      },
    },
    {
      name: "decision",
      apply(value) {
        value.status = "BLOCK";
        value.decision = "BLOCK";
      },
    },
  ];
  for (const mutation of mutations) {
    const changed = structuredClone(record);
    mutation.apply(changed);
    assert.throws(
      () =>
        verifyGuardReceipt(
          record.guard_receipt,
          repairRecordDigest(changed),
        ),
      /no longer matches|integrity/i,
      mutation.name,
    );
  }
});

test("confirmation is revalidated before an exact nonce replay", async (t) => {
  const directory = await temporaryHistory(t);
  const plan = await createExecutionPlan(INTENT);
  const nonce = "confirmation-before-replay";
  const first = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    nonce,
    history: { directory },
  });
  assert.equal(first.record.decision, "PASS");

  const invalid = await runGuardPreflight({
    plan,
    confirmPolicyDigest: digest("not-authorized"),
    nonce,
    history: { directory },
  });
  assert.equal(invalid.replayed, false);
  assert.equal(invalid.record.decision, "BLOCK");
  assert.equal(
    invalid.record.failure.code,
    "POLICY_CONFIRMATION_MISMATCH",
  );
  assert.match(
    invalid.record.guard_receipt.bindings.authorization_digest,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    verifyGuardReceipt(
      invalid.record.guard_receipt,
      invalid.record,
    ).verified,
    true,
  );
  const validRetry = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    nonce,
    history: { directory },
  });
  assert.equal(validRetry.replayed, true);
});

test("an invalid retry nonce is a typed local BLOCK before any provider contact", async () => {
  const plan = await createExecutionPlan(INTENT);
  let credentialChecks = 0;
  let pipelineRuns = 0;
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    viewKeyFile: "/external/ephemeral.json",
    nonce: "short",
    history: { enabled: false },
    verifyViewCredentials: async () => {
      credentialChecks += 1;
      return viewVerification("must-not-run");
    },
    runPipeline: async () => {
      pipelineRuns += 1;
      throw new Error("must not run");
    },
  });

  assert.equal(result.replayed, false);
  assert.equal(result.record.decision, "BLOCK");
  assert.equal(result.record.failure.code, "NONCE_INVALID");
  assert.equal(result.record.boundary.coinbase_contacted, false);
  assert.equal(result.record.execution.adapter_invoked, false);
  assert.equal(result.record.execution.order_submitted, false);
  assert.equal(credentialChecks, 0);
  assert.equal(pipelineRuns, 0);
  assert.equal(JSON.stringify(result.record).includes("short"), false);
});

test("nonce reuse across a different plan is a deterministic BLOCK", async (t) => {
  const directory = await temporaryHistory(t);
  const plan = await createExecutionPlan(INTENT);
  const nonce = "plan-bound-nonce-security";
  await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    nonce,
    history: { directory },
  });
  const changed = structuredClone(plan);
  changed.plan_id = "different-plan-id";
  const mismatch = await runGuardPreflight({
    plan: changed,
    confirmPolicyDigest: changed.policy_digest,
    nonce,
    history: { directory },
  });
  assert.equal(mismatch.record.decision, "BLOCK");
  assert.equal(mismatch.record.failure.code, "NONCE_REUSE_MISMATCH");
  assert.equal(mismatch.record.execution.order_submitted, false);
});

test("View-only nonce binds verified credential and portfolio fingerprints", async (t) => {
  const directory = await temporaryHistory(t);
  const plan = await createExecutionPlan(INTENT);
  const nonce = "view-credential-bound-nonce";
  const common = {
    plan,
    confirmPolicyDigest: plan.policy_digest,
    viewKeyFile: "/external/ephemeral.json",
    nonce,
    history: { directory },
    createViewAdapter: () => ({}),
    loadCapabilityProfile: async () => ({}),
    runPipeline: async () => {
      throw new Error("provider unavailable");
    },
  };
  const first = await runGuardPreflight({
    ...common,
    verifyViewCredentials: async () => viewVerification("a"),
  });
  assert.equal(first.record.decision, "REVIEW");

  const mismatch = await runGuardPreflight({
    ...common,
    verifyViewCredentials: async () => viewVerification("b"),
  });
  assert.equal(mismatch.record.decision, "BLOCK");
  assert.equal(mismatch.record.failure.code, "NONCE_REUSE_MISMATCH");
});

test("two concurrent identical nonces produce one run and one replay", async (t) => {
  const directory = await temporaryHistory(t);
  const plan = await createExecutionPlan(INTENT);
  const input = {
    plan,
    confirmPolicyDigest: plan.policy_digest,
    nonce: "atomic-concurrent-nonce",
    history: { directory },
  };
  const [left, right] = await Promise.all([
    runGuardPreflight(input),
    runGuardPreflight(input),
  ]);
  assert.deepEqual(
    [left.replayed, right.replayed].sort(),
    [false, true],
  );
  assert.equal((await readHistory({ directory, limit: 10 })).length, 1);
});

test("history reads reject permissive directories and files", async (t) => {
  const directory = await temporaryHistory(t);
  const plan = await createExecutionPlan(INTENT);
  const record = await runBuiltInSimulation(
    plan,
    plan.policy_digest,
    { preflightNonce: "private-history-nonce" },
  );
  await writeHistoryEntry(
    createHistoryEntry(record, record.guard_receipt),
    { directory },
  );
  const [file] = (await readdir(directory)).filter((name) =>
    name.endsWith(".json"),
  );

  await chmod(path.join(directory, file), 0o644);
  await assert.rejects(
    readHistory({ directory, limit: 10 }),
    /permissions must be 600/i,
  );
  await chmod(path.join(directory, file), 0o600);
  await chmod(directory, 0o755);
  await assert.rejects(
    readHistory({ directory, limit: 10 }),
    /permissions must be 700/i,
  );
  await chmod(directory, 0o700);
});

test("receipt currency enforces expiry and exact-evidence supersession", async (t) => {
  const directory = await temporaryHistory(t);
  const plan = await createExecutionPlan(INTENT);
  const firstRecord = await runBuiltInSimulation(
    plan,
    plan.policy_digest,
    { preflightNonce: "supersession-first" },
  );
  await writeHistoryEntry(
    createHistoryEntry(firstRecord, firstRecord.guard_receipt),
    { directory },
  );
  let entries = await readHistory({ directory, limit: 10 });
  assert.throws(
    () =>
      assertReceiptActiveInHistory(
        firstRecord.guard_receipt,
        entries,
        { now: new Date(firstRecord.guard_receipt.expires_at) },
      ),
    /expired/i,
  );

  const secondRecord = await runBuiltInSimulation(
    plan,
    plan.policy_digest,
    { preflightNonce: "supersession-second" },
  );
  await writeHistoryEntry(
    createHistoryEntry(secondRecord, secondRecord.guard_receipt),
    { directory },
  );
  entries = await readHistory({ directory, limit: 10 });
  assert.throws(
    () =>
      assertReceiptActiveInHistory(
        firstRecord.guard_receipt,
        entries,
        { now: new Date(firstRecord.guard_receipt.issued_at) },
      ),
    /superseded/i,
  );
});

test("Preview BBO drift is unable-to-verify REVIEW, not a policy BLOCK", async () => {
  const plan = await createExecutionPlan(INTENT);
  const record = await runBuiltInSimulation(
    plan,
    plan.policy_digest,
    { preflightNonce: "bbo-drift-review-nonce" },
  );
  const preview = structuredClone(record.preview.evidence);
  preview.best_bid = "1";
  preview.best_ask = "2";
  const result = evaluateExecutionPreview(
    record.policy,
    record.proposal.action,
    record.market,
    preview,
  );
  assert.equal(result.decision, "REVIEW");
  assert.ok(
    result.failures.some(
      (failure) => failure.code === "PREVIEW_BBO_DRIFT",
    ),
  );
});

test("provider errors retain typed status but discard arbitrary provider identifiers", async () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const credentials = {
    keyId: "organizations/example/apiKeys/view-only",
    privateKey: privateKey.export({
      type: "sec1",
      format: "pem",
    }),
  };
  const sentinel = "tenant-secret-identifier-9348";
  const adapter = createCoinbaseViewOnlyPreflightAdapter(credentials, {
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({ message: `rate limit for ${sentinel}` }),
    }),
  });
  await assert.rejects(
    adapter.listAccounts(),
    (error) => {
      assert.equal(error.code, "COINBASE_RATE_LIMITED");
      assert.equal(error.httpStatus, 429);
      assert.equal(error.message.includes(sentinel), false);
      return true;
    },
  );
});

test("local credential failures have truthful provenance and redact local identifiers", async () => {
  const plan = await createExecutionPlan(INTENT);
  const sentinel = "/private/users/alice/credential-secret.json";
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    viewKeyFile: sentinel,
    nonce: "local-credential-failure",
    history: { enabled: false },
    verifyViewCredentials: async () => {
      throw new Error(`ENOENT ${sentinel}`);
    },
  });
  assert.equal(
    result.record.guard_receipt.provenance.source,
    "LOCAL_GUARD_ONLY",
  );
  assert.equal(
    result.record.guard_receipt.provenance.coinbase_contacted,
    false,
  );
  assert.equal(JSON.stringify(result.record).includes(sentinel), false);
  assert.match(
    result.record.guard_receipt.bindings.authorization_digest,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    verifyGuardReceipt(
      result.record.guard_receipt,
      result.record,
    ).verified,
    true,
  );
});
