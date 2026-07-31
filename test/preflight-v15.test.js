import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBoundExecution } from "../src/execution-binding.js";
import { createExecutionConfirmation } from "../src/execution-confirmation.js";
import {
  evaluateExecutionProposal,
} from "../src/execution-policy.js";
import { digest, digestBytes } from "../src/evidence.js";
import {
  createHistoryEntry,
  assertReceiptActiveInHistory,
  readHistory,
  writeHistoryEntry,
} from "../src/dry-run-history.js";
import {
  createGuardReceipt,
  GUARD_MODES,
  verifyGuardReceipt,
} from "../src/guard-receipt.js";
import {
  runBuiltInSimulation,
  runExecutionPipeline,
} from "../src/execution-pipeline.js";
import {
  createCoinbaseExecutionAdapter,
} from "../src/coinbase-rest.js";
import {
  formatGuardResult,
} from "../src/preflight-presentation.js";
import { runGuardPreflight } from "../src/preflight.js";
import {
  createExecutionPlan,
  loadPreviewCapabilityProfile,
} from "../src/plan.js";

const BUY_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 250 USDC to buy SOL on SOL-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 40 bps above Coinbase's fresh best ask, more than 2 USDC in commission, or more than 252 USDC total. This authorization expires 2 minutes after I confirm it.";
const SECOND_BUY_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 100 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 40 bps above Coinbase's fresh best ask, more than 1 USDC in commission, or more than 101 USDC total. This authorization expires 2 minutes after I confirm it.";
const FIXED = new Date("2026-07-30T16:00:00.000Z");
const PREVIEW_PATH = "/api/v3/brokerage/orders/preview";
const PRIVATE_KEY_SENTINEL = [
  "-----BEGIN ",
  "EC PRIVATE KEY-----\n",
  "TOP-SECRET-TEST-SENTINEL\n",
  "-----END ",
  "EC PRIVATE KEY-----",
].join("");
const KEY_ID_SENTINEL =
  "organizations/secret-org/apiKeys/secret-key";

function viewAttestation() {
  return {
    can_view: true,
    can_trade: false,
    can_transfer: false,
    can_receive: false,
    jwt_profile: "CDP_URIS_V1",
    portfolio_fingerprint: digest("portfolio-1"),
    key_fingerprint: digest("view-only-key"),
  };
}

function productResponse(productId = "SOL-USDC") {
  const [base, quote] = productId.split("-");
  return {
    product_id: productId,
    product_type: "SPOT",
    status: "online",
    base_currency_id: base,
    quote_currency_id: quote,
    base_increment: "0.00000001",
    quote_increment: "0.01",
    price_increment: "0.01",
    base_min_size: "0.001",
    base_max_size: "1000000",
    quote_min_size: "1",
    quote_max_size: "1000000",
    is_disabled: false,
    trading_disabled: false,
    view_only: false,
    cancel_only: false,
    limit_only: false,
    post_only: false,
    auction_mode: false,
  };
}

function bboResponse(
  productId = "SOL-USDC",
  observedAt = FIXED.toISOString(),
) {
  return {
    pricebooks: [
      {
        product_id: productId,
        bids: [{ price: "149.90", size: "10" }],
        asks: [{ price: "150.00", size: "10" }],
        time: observedAt,
      },
    ],
  };
}

function accountsResponse({ available = "500", hasNext = false } = {}) {
  return {
    accounts: [
      {
        uuid: "account-usdc-sensitive-id",
        currency: "USDC",
        available_balance: { currency: "USDC", value: available },
        active: true,
        ready: true,
        deleted_at: null,
        platform: "ACCOUNT_PLATFORM_CONSUMER",
        retail_portfolio_id: "portfolio-1",
      },
    ],
    has_next: hasNext,
    cursor: hasNext ? "next-page" : null,
  };
}

function previewResponse(request, { previewId = "preview-v15-1" } = {}) {
  return {
    response: {
      order_total: "251",
      commission_total: "1",
      quote_size:
        request.order_configuration.sor_limit_ioc.quote_size,
      base_size: "1.66223404",
      est_average_filled_price: "150.40",
      best_bid: "149.90",
      best_ask: "150.00",
      preview_id: previewId,
      errs: [],
      warning: [],
    },
    transport: {
      method: "POST",
      host: "api.coinbase.com",
      path: PREVIEW_PATH,
      sent_body_digest: digestBytes(JSON.stringify(request)),
    },
  };
}

async function pipelineFixture(
  attestation = viewAttestation(),
) {
  const plan = await createExecutionPlan(BUY_INTENT);
  const capabilityProfile = await loadPreviewCapabilityProfile();
  const boundExecution = createBoundExecution(
    plan,
    attestation,
    plan.policy_digest,
  );
  const executionConfirmation = createExecutionConfirmation({
    boundExecution,
    attestation,
    confirmedExecutionDigest: boundExecution.execution_digest,
    confirmedAt: FIXED,
  });
  const calls = {
    accounts: 0,
    product: 0,
    bbo: 0,
    preview: 0,
    create: 0,
  };
  const args = {
    mode: "PROBE",
    plan,
    confirmPolicyDigest: plan.policy_digest,
    boundExecution,
    executionConfirmation,
    capabilityProfile,
    attestation,
    now: () => new Date(FIXED),
    listAccounts: async () => {
      calls.accounts += 1;
      return accountsResponse();
    },
    getProduct: async (productId) => {
      calls.product += 1;
      return productResponse(productId);
    },
    getBestBidAsk: async (productId) => {
      calls.bbo += 1;
      return bboResponse(productId);
    },
    previewAdapter: async (request) => {
      calls.preview += 1;
      return previewResponse(request);
    },
    createAdapter: async () => {
      calls.create += 1;
      throw new Error("Create must never run in View-only preflight");
    },
    preflightNonce: "probe-nonce-v15-default",
  };
  return { args, calls, plan };
}

async function tempHistory(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delta-v15-history-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function assertLockedBoundary(record, expectedMode) {
  assert.equal(record.guard_receipt.mode, expectedMode);
  assert.equal(record.execution.adapter_invoked, false);
  assert.equal(record.execution.order_submitted, false);
  assert.equal(record.boundary.create_available, false);
  assert.equal(record.boundary.no_order_submitted, true);
  assert.equal(record.boundary.money_moved, false);
  assert.equal(record.guard_receipt.execution_boundary.create_available, false);
  assert.equal(record.guard_receipt.execution_boundary.order_submitted, false);
  assert.equal(record.guard_receipt.execution_boundary.money_moved, false);
}

test("credential-free dry run reaches a labeled PASS with no Coinbase or Create", async () => {
  const plan = await createExecutionPlan(BUY_INTENT);
  const progress = [];
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    nonce: "dry-run-pass-nonce",
    progress: (message) => progress.push(message),
    history: { enabled: false },
  });

  assert.equal(result.replayed, false);
  assert.equal(result.record.decision, "PASS");
  assert.equal(result.record.status, "EXECUTION_ELIGIBLE");
  assert.equal(
    result.record.guard_receipt.provenance.source,
    "SIMULATED_FIXTURE",
  );
  assert.equal(
    result.record.guard_receipt.provenance.coinbase_contacted,
    false,
  );
  assert.equal(result.record.delta.decision, "PASS");
  assertLockedBoundary(result.record, GUARD_MODES.DRY_RUN);
  assert.match(progress[0], /No network; no order can be sent/i);
});

test("View-only PASS is bound to the exact Preview transport body", async () => {
  const { args, calls } = await pipelineFixture();
  const record = await runExecutionPipeline(args);

  assert.equal(record.decision, "PASS");
  assert.equal(record.status, "PREVIEW_PROBE_PASS");
  assert.equal(record.preview_check.decision, "PASS");
  assert.equal(
    record.preview.transport_body_digest,
    record.preview.request_digest,
  );
  assert.match(record.preflight.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(record.guard_receipt.binding_completeness, "COMPLETE");
  assert.equal(record.delta, null);
  assert.deepEqual(calls, {
    accounts: 1,
    product: 1,
    bbo: 1,
    preview: 1,
    create: 0,
  });
  assertLockedBoundary(record, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
});

test("View-only preflight preserves an unreported Receive permission field", async () => {
  const attestation = {
    ...viewAttestation(),
    can_receive: null,
    can_receive_reported: false,
  };
  const { args } = await pipelineFixture(attestation);
  const record = await runExecutionPipeline(args);

  assert.equal(record.decision, "PASS");
  assert.equal(record.status, "PREVIEW_PROBE_PASS");
  assert.equal(attestation.can_receive, null);
  assert.equal(attestation.can_receive_reported, false);
  assertLockedBoundary(
    record,
    GUARD_MODES.VIEW_ONLY_PREFLIGHT,
  );
});

for (const {
  name,
  mutate,
  expectedCode,
  expectedPreviewCalls,
} of [
  {
    name: "missing product",
    mutate: ({ args }) => {
      args.getProduct = async () => null;
    },
    expectedCode: "PRODUCT_RESPONSE_MALFORMED",
    expectedPreviewCalls: 0,
  },
  {
    name: "malformed product schema",
    mutate: ({ args }) => {
      args.getProduct = async () => {
        const product = productResponse();
        delete product.trading_disabled;
        return product;
      };
    },
    expectedCode: "PRODUCT_SCHEMA_MISSING_FLAG",
    expectedPreviewCalls: 0,
  },
  {
    name: "missing BBO",
    mutate: ({ args }) => {
      args.getBestBidAsk = async () => ({ pricebooks: [] });
    },
    expectedCode: "BBO_MISSING",
    expectedPreviewCalls: 0,
  },
  {
    name: "malformed accounts",
    mutate: ({ args }) => {
      args.listAccounts = async () => ({ accounts: "not-an-array" });
    },
    expectedCode: "ACCOUNTS_RESPONSE_INVALID",
    expectedPreviewCalls: 0,
  },
  {
    name: "incomplete accounts pagination",
    mutate: ({ args }) => {
      args.listAccounts = async () =>
        accountsResponse({ hasNext: true });
    },
    expectedCode: "ACCOUNTS_EVIDENCE_INCOMPLETE",
    expectedPreviewCalls: 0,
  },
  {
    name: "missing Preview",
    mutate: ({ args, calls }) => {
      args.previewAdapter = async () => {
        calls.preview += 1;
        return null;
      };
    },
    expectedCode: "INVALID_PREVIEW",
    expectedPreviewCalls: 1,
  },
  {
    name: "malformed Preview warnings",
    mutate: ({ args, calls }) => {
      args.previewAdapter = async (request) => {
        calls.preview += 1;
        const preview = previewResponse(request);
        preview.response.warning = "not-an-array";
        return preview;
      };
    },
    expectedCode: "PREVIEW_WARNINGS_INVALID",
    expectedPreviewCalls: 1,
  },
]) {
  test(`${name} returns REVIEW/unable-to-verify and never Create`, async () => {
    const fixture = await pipelineFixture();
    mutate(fixture);
    const record = await runExecutionPipeline(fixture.args);

    assert.equal(record.decision, "REVIEW");
    assert.equal(record.failure.class, "UNABLE_TO_VERIFY");
    assert.equal(record.failure.code, expectedCode);
    assert.equal(record.failure.retryable, true);
    assert.equal(fixture.calls.preview, expectedPreviewCalls);
    assert.equal(fixture.calls.create, 0);
    assertLockedBoundary(record, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
  });
}

test("stale and future-dated BBO evidence both fail closed to REVIEW", async (t) => {
  for (const [name, observedAt] of [
    ["stale", new Date(FIXED.getTime() - 60_000)],
    ["future", new Date(FIXED.getTime() + 60_000)],
  ]) {
    await t.test(name, async () => {
      const { args, calls } = await pipelineFixture();
      args.getBestBidAsk = async (productId) =>
        bboResponse(productId, observedAt.toISOString());
      const record = await runExecutionPipeline(args);

      assert.equal(record.decision, "REVIEW");
      assert.equal(record.failure.class, "UNABLE_TO_VERIFY");
      assert.match(record.failure.message, /stale|future/i);
      assert.equal(calls.preview, 0);
      assert.equal(calls.create, 0);
      assertLockedBoundary(record, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
    });
  }
});

test("insufficient held funds are a policy BLOCK, not unable-to-verify", async () => {
  const { args, calls } = await pipelineFixture();
  args.listAccounts = async () => accountsResponse({ available: "10" });
  const record = await runExecutionPipeline(args);

  assert.equal(record.decision, "BLOCK");
  assert.equal(record.failure.class, "POLICY_VIOLATION");
  assert.equal(record.failure.code, "INSUFFICIENT_AVAILABLE_BALANCE");
  assert.equal(record.funding.decision, "BLOCK");
  assert.equal(calls.preview, 0);
  assert.equal(calls.create, 0);
  assertLockedBoundary(record, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
});

test("authoritative product unavailability is a policy BLOCK", async () => {
  const { args, calls } = await pipelineFixture();
  args.getProduct = async (productId) => ({
    ...productResponse(productId),
    trading_disabled: true,
  });
  const record = await runExecutionPipeline(args);

  assert.equal(record.decision, "BLOCK");
  assert.equal(record.failure.class, "POLICY_VIOLATION");
  assert.equal(record.failure.code, "PRODUCT_UNAVAILABLE");
  assert.equal(calls.preview, 0);
  assert.equal(calls.create, 0);
  assertLockedBoundary(record, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
});

test("wrong side, size, and extra payload fields deterministically BLOCK", async () => {
  const { args, plan } = await pipelineFixture();
  const passing = await runExecutionPipeline(args);
  const market = passing.market;
  const proposal = passing.proposal.action;

  for (const [name, changed, expectedCode] of [
    [
      "side",
      { ...proposal, side: "SELL", base_size: "1", quote_size: undefined },
      "ORDER_FIELD_SET_MISMATCH",
    ],
    [
      "size",
      { ...proposal, quote_size: "250.01" },
      "SIZE_MISMATCH",
    ],
    [
      "extra field",
      { ...proposal, post_only: true },
      "ORDER_FIELD_SET_MISMATCH",
    ],
  ]) {
    const candidate =
      name === "side"
        ? Object.fromEntries(
            Object.entries(changed).filter(([, value]) => value !== undefined),
          )
        : changed;
    const result = evaluateExecutionProposal(
      plan.policy,
      candidate,
      market,
    );
    assert.equal(result.decision, "BLOCK", name);
    assert.ok(
      result.failures.some(({ code }) => code === expectedCode),
      `${name} should include ${expectedCode}`,
    );
  }
});

test("changed or missing exact Preview transport binding returns REVIEW", async (t) => {
  for (const [name, transform] of [
    [
      "body digest changed",
      (result) => {
        result.transport.sent_body_digest = digestBytes(
          JSON.stringify({ tampered: true }),
        );
      },
    ],
    [
      "method changed",
      (result) => {
        result.transport.method = "GET";
      },
    ],
    [
      "transport omitted",
      (result) => {
        delete result.transport;
      },
    ],
  ]) {
    await t.test(name, async () => {
      const { args, calls } = await pipelineFixture();
      args.previewAdapter = async (request) => {
        calls.preview += 1;
        const result = previewResponse(request);
        transform(result);
        return result;
      };
      const record = await runExecutionPipeline(args);

      assert.equal(record.decision, "REVIEW");
      assert.equal(
        record.failure.code,
        "PREVIEW_TRANSPORT_BINDING_MISMATCH",
      );
      assert.equal(record.preflight.fingerprint, null);
      assert.equal(calls.create, 0);
      assertLockedBoundary(record, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
    });
  }
});

for (const {
  name,
  status,
  expectedCode,
  retryable,
} of [
  {
    name: "rate limit",
    status: 429,
    expectedCode: "PRODUCT_RATE_LIMITED",
    retryable: true,
  },
  {
    name: "revoked or malformed credential",
    status: 401,
    expectedCode: "PRODUCT_CREDENTIAL_REJECTED",
    retryable: false,
  },
  {
    name: "Coinbase outage",
    status: 503,
    expectedCode: "PRODUCT_UNAVAILABLE",
    retryable: true,
  },
]) {
  test(`${name} is a typed REVIEW with a retry boundary and no Preview/Create`, async () => {
    const { args, calls } = await pipelineFixture();
    args.getProduct = async () => {
      const error = new Error(`${name} test sentinel`);
      error.httpStatus = status;
      throw error;
    };
    const record = await runExecutionPipeline(args);

    assert.equal(record.decision, "REVIEW");
    assert.equal(record.failure.class, "UNABLE_TO_VERIFY");
    assert.equal(record.failure.code, expectedCode);
    assert.equal(record.failure.http_status, status);
    assert.equal(record.failure.retryable, retryable);
    assert.equal(calls.preview, 0);
    assert.equal(calls.create, 0);
    assertLockedBoundary(record, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
  });
}

test("partial concurrent source failure does not reuse the successful evidence", async () => {
  const { args, calls } = await pipelineFixture();
  args.getProduct = async (productId) => {
    calls.product += 1;
    return productResponse(productId);
  };
  args.getBestBidAsk = async () => {
    calls.bbo += 1;
    throw new Error("upstream connection reset");
  };
  const record = await runExecutionPipeline(args);

  assert.equal(record.decision, "REVIEW");
  assert.equal(record.failure.code, "BEST_BID_ASK_UNAVAILABLE");
  assert.equal(record.market, null);
  assert.equal(record.proposal, null);
  assert.equal(record.preview, null);
  assert.equal(calls.preview, 0);
  assert.equal(calls.create, 0);
});

test("receipt verifies exact bindings and rejects receipt or record mutation", async () => {
  const { args } = await pipelineFixture();
  const record = await runExecutionPipeline(args);
  const verified = verifyGuardReceipt(record.guard_receipt, record);
  assert.equal(verified.verified, true);
  assert.equal(
    verified.preflight_fingerprint,
    record.preflight.fingerprint,
  );

  const changedReceipt = structuredClone(record.guard_receipt);
  changedReceipt.decision.reason = "tampered decision";
  assert.throws(
    () => verifyGuardReceipt(changedReceipt, record),
    /integrity check failed/i,
  );

  const changedRecord = structuredClone(record);
  changedRecord.preview.evidence_digest = digest("changed evidence");
  assert.throws(
    () => verifyGuardReceipt(record.guard_receipt, changedRecord),
    /evidence_digest no longer matches/i,
  );
});

test("an old receipt cannot verify a changed Preview fingerprint", async () => {
  const firstFixture = await pipelineFixture();
  const first = await runExecutionPipeline(firstFixture.args);
  const secondFixture = await pipelineFixture();
  secondFixture.args.preflightNonce = "probe-nonce-v15-second";
  secondFixture.args.previewAdapter = async (request) =>
    previewResponse(request, { previewId: "preview-v15-changed" });
  const second = await runExecutionPipeline(secondFixture.args);

  assert.notEqual(
    first.preflight.fingerprint,
    second.preflight.fingerprint,
  );
  assert.notEqual(
    first.preview.response_fingerprint,
    second.preview.response_fingerprint,
  );
  assert.throws(
    () => verifyGuardReceipt(first.guard_receipt, second),
    /no longer matches/i,
  );
});

test("exact nonce retry returns prior history; changed semantics cannot reuse it", async (t) => {
  const directory = await tempHistory(t);
  const plan = await createExecutionPlan(BUY_INTENT);
  const nonce = "stable-retry-nonce-v15";
  const first = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    nonce,
    history: { directory },
  });
  const retry = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    nonce,
    history: { directory },
  });

  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.record, null);
  assert.equal(
    retry.history_entry.receipt.receipt_digest,
    first.record.guard_receipt.receipt_digest,
  );

  const changedPlan = await createExecutionPlan(SECOND_BUY_INTENT);
  const mismatched = await runGuardPreflight({
    plan: changedPlan,
    confirmPolicyDigest: changedPlan.policy_digest,
    nonce,
    history: { directory },
  });
  assert.equal(mismatched.replayed, false);
  assert.equal(mismatched.record.decision, "BLOCK");
  assert.equal(
    mismatched.record.failure.code,
    "NONCE_REUSE_MISMATCH",
  );
  assert.equal(mismatched.record.execution.order_submitted, false);
});

test("View-only retry rechecks permissions but does not reread evidence", async (t) => {
  const directory = await tempHistory(t);
  const { args } = await pipelineFixture();
  const plan = args.plan;
  const nonce = "view-retry-permission-recheck";
  let credentialChecks = 0;
  let pipelineRuns = 0;
  const common = {
    plan,
    confirmPolicyDigest: plan.policy_digest,
    viewKeyFile: "/external/ephemeral-view-key.json",
    nonce,
    now: () => new Date(FIXED),
    history: { directory },
    verifyViewCredentials: async () => {
      credentialChecks += 1;
      return {
        attestation: viewAttestation(),
        credentials: {
          keyId: KEY_ID_SENTINEL,
          privateKey: PRIVATE_KEY_SENTINEL,
        },
      };
    },
    createViewAdapter: () => ({}),
    loadCapabilityProfile: async () => ({}),
    runPipeline: async (input) => {
      pipelineRuns += 1;
      return runExecutionPipeline({
        ...args,
        preflightNonce: input.preflightNonce,
      });
    },
  };

  const first = await runGuardPreflight(common);
  const retry = await runGuardPreflight(common);

  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.equal(credentialChecks, 2);
  assert.equal(pipelineRuns, 1);
  assert.equal(
    retry.history_entry.receipt.receipt_digest,
    first.record.guard_receipt.receipt_digest,
  );
  assert.equal(
    JSON.stringify(retry).includes(PRIVATE_KEY_SENTINEL),
    false,
  );

  const cli = await readFile(
    new URL("../src/cli.js", import.meta.url),
    "utf8",
  );
  assert.match(cli, /VIEW-ONLY PERMISSION RECHECKED/);
  assert.match(
    cli,
    /NO NEW ACCOUNT, PRODUCT, BBO, OR PREVIEW REQUEST/,
  );
  assert.doesNotMatch(cli, /NO NEW COINBASE REQUEST/);
});

test("history is redacted, versioned, and supersedes changed exact evidence", async (t) => {
  const directory = await tempHistory(t);
  const { args } = await pipelineFixture();
  const firstRecord = await runExecutionPipeline(args);
  const firstEntry = createHistoryEntry(
    firstRecord,
    firstRecord.guard_receipt,
    { now: FIXED },
  );
  const firstWritten = await writeHistoryEntry(firstEntry, { directory });

  const { args: changedArgs } = await pipelineFixture();
  changedArgs.preflightNonce = "history-second-nonce";
  changedArgs.previewAdapter = async (request) =>
    previewResponse(request, { previewId: "preview-history-new" });
  const secondRecord = await runExecutionPipeline(changedArgs);
  const secondEntry = createHistoryEntry(
    secondRecord,
    secondRecord.guard_receipt,
    { now: new Date(FIXED.getTime() + 1_000) },
  );
  const secondWritten = await writeHistoryEntry(secondEntry, { directory });

  assert.equal(
    secondWritten.entry.supersedes_receipt_digest,
    firstRecord.guard_receipt.receipt_digest,
  );
  const entries = await readHistory({ directory, limit: 10 });
  assert.equal(entries.length, 2);
  const currentHistoryTime = new Date(FIXED.getTime() + 2_000);
  assert.throws(
    () =>
      assertReceiptActiveInHistory(
        firstRecord.guard_receipt,
        entries,
        { now: currentHistoryTime },
      ),
    /superseded/i,
  );
  assert.equal(
    assertReceiptActiveInHistory(
      secondRecord.guard_receipt,
      entries,
      { now: currentHistoryTime },
    ),
    true,
  );

  const filenames = await readdir(directory);
  const raw = (
    await Promise.all(
      filenames.map((name) =>
        readFile(path.join(directory, name), "utf8"),
      ),
    )
  ).join("\n");
  for (const forbidden of [
    PRIVATE_KEY_SENTINEL,
    KEY_ID_SENTINEL,
    "account-usdc-sensitive-id",
    "portfolio-1",
    "Authorization",
    "Bearer ",
  ]) {
    assert.equal(
      raw.includes(forbidden),
      false,
      `history leaked ${forbidden}`,
    );
  }
  assert.match(raw, /delta\.coinbase\.dry_run_history\.v1/);
  assert.equal(
    firstWritten.entry.boundary.no_order_submitted,
    true,
  );
});

test("compact result keeps raw hashes hidden until details are requested", async () => {
  const plan = await createExecutionPlan(BUY_INTENT);
  const record = await runBuiltInSimulation(
    plan,
    plan.policy_digest,
    { preflightNonce: "compact-output-nonce-v15" },
  );
  const compact = formatGuardResult(record);
  const details = formatGuardResult(record, { details: true });

  assert.match(compact, /DRY RUN .* NO ORDER SUBMITTED/);
  assert.match(compact, /Mandate captured/);
  assert.match(compact, /PASS — /);
  assert.match(compact, /Ask for details to see hashes/i);
  for (const rawDigest of [
    record.policy_digest,
    record.proposal.proposal_digest,
    record.preflight.fingerprint,
    record.guard_receipt.receipt_digest,
    record.record_digest,
  ]) {
    assert.equal(compact.includes(rawDigest), false);
    assert.equal(details.includes(rawDigest), true);
  }
});

test("guard receipt binds policy, proposal, evidence, decision, nonce, and mode", async () => {
  const { args } = await pipelineFixture();
  const record = await runExecutionPipeline(args);
  const receipt = createGuardReceipt(record, {
    mode: GUARD_MODES.VIEW_ONLY_PREFLIGHT,
    nonce: "explicit-receipt-nonce-v15",
    issuedAt: FIXED,
    receiptId: "receipt-v15-contract",
  });

  assert.equal(receipt.schema_version, "delta.coinbase.guard_receipt.v1");
  assert.equal(receipt.mode, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
  assert.equal(receipt.decision.outcome, "PASS");
  for (const value of [
    receipt.bindings.policy_digest,
    receipt.bindings.proposal_digest,
    receipt.bindings.evidence_digest,
    receipt.bindings.preview_request_digest,
    receipt.bindings.create_payload_digest,
    receipt.bindings.preflight_fingerprint,
    receipt.decision.decision_digest,
    receipt.nonce_digest,
    receipt.receipt_digest,
  ]) {
    assert.match(value, /^[a-f0-9]{64}$/);
  }
  assert.match(receipt.execution_boundary.statement, /Create is unavailable/);
  assert.match(receipt.proof_limit, /not a production Delta signature/i);
});

test("checked-in public build exposes no usable Coinbase Create path", async () => {
  let fetchCalls = 0;
  assert.throws(
    () =>
      createCoinbaseExecutionAdapter(
        {
          keyId: KEY_ID_SENTINEL,
          privateKey: PRIVATE_KEY_SENTINEL,
        },
        Symbol("forged"),
        {
          fetchImpl: async () => {
            fetchCalls += 1;
            throw new Error("network must never be reached");
          },
        },
      ),
    /ENGINEERING_INTEGRATION_REQUIRED/,
  );
  assert.equal(fetchCalls, 0);

  const { args, calls } = await pipelineFixture();
  const record = await runExecutionPipeline(args);
  assert.equal(calls.create, 0);
  assertLockedBoundary(record, GUARD_MODES.VIEW_ONLY_PREFLIGHT);
});
