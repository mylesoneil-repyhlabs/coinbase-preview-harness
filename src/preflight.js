import { randomUUID } from "node:crypto";
import { createCoinbaseViewOnlyPreflightAdapter } from "./coinbase-rest.js";
import { createBoundExecution } from "./execution-binding.js";
import { createExecutionConfirmation } from "./execution-confirmation.js";
import {
  runBuiltInSimulation,
  runExecutionPipeline,
} from "./execution-pipeline.js";
import {
  assertReceiptActiveInHistory,
  claimNonce,
  completeNonceClaim,
  createHistoryEntry,
  readHistory,
  waitForNonceResult,
  writeHistoryEntry,
} from "./dry-run-history.js";
import { digest } from "./evidence.js";
import {
  createGuardReceipt,
  GUARD_MODES,
} from "./guard-receipt.js";
import {
  blockError,
  GuardDecisionError,
  reviewError,
  toGuardReviewError,
} from "./guard-errors.js";
import { loadPreviewCapabilityProfile } from "./plan.js";
import { verifyViewKeyFileAndConfigure } from "./permissions.js";
import { sanitize } from "./sanitize.js";

function validatePlanConfirmation(plan, suppliedDigest) {
  if (
    plan?.schema_version !== "delta.coinbase.execution_plan.v3" ||
    plan?.status !== "AWAITING_HUMAN_CONFIRMATION" ||
    digest(plan?.policy) !== plan?.policy_digest
  ) {
    throw blockError(
      "PLAN_INTEGRITY_INVALID",
      "The saved plan is not a valid confirmation-ready mandate",
    );
  }
  if (suppliedDigest !== plan.policy_digest) {
    throw blockError(
      "POLICY_CONFIRMATION_MISMATCH",
      "The confirmation does not match the displayed mandate",
      {
        recovery:
          "Review and confirm the currently displayed mandate. No service was contacted and no order was submitted.",
      },
    );
  }
}

function failedPreflightRecord(
  plan,
  error,
  {
    mode,
    nonce,
    now = new Date(),
    coinbaseContacted = false,
    redactMessage = false,
    confirmPolicyDigest = null,
    confirmationMatched = false,
    credentialBinding = null,
  },
) {
  const typed =
    error instanceof GuardDecisionError
      ? error
      : toGuardReviewError(error, "VIEW_ONLY_PREFLIGHT");
  const providerFailure =
    /^(COINBASE|VIEW_ONLY_PERMISSION|PREVIEW|PRODUCT|ACCOUNTS|BEST_BID_ASK)_/.test(
      typed.code,
    );
  const safeFailureMessage =
    redactMessage || providerFailure
      ? typed.code.startsWith("VIEW_ONLY_PERMISSION")
        ? "Coinbase could not verify a safe View-only permission scope"
        : "Required Coinbase View-only evidence could not be verified"
      : sanitize(typed.message);
  const record = {
    schema_version: "delta.coinbase.execution_record.v3",
    artifact_class:
      mode === GUARD_MODES.DRY_RUN ? "SIMULATED" : "PROBE",
    guard_mode: mode,
    generated_at: now.toISOString(),
    status: typed.decision,
    decision: typed.decision,
    source_intent_digest: plan?.source_intent?.digest ?? null,
    policy: plan?.policy ?? null,
    policy_digest: plan?.policy_digest ?? null,
    action_descriptor: plan?.action_descriptor ?? null,
    confirmation: {
      supplied_digest: confirmPolicyDigest,
      matched: confirmationMatched,
      policy_expires_at: null,
    },
    credential_binding: credentialBinding,
    market: null,
    funding: null,
    sources: {
      accounts: null,
      product: null,
      best_bid_ask: null,
      preview: null,
    },
    proposal: null,
    proposal_check: null,
    preview: null,
    preview_check: null,
    delta: null,
    execution: {
      adapter_invoked: false,
      order_submitted: false,
      create_payload_digest: null,
      one_time_gate_consumed: false,
    },
    preflight: {
      schema_version: "delta.coinbase.preflight_binding.v1",
      nonce_digest: digest(nonce),
      fingerprint: digest({
        schema_version: "delta.coinbase.preflight_binding.v1",
        mode,
        nonce_digest: digest(nonce),
        policy_digest: plan?.policy_digest ?? null,
        failure_code: typed.code,
      }),
      expires_at: now.toISOString(),
      supersedes: null,
    },
    boundary: {
      mode,
      view_only: mode === GUARD_MODES.VIEW_ONLY_PREFLIGHT,
      dry_run: mode === GUARD_MODES.DRY_RUN,
      create_available: false,
      no_order_submitted: true,
      money_moved: false,
      coinbase_contacted: coinbaseContacted,
      preview_is_not_execution_or_price_guarantee: true,
    },
    failure: {
      stage: typed.stage,
      code: typed.code,
      class:
        typed.decision === "BLOCK"
          ? "POLICY_VIOLATION"
          : "UNABLE_TO_VERIFY",
      message: safeFailureMessage,
      recovery: typed.recovery,
      retryable: typed.retryable,
      http_status: typed.httpStatus,
    },
  };
  const receipt = createGuardReceipt(record, {
    mode,
    nonce,
    issuedAt: now,
  });
  const safe = sanitize({
    ...record,
    guard_receipt: receipt,
  });
  return { ...safe, record_digest: digest(safe) };
}

async function withProgress(
  progress,
  message,
  operation,
  { heartbeatMs = 2_000 } = {},
) {
  progress(message);
  const timer = setInterval(
    () => progress(`${message} Still working; Create remains unavailable.`),
    heartbeatMs,
  );
  timer.unref();
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}

async function persistHistory(record, receipt, historyOptions) {
  if (historyOptions?.enabled === false) return null;
  const entry = createHistoryEntry(record, receipt, {
    semanticDigest: historyOptions?.semanticDigest ?? null,
  });
  return writeHistoryEntry(entry, {
    directory: historyOptions?.directory,
  });
}

function preflightSemanticDigest({
  plan,
  confirmPolicyDigest,
  mode,
  attestation = null,
}) {
  return digest({
    schema_version: "delta.coinbase.preflight_semantics.v1",
    mode,
    plan_digest: digest(plan),
    source_intent_digest: plan?.source_intent?.digest ?? null,
    policy_digest: plan?.policy_digest ?? null,
    confirmed_policy_digest: confirmPolicyDigest ?? null,
    credential_binding:
      mode === GUARD_MODES.VIEW_ONLY_PREFLIGHT
        ? {
            portfolio_fingerprint:
              attestation?.portfolio_fingerprint ?? null,
            credential_fingerprint:
              attestation?.key_fingerprint ?? null,
          }
        : null,
  });
}

function credentialCheckContactedCoinbase(error) {
  return (
    error instanceof GuardDecisionError &&
    (/^VIEW_ONLY_PERMISSION_/.test(error.code) ||
      Number.isInteger(error.httpStatus))
  );
}

function receiptSummary(entry) {
  return {
    receipt_digest: entry.receipt.receipt_digest,
    nonce_digest: entry.receipt.nonce_digest,
    expires_at: entry.receipt.expires_at,
  };
}

function isValidRetryNonce(nonce) {
  return (
    typeof nonce === "string" &&
    nonce.length >= 8 &&
    nonce.length <= 256
  );
}

function invalidNonceReceiptToken(nonce) {
  const suppliedDigest =
    typeof nonce === "string"
      ? digest(nonce)
      : digest({ supplied_type: typeof nonce });
  return `invalid-${suppliedDigest}`;
}

export async function runGuardPreflight({
  plan,
  confirmPolicyDigest,
  viewKeyFile = null,
  nonce = randomUUID(),
  progress = () => {},
  now = () => new Date(),
  history = {},
  verifyViewCredentials = verifyViewKeyFileAndConfigure,
  createViewAdapter = createCoinbaseViewOnlyPreflightAdapter,
  runPipeline = runExecutionPipeline,
  loadCapabilityProfile = loadPreviewCapabilityProfile,
} = {}) {
  const mode = viewKeyFile
    ? GUARD_MODES.VIEW_ONLY_PREFLIGHT
    : GUARD_MODES.DRY_RUN;
  if (!isValidRetryNonce(nonce)) {
    const receiptNonce = invalidNonceReceiptToken(nonce);
    const record = failedPreflightRecord(
      plan,
      blockError(
        "NONCE_INVALID",
        "The retry nonce must contain 8 through 256 characters",
        {
          recovery:
            "Start a fresh preflight with a new 8–256 character nonce. No service was contacted and no order was submitted.",
        },
      ),
      {
        mode,
        nonce: receiptNonce,
        now: now(),
        confirmPolicyDigest,
      },
    );
    const historyResult = await persistHistory(
      record,
      record.guard_receipt,
      history,
    );
    return { record, history: historyResult, replayed: false };
  }
  // Confirmation is checked before any nonce lookup. A previously successful
  // retry can never bypass validation of the authorization shown to the user.
  try {
    validatePlanConfirmation(plan, confirmPolicyDigest);
  } catch (error) {
    const record = failedPreflightRecord(plan, error, {
      mode,
      nonce,
      now: now(),
      confirmPolicyDigest,
    });
    const historyResult = await persistHistory(
      record,
      record.guard_receipt,
      history,
    );
    return { record, history: historyResult, replayed: false };
  }

  let verified = null;
  if (mode === GUARD_MODES.VIEW_ONLY_PREFLIGHT) {
    progress(
      "VIEW ONLY · reading only key permissions, balances, this product, BBO, and Preview. No order can be sent.",
    );
    try {
      verified = await withProgress(
        progress,
        "Checking that the supplied Coinbase key is View-only.",
        () =>
          verifyViewCredentials(viewKeyFile, fetch, {
            persistAttestation: false,
          }),
      );
    } catch (error) {
      const record = failedPreflightRecord(
        plan,
        toGuardReviewError(error, "VIEW_ONLY_CREDENTIAL"),
        {
          mode,
          nonce,
          now: now(),
          confirmPolicyDigest,
          confirmationMatched: true,
          coinbaseContacted:
            credentialCheckContactedCoinbase(error),
          redactMessage: !(error instanceof GuardDecisionError),
        },
      );
      const historyResult = await persistHistory(
        record,
        record.guard_receipt,
        history,
      );
      return { record, history: historyResult, replayed: false };
    }
  }

  const semanticDigest = preflightSemanticDigest({
    plan,
    confirmPolicyDigest,
    mode,
    attestation: verified?.attestation ?? null,
  });
  const claimOptions = { directory: history?.directory };
  let nonceClaim = null;
  if (history?.enabled !== false) {
    nonceClaim = await claimNonce(nonce, semanticDigest, claimOptions);
    if (nonceClaim.status === "MISMATCH") {
      const record = failedPreflightRecord(
        plan,
        blockError(
          "NONCE_REUSE_MISMATCH",
          "This retry nonce is already bound to a different authorization or credential scope",
          {
            recovery:
              "Start a fresh preflight with a new nonce. The prior receipt remains evidence of its original run only.",
          },
        ),
        {
          mode,
          nonce,
          now: now(),
          confirmPolicyDigest,
          confirmationMatched: true,
          credentialBinding: verified
            ? {
                portfolio_fingerprint:
                  verified.attestation.portfolio_fingerprint,
                credential_fingerprint:
                  verified.attestation.key_fingerprint,
              }
            : null,
        },
      );
      return { record, history: null, replayed: false };
    }
    if (nonceClaim.status === "PENDING") {
      progress(
        "The same retry nonce is already running. Waiting for its single deterministic result.",
      );
      nonceClaim = await waitForNonceResult(
        nonce,
        semanticDigest,
        claimOptions,
      );
    }
    if (nonceClaim.status === "MISMATCH") {
      const record = failedPreflightRecord(
        plan,
        blockError(
          "NONCE_REUSE_MISMATCH",
          "This retry nonce completed under a different authorization or credential scope",
          {
            recovery:
              "Start a fresh preflight with a new nonce. No order was submitted.",
          },
        ),
        {
          mode,
          nonce,
          now: now(),
          confirmPolicyDigest,
          confirmationMatched: true,
          credentialBinding: verified
            ? {
                portfolio_fingerprint:
                  verified.attestation.portfolio_fingerprint,
                credential_fingerprint:
                  verified.attestation.key_fingerprint,
              }
            : null,
        },
      );
      return { record, history: null, replayed: false };
    }
    if (nonceClaim.status === "COMPLETED") {
      const priorEntries = await readHistory({
        limit: 100,
        directory: history?.directory,
      });
      const replayed = priorEntries.find(
        (entry) =>
          entry.receipt?.receipt_digest ===
          nonceClaim.result.receipt_digest,
      );
      if (replayed) {
        try {
          assertReceiptActiveInHistory(
            receiptSummary(replayed),
            priorEntries,
            { now: now() },
          );
          return {
            record: null,
            history_entry: replayed,
            replayed: true,
          };
        } catch {
          // The immutable prior result remains evidence, but cannot be
          // returned as current eligibility after expiry or supersession.
        }
      }
      const record = failedPreflightRecord(
        plan,
        reviewError(
          "NONCE_RESULT_NOT_CURRENT",
          "The prior result for this nonce is expired, superseded, or unavailable",
          {
            recovery:
              "Run a fresh preflight with a new nonce. No order was submitted.",
          },
        ),
        {
          mode,
          nonce,
          now: now(),
          confirmPolicyDigest,
          confirmationMatched: true,
          credentialBinding: verified
            ? {
                portfolio_fingerprint:
                  verified.attestation.portfolio_fingerprint,
                credential_fingerprint:
                  verified.attestation.key_fingerprint,
              }
            : null,
        },
      );
      return { record, history: null, replayed: false };
    }
    if (nonceClaim.status === "PENDING") {
      const record = failedPreflightRecord(
        plan,
        reviewError(
          "NONCE_RESULT_PENDING",
          "The original preflight is still running and no second run was started",
          {
            recovery:
              "Retry the same nonce after the original preflight completes. No order was submitted.",
          },
        ),
        {
          mode,
          nonce,
          now: now(),
          confirmPolicyDigest,
          confirmationMatched: true,
          credentialBinding: verified
            ? {
                portfolio_fingerprint:
                  verified.attestation.portfolio_fingerprint,
                credential_fingerprint:
                  verified.attestation.key_fingerprint,
              }
            : null,
        },
      );
      return { record, history: null, replayed: false };
    }
  }

  let record;
  if (mode === GUARD_MODES.DRY_RUN) {
    progress(
      "Starting protected dry run with labeled fixtures. No network; no order can be sent.",
    );
    record = await runBuiltInSimulation(plan, confirmPolicyDigest, {
      preflightNonce: nonce,
      // The local fixture path completes quickly. The single mode/boundary
      // line above is enough progress without making the chat read like logs.
      onProgress: () => {},
    });
  } else {
    const boundExecution = createBoundExecution(
      plan,
      verified.attestation,
      confirmPolicyDigest,
    );
    const executionConfirmation = createExecutionConfirmation({
      boundExecution,
      attestation: verified.attestation,
      confirmedExecutionDigest: boundExecution.execution_digest,
      confirmedAt: now(),
    });
    const [capabilityProfile, coinbase] = await Promise.all([
      loadCapabilityProfile(),
      Promise.resolve(
        createViewAdapter(verified.credentials, { timeoutMs: 5_000 }),
      ),
    ]);
    try {
      record = await withProgress(
        progress,
        "Reading account, product, and market facts; then requesting one exact Preview.",
        () =>
          runPipeline({
            mode: "PROBE",
            plan,
            confirmPolicyDigest,
            boundExecution,
            executionConfirmation,
            capabilityProfile,
            attestation: verified.attestation,
            listAccounts: coinbase.listAccounts,
            getProduct: coinbase.getProduct,
            getBestBidAsk: coinbase.getBestBidAsk,
            previewAdapter: coinbase.previewOrder,
            now,
            preflightNonce: nonce,
          }),
      );
    } catch (error) {
      record = failedPreflightRecord(
        plan,
        toGuardReviewError(error, "VIEW_ONLY_PREFLIGHT"),
        {
          mode,
          nonce,
          now: now(),
          confirmPolicyDigest,
          confirmationMatched: true,
          coinbaseContacted: true,
          credentialBinding: {
            portfolio_fingerprint:
              verified.attestation.portfolio_fingerprint,
            credential_fingerprint:
              verified.attestation.key_fingerprint,
          },
        },
      );
    }
  }
  const historyResult = await persistHistory(
    record,
    record.guard_receipt,
    { ...history, semanticDigest },
  );
  if (historyResult && nonceClaim?.status === "CLAIMED") {
    await completeNonceClaim(
      nonce,
      semanticDigest,
      historyResult.entry,
      claimOptions,
    );
  }
  return { record, history: historyResult, replayed: false };
}
