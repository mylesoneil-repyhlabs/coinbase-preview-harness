import { randomUUID } from "node:crypto";
import {
  addDecimals,
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  subtractDecimals,
} from "./decimal.js";
import {
  buildCoinbaseCreateRequest,
  buildCoinbasePreviewRequest,
} from "./coinbase-order.js";
import { digest, digestBytes } from "./evidence.js";
import { createBoundExecution } from "./execution-binding.js";
import {
  assertExecutionConfirmation,
  createExecutionConfirmation,
} from "./execution-confirmation.js";
import {
  evaluateExecutionPreview,
  evaluateExecutionProposal,
  selectExecutionPreviewEvidence,
} from "./execution-policy.js";
import { normalizeCoinbaseMarketData } from "./market.js";
import { evaluateCoinbaseFunding } from "./funding.js";
import {
  buildCoinbasePolicyBundle,
  createSimulatedMandateAdapter,
  evaluateMandateCandidate,
} from "./mandate/index.js";
import {
  loadPreviewCapabilityProfile,
} from "./plan.js";
import {
  assertPolicyWithinPreviewCapability,
  assertPolicyWithinSafetyProfile,
} from "./policy-validator.js";
import { proposeSpotOrder } from "./proposer.js";
import { sanitize } from "./sanitize.js";
import { JWT_PROFILE } from "./permissions.js";
import { reconcileSubmittedOrder } from "./reconciliation.js";
import { assertProductionExecutionCapability } from "./integration/production-composition.js";
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

// A module-private identity token created without calling mutable globals.
// The fixed simulator can reach it; external callers cannot manufacture the
// same function identity.
const BUILT_IN_SIMULATION_CAPABILITY = () => undefined;

function finalRecord(record, { guardMode = null, nonce = null } = {}) {
  const safe = sanitize(record);
  if (!guardMode) {
    return { ...safe, record_digest: digest(safe) };
  }
  const guardReceipt = createGuardReceipt(safe, {
    mode: guardMode,
    nonce,
    issuedAt: new Date(safe.generated_at),
  });
  const withReceipt = {
    ...safe,
    guard_receipt: guardReceipt,
  };
  return { ...withReceipt, record_digest: digest(withReceipt) };
}

function validAttestation(attestation, { tradeRequired = false } = {}) {
  const receiveScopeAccepted =
    attestation?.can_receive === false ||
    (
      !tradeRequired &&
      attestation?.can_receive === null &&
      attestation?.can_receive_reported === false
    );
  return (
    attestation?.can_view === true &&
    typeof attestation?.can_trade === "boolean" &&
    (!tradeRequired || attestation.can_trade === true) &&
    attestation?.can_transfer === false &&
    receiveScopeAccepted &&
    attestation?.jwt_profile === JWT_PROFILE &&
    typeof attestation.portfolio_fingerprint === "string" &&
    typeof attestation.key_fingerprint === "string"
  );
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateCreateResponse(response, createPayload) {
  if (!isObject(response)) {
    throw new Error("Coinbase Create Order returned an invalid response");
  }
  if (response.success !== true) {
    if (response.success === false) {
      const errorResponse = response.error_response;
      const rejectionMessage =
        errorResponse?.message ?? errorResponse?.error ?? null;
      if (
        response.success_response != null ||
        response.order_id != null ||
        response.order?.order_id != null ||
        !isObject(errorResponse) ||
        typeof rejectionMessage !== "string" ||
        !rejectionMessage.trim()
      ) {
        throw new Error(
          "Coinbase Create Order returned a contradictory rejection response",
        );
      }
      const error = new Error(rejectionMessage);
      error.code = "COINBASE_ORDER_REJECTED";
      throw error;
    }
    const message =
      response.error_response?.message ??
      response.error_response?.error ??
      "Coinbase Create Order response omitted its success status";
    throw new Error(message);
  }
  const success = response.success_response;
  if (
    response.error_response != null ||
    success?.product_id !== createPayload.product_id ||
    success?.side !== createPayload.side ||
    success?.client_order_id !== createPayload.client_order_id ||
    typeof success?.order_id !== "string" ||
    !success.order_id
  ) {
    throw new Error("Coinbase Create Order response is not bound to the authorized payload");
  }
  return {
    order_id: success.order_id,
    product_id: success.product_id,
    side: success.side,
    client_order_id: success.client_order_id,
  };
}

function assertFreshTimestamp(timestamp, current, maxAgeMs, name) {
  if (!Number.isInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error(`${name} maximum age is missing from the safety profile`);
  }
  const observed = Date.parse(timestamp);
  if (!Number.isFinite(observed)) throw new Error(`${name} timestamp is invalid`);
  const age = current.getTime() - observed;
  if (age < -2_000) throw new Error(`${name} timestamp is in the future`);
  if (age > maxAgeMs) throw new Error(`${name} is stale`);
}

function assertSubmissionWindow({
  current,
  policyExpiresAt,
  proposalExpiresAt,
  deltaExpiresAt,
  marketObservedAt,
  previewCollectedAt,
  safetyProfile,
}) {
  if (current.getTime() >= policyExpiresAt.getTime()) {
    throw new Error("Human-confirmed policy expired before order submission");
  }
  if (current.getTime() >= Date.parse(proposalExpiresAt)) {
    throw new Error("Agent proposal expired before order submission");
  }
  if (
    deltaExpiresAt &&
    current.getTime() >= Date.parse(deltaExpiresAt)
  ) {
    throw new Error("delta authorization expired before order submission");
  }
  assertFreshTimestamp(
    marketObservedAt,
    current,
    safetyProfile.max_market_age_ms,
    "Coinbase market evidence",
  );
  assertFreshTimestamp(
    previewCollectedAt,
    current,
    safetyProfile.max_preview_age_ms,
    "Coinbase preview evidence",
  );
}

async function bestEffortMark(markers, patch, warnings) {
  for (const marker of markers) {
    if (!marker) continue;
    try {
      await marker(patch);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
}

async function runExecutionPipelineCore({
  mode,
  executionCapability,
  plan,
  confirmPolicyDigest,
  boundExecution,
  executionConfirmation,
  capabilityProfile,
  executionSafetyProfile,
  attestation,
  listAccounts,
  getProduct,
  getBestBidAsk,
  previewAdapter,
  mandateAdapter,
  createAdapter,
  getOrderAdapter,
  listFillsAdapter,
  now = () => new Date(),
  consumeGrant,
  markGrant,
  preflightNonce = randomUUID(),
  onProgress = () => {},
}) {
  if (mode !== "LIVE" && mode !== "PROBE" && mode !== "SIMULATION") {
    throw new Error("Execution mode must be exactly LIVE, PROBE, or SIMULATION");
  }
  const builtInSimulation =
    executionCapability === BUILT_IN_SIMULATION_CAPABILITY;
  if (mode === "SIMULATION" && !builtInSimulation) {
    throw new Error("SIMULATION mode is reserved for the built-in no-network harness");
  }
  if (
    mode === "LIVE" &&
    !builtInSimulation
  ) {
    assertProductionExecutionCapability(executionCapability);
  }
  if (
    mode === "LIVE" &&
    (typeof consumeGrant !== "function" || typeof markGrant !== "function")
  ) {
    throw new Error(
      "LIVE execution requires injected durable consumeGrant() and markGrant() ports",
    );
  }
  if (
    mode === "LIVE" &&
    !builtInSimulation &&
    !executionSafetyProfile
  ) {
    throw new Error(
      "LIVE execution requires the independent future-live safety profile",
    );
  }
  const startedAt = now();
  const guardMode =
    mode === "SIMULATION"
      ? GUARD_MODES.DRY_RUN
      : mode === "PROBE"
        ? GUARD_MODES.VIEW_ONLY_PREFLIGHT
        : null;
  const {
    plan: boundPlan,
    confirmedAt,
    expiresAt: confirmedExpiresAt,
  } = assertExecutionConfirmation({
    receipt: executionConfirmation,
    boundExecution,
    attestation,
    current: startedAt,
  });
  if (boundPlan.plan_id !== plan?.plan_id) {
    throw new Error("Execution plan does not match its confirmed binding");
  }
  const record = {
    schema_version: "delta.coinbase.execution_record.v3",
    artifact_class: mode,
    guard_mode: guardMode,
    generated_at: startedAt.toISOString(),
    status: "REVIEW",
    decision: "REVIEW",
    source_intent_digest: plan?.source_intent?.digest ?? null,
    policy: plan?.policy ?? null,
    policy_digest: plan?.policy_digest ?? null,
    action_descriptor: plan?.action_descriptor ?? null,
    capability_profile: plan?.capability_profile ?? null,
    execution_safety_profile:
      mode === "LIVE" && !builtInSimulation
        ? {
            id: executionSafetyProfile?.id ?? null,
            digest:
              executionSafetyProfile == null
                ? null
                : digest(executionSafetyProfile),
          }
        : null,
    confirmation: {
      supplied_digest: confirmPolicyDigest ?? null,
      matched: false,
      execution_digest: boundExecution.execution_digest,
      supplied_execution_digest:
        executionConfirmation?.execution_digest ?? null,
      execution_matched:
        boundExecution.execution_digest ===
        executionConfirmation?.execution_digest,
      receipt_digest: executionConfirmation?.receipt_digest ?? null,
    },
    credential_binding: attestation
      ? {
          portfolio_fingerprint: attestation.portfolio_fingerprint,
          credential_fingerprint: attestation.key_fingerprint,
        }
      : null,
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
    reconciliation: null,
    execution: {
      adapter_invoked: false,
      order_submitted: false,
      order_id: null,
      client_order_id: null,
      create_payload_digest: null,
      transmitted_body_digest: null,
      one_time_gate_consumed: false,
      persistence_warnings: [],
    },
    preflight: {
      schema_version: "delta.coinbase.preflight_binding.v1",
      nonce_digest: digest(preflightNonce),
      fingerprint: null,
      expires_at: null,
      supersedes: null,
    },
    boundary: {
      mode: guardMode,
      view_only: mode === "PROBE",
      dry_run: mode === "SIMULATION",
      create_available: false,
      no_order_submitted: true,
      money_moved: false,
      coinbase_contacted: mode === "PROBE",
      preview_is_not_execution_or_price_guarantee: true,
    },
    failure: null,
  };
  const finish = () =>
    finalRecord(record, {
      guardMode,
      nonce: preflightNonce,
    });

  let consumedGrantPlanId = null;
  try {
    onProgress("Validating the authorized mandate.");
    if (plan?.schema_version !== "delta.coinbase.execution_plan.v3") {
      throw blockError(
        "PLAN_SCHEMA_INVALID",
        "Execution plan schema is invalid",
      );
    }
    if (plan.status !== "AWAITING_HUMAN_CONFIRMATION") {
      throw blockError(
        "PLAN_NOT_AUTHORIZABLE",
        "Execution plan is not ready for confirmation",
      );
    }
    if (typeof plan.plan_id !== "string" || !plan.plan_id) {
      throw new Error("Execution plan id is missing");
    }
    if (
      typeof plan.source_intent?.text !== "string" ||
      digest(plan.source_intent.text) !== plan.source_intent.digest
    ) {
      throw blockError(
        "SOURCE_INTENT_TAMPERED",
        "Execution plan source intent digest does not match its text",
      );
    }
    if (digest(plan.policy) !== plan.policy_digest) {
      throw blockError(
        "POLICY_TAMPERED",
        "Execution plan policy digest does not match its policy",
      );
    }
    if (confirmPolicyDigest !== plan.policy_digest) {
      throw blockError(
        "POLICY_CONFIRMATION_MISMATCH",
        "Human confirmation digest does not match the compiled policy",
      );
    }
    record.confirmation.matched = true;

    if (
      plan.capability_profile?.id !== capabilityProfile?.id ||
      plan.capability_profile?.digest !== digest(capabilityProfile) ||
      plan.capability_profile?.create_enabled !== false
    ) {
      throw blockError(
        "CAPABILITY_PROFILE_CHANGED",
        "Preview capability profile has changed since planning",
      );
    }
    assertPolicyWithinPreviewCapability(
      plan.policy,
      capabilityProfile,
    );
    if (
      mode === "LIVE" &&
      !builtInSimulation
    ) {
      assertPolicyWithinSafetyProfile(
        plan.policy,
        executionSafetyProfile,
      );
    }
    if (
      !validAttestation(attestation, {
        tradeRequired: mode === "LIVE" && !builtInSimulation,
      })
    ) {
      throw reviewError(
        "CREDENTIAL_ATTESTATION_INVALID",
        mode === "LIVE" && !builtInSimulation
          ? "Coinbase View+Trade credential attestation is missing or unsafe"
          : "Coinbase View credential attestation is missing or unsafe",
      );
    }

    const policyExpiresAt = confirmedExpiresAt;
    record.confirmation.confirmed_at = confirmedAt.toISOString();
    record.confirmation.policy_expires_at = policyExpiresAt.toISOString();
    if (startedAt.getTime() >= policyExpiresAt.getTime()) {
      throw reviewError(
        "POLICY_EXPIRED",
        "Human-confirmed policy expired before credential verification completed",
        {
          recovery:
            "Authorize a fresh mandate before requesting new evidence. No order was submitted.",
        },
      );
    }

    if (typeof listAccounts !== "function") {
      throw reviewError(
        "ACCOUNTS_ADAPTER_UNAVAILABLE",
        "Trusted Coinbase account/balance evidence is required",
      );
    }
    const evidenceRequestedAt = now();
    onProgress("Collecting balances, product, and market evidence.");
    const evidenceResults = await Promise.allSettled([
      getProduct(plan.policy.product_id),
      getBestBidAsk(plan.policy.product_id),
      listAccounts(),
    ]);
    const evidenceReceivedAt = now();
    const evidenceNames = ["PRODUCT", "BEST_BID_ASK", "ACCOUNTS"];
    for (let index = 0; index < evidenceResults.length; index += 1) {
      const result = evidenceResults[index];
      if (result.status === "rejected") {
        throw toGuardReviewError(result.reason, evidenceNames[index]);
      }
    }
    const [
      { value: productResponse },
      { value: bestBidAskResponse },
      { value: accountsResponse },
    ] = evidenceResults;
    const receivedAt = evidenceReceivedAt.toISOString();
    record.sources.product = {
      provenance: builtInSimulation
        ? "SIMULATED_FIXTURE"
        : "COINBASE_AUTHENTICATED_VIEW",
      timestamp_kind: "LOCAL_RECEIPT_TIME",
      requested_at: evidenceRequestedAt.toISOString(),
      received_at: receivedAt,
      age_ms: 0,
    };
    record.sources.accounts = {
      provenance: builtInSimulation
        ? "SIMULATED_FIXTURE"
        : "COINBASE_AUTHENTICATED_VIEW",
      timestamp_kind: "LOCAL_RECEIPT_TIME",
      requested_at: evidenceRequestedAt.toISOString(),
      received_at: receivedAt,
      age_ms: 0,
      complete: accountsResponse?.has_next === false,
    };
    const market = normalizeCoinbaseMarketData(
      productResponse,
      bestBidAskResponse,
      plan.policy.product_id,
    );
    assertFreshTimestamp(
      market.observed_at,
      now(),
      capabilityProfile.max_market_age_ms,
      "Coinbase market evidence",
    );
    record.market = market;
    record.sources.best_bid_ask = {
      provenance: builtInSimulation
        ? "SIMULATED_FIXTURE"
        : "COINBASE_AUTHENTICATED_VIEW",
      timestamp_kind: "COINBASE_PRICEBOOK_TIME",
      requested_at: evidenceRequestedAt.toISOString(),
      received_at: receivedAt,
      observed_at: market.observed_at,
      age_ms: Math.max(
        0,
        evidenceReceivedAt.getTime() - Date.parse(market.observed_at),
      ),
    };
    const funding = evaluateCoinbaseFunding(
      plan.policy,
      accountsResponse,
      {
        portfolioFingerprint: attestation.portfolio_fingerprint,
      },
    );
    record.funding = funding;
    onProgress("Checking held funds and portfolio scope.");
    if (funding.decision !== "PASS") {
      const message =
        `Coinbase funding check did not pass: ${funding.failures
          .map((failure) => failure.code)
          .join(", ")}`;
      throw funding.decision === "REVIEW"
        ? reviewError(
            funding.evidence_issues?.[0]?.code ??
              "FUNDING_EVIDENCE_UNAVAILABLE",
            message,
          )
        : blockError(
            funding.policy_failures?.[0]?.code ??
              "FUNDING_POLICY_BLOCK",
            message,
          );
    }

    const proposed = proposeSpotOrder(plan.policy, market, { now: startedAt });
    onProgress("Preparing and checking the exact proposal.");
    record.proposal = proposed;
    if (
      digest(proposed.action_descriptor) !==
      digest(plan.action_descriptor)
    ) {
      throw blockError(
        "ACTION_DESCRIPTOR_MISMATCH",
        "Agent proposal action descriptor differs from authorization",
      );
    }
    const proposalCheck = evaluateExecutionProposal(
      plan.policy,
      proposed.action,
      market,
    );
    record.proposal_check = proposalCheck;
    if (proposalCheck.decision !== "PASS") {
      throw blockError(
        proposalCheck.failures?.[0]?.code ?? "PROPOSAL_POLICY_BLOCK",
        "Agent proposal failed the deterministic policy check",
      );
    }

    const beforePreview = now();
    if (beforePreview.getTime() >= policyExpiresAt.getTime()) {
      throw reviewError(
        "POLICY_EXPIRED_BEFORE_PREVIEW",
        "The authorized policy expired before Coinbase Preview could be requested",
        {
          recovery:
            "Authorize a fresh mandate, then run a new View-only preflight. No order was submitted.",
        },
      );
    }
    const previewRequest = buildCoinbasePreviewRequest(proposed.action);
    onProgress("Checking the exact Preview request and response.");
    const serializedPreviewRequest = JSON.stringify(previewRequest);
    const previewRequestDigest = digestBytes(serializedPreviewRequest);
    let previewResult;
    const previewRequestedAt = now();
    try {
      previewResult = await previewAdapter(previewRequest);
    } catch (error) {
      throw toGuardReviewError(error, "PREVIEW");
    }
    const previewResponse = previewResult?.response ?? previewResult;
    const selectedPreview = selectExecutionPreviewEvidence(previewResponse);
    if (selectedPreview == null) {
      throw reviewError(
        "INVALID_PREVIEW",
        "Coinbase Preview did not return a verifiable response object",
        {
          recovery:
            "Run a fresh View-only preflight when Coinbase Preview is available. No order was submitted.",
        },
      );
    }
    const previewReceivedAt = now();
    const previewCollectedAt = previewReceivedAt.toISOString();
    const transport = previewResult?.transport ?? null;
    if (
      mode === "PROBE" &&
      (transport?.method !== "POST" ||
        transport?.host !== "api.coinbase.com" ||
        transport?.path !== "/api/v3/brokerage/orders/preview" ||
        transport?.sent_body_digest !== previewRequestDigest)
    ) {
      throw reviewError(
        "PREVIEW_TRANSPORT_BINDING_MISMATCH",
        "The Coinbase Preview transport was not bound to the exact prepared request",
      );
    }
    record.sources.preview = {
      provenance: builtInSimulation
        ? "SIMULATED_FIXTURE"
        : "COINBASE_AUTHENTICATED_VIEW",
      timestamp_kind: "LOCAL_RECEIPT_TIME",
      requested_at: previewRequestedAt.toISOString(),
      received_at: previewCollectedAt,
      age_ms: 0,
    };
    record.preview = {
      collected_at: previewCollectedAt,
      request_digest: previewRequestDigest,
      transport_body_digest:
        transport?.sent_body_digest ?? previewRequestDigest,
      evidence: selectedPreview,
      response_fingerprint: digest(selectedPreview),
      evidence_digest: digest({
        market,
        preview: selectedPreview,
        funding: {
          schema_version: funding.schema_version,
          portfolio_fingerprint: funding.portfolio_fingerprint,
          funding_asset: funding.funding_asset,
          required_available: funding.required_available,
          available_balance: funding.available_balance,
          account_fingerprints: funding.account_fingerprints,
          complete: funding.complete,
          evidence_digest: funding.evidence_digest,
        },
        collected_at: previewCollectedAt,
      }),
    };
    const previewCheck = evaluateExecutionPreview(
      plan.policy,
      proposed.action,
      market,
      previewResponse,
    );
    record.preview_check = previewCheck;
    if (previewCheck.decision !== "PASS") {
      record.status = previewCheck.decision;
      record.decision = previewCheck.decision;
      throw previewCheck.decision === "REVIEW"
        ? reviewError(
            previewCheck.review_reasons?.[0]?.code ??
              previewCheck.failures?.[0]?.code ??
              "PREVIEW_UNABLE_TO_VERIFY",
            "Coinbase Preview requires human review; execution remains locked",
          )
        : blockError(
            previewCheck.failures?.[0]?.code ?? "PREVIEW_POLICY_BLOCK",
            "Coinbase Preview failed the deterministic policy check",
          );
    }

    const clientOrderId = randomUUID();
    const createPayload = deepFreeze(
      buildCoinbaseCreateRequest(
        proposed.action,
        clientOrderId,
        previewResponse.preview_id,
      ),
    );
    const createPayloadSerialized = JSON.stringify(createPayload);
    const createPayloadDigest = digestBytes(createPayloadSerialized);
    record.execution.client_order_id = clientOrderId;
    record.execution.create_payload_digest = createPayloadDigest;
    const evidenceExpiry = Math.min(
      policyExpiresAt.getTime(),
      Date.parse(proposed.expires_at),
      Date.parse(market.observed_at) + capabilityProfile.max_market_age_ms,
      Date.parse(previewCollectedAt) + capabilityProfile.max_preview_age_ms,
    );
    record.preflight.expires_at = new Date(evidenceExpiry).toISOString();
    record.preflight.fingerprint = digest({
      schema_version: record.preflight.schema_version,
      mode: guardMode,
      nonce_digest: record.preflight.nonce_digest,
      policy_digest: plan.policy_digest,
      action_descriptor_digest:
        plan.action_descriptor.descriptor_digest,
      proposal_digest: proposed.proposal_digest,
      preview_request_digest: previewRequestDigest,
      preview_transport_body_digest:
        record.preview.transport_body_digest,
      preview_response_fingerprint:
        record.preview.response_fingerprint,
      evidence_digest: record.preview.evidence_digest,
      prospective_create_payload_digest: createPayloadDigest,
      source_times: {
        accounts_received_at: record.sources.accounts.received_at,
        product_received_at: record.sources.product.received_at,
        bbo_observed_at: record.sources.best_bid_ask.observed_at,
        preview_received_at: record.sources.preview.received_at,
      },
    });
    onProgress("Binding policy, proposal, evidence, and prospective payload.");
    if (mode === "PROBE") {
      try {
        assertSubmissionWindow({
          current: now(),
          policyExpiresAt,
          proposalExpiresAt: proposed.expires_at,
          marketObservedAt: market.observed_at,
          previewCollectedAt,
          safetyProfile: capabilityProfile,
        });
      } catch (error) {
        throw reviewError(
          "PREFLIGHT_EVIDENCE_EXPIRED",
          error instanceof Error ? error.message : String(error),
          {
            recovery:
              "Run a fresh View-only preflight. The old result cannot be reused and no order was submitted.",
          },
        );
      }
      record.status = "PREVIEW_PROBE_PASS";
      record.decision = "PASS";
      return finish();
    }
    const evaluationRequest = deepFreeze(structuredClone({
      schema_version: "delta.coinbase.evaluation_request.v2",
      requested_at: now().toISOString(),
      plan_id: plan.plan_id,
      execution_digest: boundExecution.execution_digest,
      execution_confirmed_at: confirmedAt.toISOString(),
      policy_expires_at: policyExpiresAt.toISOString(),
      source_intent_digest: plan.source_intent.digest,
      policy: plan.policy,
      policy_digest: plan.policy_digest,
      action_descriptor: plan.action_descriptor,
      proposal: proposed,
      proposal_digest: proposed.proposal_digest,
      evidence: {
        market,
        preview: selectedPreview,
        funding: {
          schema_version: funding.schema_version,
          portfolio_fingerprint: funding.portfolio_fingerprint,
          funding_asset: funding.funding_asset,
          required_available: funding.required_available,
          available_balance: funding.available_balance,
          account_fingerprints: funding.account_fingerprints,
          complete: funding.complete,
          evidence_digest: funding.evidence_digest,
        },
        collected_at: previewCollectedAt,
      },
      evidence_digest: record.preview.evidence_digest,
      preview_request: previewRequest,
      preview_request_digest: digest(previewRequest),
      create_payload: createPayload,
      create_payload_serialized: createPayloadSerialized,
      create_payload_digest: createPayloadDigest,
      credential_binding: {
        portfolio_fingerprint: attestation.portfolio_fingerprint,
        credential_fingerprint: attestation.key_fingerprint,
      },
    }));
    if (!mandateAdapter) {
      throw reviewError(
        "DELTA_ADAPTER_UNAVAILABLE",
        "A production-shaped Delta mandate adapter is required before execution",
      );
    }
    const policyBundle = buildCoinbasePolicyBundle({
      plan,
      attestation,
      policyExpiresAt,
    });
    const mandate = await evaluateMandateCandidate({
      adapter: mandateAdapter,
      policySource: policyBundle.source,
      parameters: policyBundle.parameters,
      actionRecord: evaluationRequest,
      authorization: {
        schema_version: "delta.coinbase.authorization_context.v2",
        plan_id: plan.plan_id,
        policy_digest: plan.policy_digest,
        execution_digest: boundExecution.execution_digest,
        confirmed_at: confirmedAt.toISOString(),
        expires_at: policyExpiresAt.toISOString(),
      },
      proofEvidenceBindings: {
        product_id: plan.policy.product_id,
        action_descriptor_digest:
          plan.action_descriptor.descriptor_digest,
        authorized_limit_price:
          proposalCheck.authorized_limit_price,
        funding_evidence_digest: funding.evidence_digest,
        preview_id: previewResponse.preview_id,
        create_payload_digest: createPayloadDigest,
        preview_request_digest: evaluationRequest.preview_request_digest,
        portfolio_fingerprint: attestation.portfolio_fingerprint,
        credential_fingerprint: attestation.key_fingerprint,
      },
    });
    onProgress("Evaluating the exact proposal against the Delta mandate contract.");
    record.delta = {
      surface: "delta_orchestrator_and_verifier",
      adapter: mandateAdapter.name ?? "mandate-adapter",
      status: mandate.status,
      decision: mandate.decision,
      policy_id: mandate.policy_id,
      intent_id: mandate.intent_id,
      proposal: mandate.proposal,
      evidence: mandate.evidence,
      constraint_failures: mandate.constraint_failures,
      reason: mandate.reason,
      verifier_confirmed: mandate.verified,
      proof_present: Boolean(mandate.proof),
      proof_digest: digest(mandate.proof),
      proof_verification: mandate.proof_verification,
      cryptographic_proof_verified:
        mandate.proof_verification?.cryptographically_verified === true,
      receipt: mandate.receipt,
      one_time_grant_digest: digest({
        plan_id: plan.plan_id,
        intent_id: mandate.intent_id,
      }),
    };
    if (mandate.decision !== "PASS" || mandate.verified !== true) {
      record.status = mandate.decision;
      record.decision =
        mandate.decision === "REVIEW" ? "REVIEW" : "BLOCK";
      const failed = mandate.constraint_failures
        .map((failure) => `#${failure.index}: ${failure.reason}`)
        .join("; ");
      const message =
        `Delta mandate rejected the Coinbase action${failed ? ` (${failed})` : ""}`;
      throw mandate.decision === "REVIEW"
        ? reviewError("DELTA_REVIEW", message)
        : blockError("DELTA_POLICY_BLOCK", message);
    }
    const deltaDecision = {
      decision_id: mandate.intent_id,
      decision: "PASS",
      evaluated_at: now().toISOString(),
      expires_at: policyExpiresAt.toISOString(),
    };
    if (
      JSON.stringify(createPayload) !== createPayloadSerialized ||
      JSON.stringify(evaluationRequest.create_payload) !==
        evaluationRequest.create_payload_serialized ||
      digestBytes(evaluationRequest.create_payload_serialized) !==
        createPayloadDigest
    ) {
      throw reviewError(
        "PAYLOAD_INTEGRITY_CHANGED",
        "The Coinbase Create payload changed during delta evaluation",
      );
    }
    const preSubmitNow = now();
    assertSubmissionWindow({
      current: preSubmitNow,
      policyExpiresAt,
      proposalExpiresAt: proposed.expires_at,
      deltaExpiresAt: deltaDecision.expires_at,
      marketObservedAt: market.observed_at,
      previewCollectedAt,
      safetyProfile: capabilityProfile,
    });

    consumedGrantPlanId = plan.plan_id;
    onProgress("Consuming the one-time simulated eligibility.");
    await consumeGrant(consumedGrantPlanId, mandate.intent_id, {
      status: "SUBMITTING",
      consumed_at: preSubmitNow.toISOString(),
      policy: plan.policy,
      policy_digest: plan.policy_digest,
      market,
      decision_id: deltaDecision.decision_id,
      client_order_id: clientOrderId,
      create_payload_digest: createPayloadDigest,
      create_payload: createPayload,
      create_payload_serialized: createPayloadSerialized,
      portfolio_fingerprint: attestation.portfolio_fingerprint,
      credential_fingerprint: attestation.key_fingerprint,
      policy_expires_at: policyExpiresAt.toISOString(),
      delta_expires_at: deltaDecision.expires_at,
    });
    record.execution.one_time_gate_consumed = true;

    const finalSubmitNow = now();
    assertSubmissionWindow({
      current: finalSubmitNow,
      policyExpiresAt,
      proposalExpiresAt: proposed.expires_at,
      deltaExpiresAt: deltaDecision.expires_at,
      marketObservedAt: market.observed_at,
      previewCollectedAt,
      safetyProfile: capabilityProfile,
    });
    if (
      JSON.stringify(createPayload) !== createPayloadSerialized ||
      digestBytes(createPayloadSerialized) !== createPayloadDigest
    ) {
      throw reviewError(
        "PAYLOAD_INTEGRITY_CHANGED",
        "The authorized Coinbase Create payload changed before submission",
      );
    }

    if (mode === "SIMULATION") {
      record.status = "EXECUTION_ELIGIBLE";
      record.decision = "PASS";
      record.simulation = {
        fixture_data: true,
        network_access: false,
        production_delta_invoked: false,
        coinbase_create_invoked: false,
        exact_payload_verified: true,
        one_time_in_memory_gate_consumed: true,
        external_executor_invoked: false,
        exchange_outcome_observed: false,
      };
      onProgress("Dry run complete. No executor or Coinbase Create was invoked.");
      return finish();
    }

    record.execution.adapter_invoked = true;
    let createResult;
    try {
      createResult = await createAdapter(
        createPayload,
        createPayloadSerialized,
      );
    } catch (error) {
      record.status = "SUBMISSION_UNCERTAIN";
      record.execution.order_submitted = null;
      record.failure = {
        stage: "COINBASE_CREATE",
        message:
          "Create Order failed after the one-time authorization was consumed. Reconcile by client_order_id; do not submit a new order.",
        client_order_id: clientOrderId,
      };
      await bestEffortMark(
        [(patch) => markGrant(consumedGrantPlanId, patch)],
        {
          status: "SUBMISSION_UNCERTAIN",
          error: error instanceof Error ? error.message : String(error),
        },
        record.execution.persistence_warnings,
      );
      return finish();
    }
    const transmittedBodyDigest = createResult?.transport?.sent_body_digest;
    record.execution.transmitted_body_digest =
      typeof transmittedBodyDigest === "string" ? transmittedBodyDigest : null;
    if (transmittedBodyDigest !== createPayloadDigest) {
      record.status = "SUBMISSION_UNCERTAIN";
      record.execution.order_submitted = null;
      record.failure = {
        stage: "COINBASE_CREATE_TRANSPORT",
        message:
          "Create Order returned without proof that the transmitted body matched the Delta-verified bytes. Reconcile by client_order_id; do not submit a new order.",
        client_order_id: clientOrderId,
      };
      await bestEffortMark(
        [(patch) => markGrant(consumedGrantPlanId, patch)],
        {
          status: "SUBMISSION_UNCERTAIN",
          error: "Coinbase transport body digest was missing or mismatched",
        },
        record.execution.persistence_warnings,
      );
      return finish();
    }
    const createResponse = createResult?.response ?? createResult;
    let submitted;
    try {
      submitted = validateCreateResponse(createResponse, createPayload);
    } catch (error) {
      if (error?.code === "COINBASE_ORDER_REJECTED") {
        record.status = "COINBASE_REJECTED";
        record.failure = {
          stage: "COINBASE_CREATE",
          message: error.message,
          client_order_id: clientOrderId,
        };
        await bestEffortMark(
          [(patch) => markGrant(consumedGrantPlanId, patch)],
          { status: "COINBASE_REJECTED", error: error.message },
          record.execution.persistence_warnings,
        );
        return finish();
      }
      record.status = "SUBMISSION_UNCERTAIN";
      record.execution.order_submitted = null;
      record.failure = {
        stage: "COINBASE_CREATE_RESPONSE",
        message:
          "Coinbase returned an unbound or malformed Create Order response. Reconcile by client_order_id; do not submit a new order.",
        client_order_id: clientOrderId,
      };
      await bestEffortMark(
        [(patch) => markGrant(consumedGrantPlanId, patch)],
        {
          status: "SUBMISSION_UNCERTAIN",
          error: error instanceof Error ? error.message : String(error),
        },
        record.execution.persistence_warnings,
      );
      return finish();
    }
    record.execution = {
      ...record.execution,
      adapter_invoked: true,
      order_submitted: true,
      ...submitted,
    };
    await bestEffortMark(
      [(patch) => markGrant(consumedGrantPlanId, patch)],
      {
        status: "SUBMITTED",
        order_id: submitted.order_id,
        transmitted_body_digest: transmittedBodyDigest,
      },
      record.execution.persistence_warnings,
    );

    let orderResponse;
    try {
      if (typeof getOrderAdapter !== "function") {
        throw new Error("Coinbase Get Order adapter is required");
      }
      orderResponse = await getOrderAdapter(submitted.order_id);
    } catch (error) {
      record.status = "RECONCILIATION_PENDING";
      record.failure = {
        stage: "POST_SUBMISSION_RECONCILIATION",
        message:
          "Coinbase accepted the order, but its fill outcome could not be read. Reconcile by order_id; do not submit a new order.",
        order_id: submitted.order_id,
      };
      await bestEffortMark(
        [(patch) => markGrant(consumedGrantPlanId, patch)],
        {
          status: "RECONCILIATION_PENDING",
          order_id: submitted.order_id,
          error: error instanceof Error ? error.message : String(error),
        },
        record.execution.persistence_warnings,
      );
      return finish();
    }

    let fillsResponse;
    try {
      if (typeof listFillsAdapter !== "function") {
        throw new Error("Coinbase List Fills adapter is required");
      }
      fillsResponse = await listFillsAdapter(submitted.order_id);
      if (!Array.isArray(fillsResponse?.fills)) {
        throw new Error("Coinbase List Fills response omitted fills");
      }
    } catch (error) {
      record.status = "RECONCILIATION_PENDING";
      record.failure = {
        stage: "POST_SUBMISSION_RECONCILIATION",
        message:
          "Coinbase accepted the order, but complete fill evidence could not be read. Reconcile by order_id; do not submit a new order.",
        order_id: submitted.order_id,
      };
      await bestEffortMark(
        [(patch) => markGrant(consumedGrantPlanId, patch)],
        {
          status: "RECONCILIATION_PENDING",
          order_id: submitted.order_id,
          error: error instanceof Error ? error.message : String(error),
        },
        record.execution.persistence_warnings,
      );
      return finish();
    }
    try {
      record.reconciliation = reconcileSubmittedOrder({
        orderResponse,
        fillsResponse,
        createPayload,
        expectedOrderId: submitted.order_id,
        policy: plan.policy,
        market,
        checkedAt: now(),
      });
      record.status = record.reconciliation.outcome;
      if (record.status === "EXECUTION_POLICY_BREACH") {
        record.failure = {
          stage: "POST_SUBMISSION_POLICY_CHECK",
          message:
            "The submitted order outcome exceeded at least one authorized constraint.",
          order_id: submitted.order_id,
          failures: record.reconciliation.checks.failures,
        };
      }
    } catch (error) {
      record.status = "RECONCILIATION_FAILED";
      record.failure = {
        stage: "POST_SUBMISSION_RECONCILIATION",
        message:
          "Coinbase accepted the order, but its returned order or fill data could not be bound to the authorized action.",
        order_id: submitted.order_id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await bestEffortMark(
      [(patch) => markGrant(consumedGrantPlanId, patch)],
      {
        status: record.status,
        order_id: submitted.order_id,
        reconciliation: record.reconciliation,
        error: record.failure?.message ?? null,
      },
      record.execution.persistence_warnings,
    );
    return finish();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (consumedGrantPlanId) {
      await bestEffortMark(
        [(patch) => markGrant(consumedGrantPlanId, patch)],
        {
          status: "PRE_SUBMISSION_ABORTED",
          error: message,
        },
        record.execution.persistence_warnings,
      );
    }
    const typed =
      error instanceof GuardDecisionError
        ? error
        : toGuardReviewError(error, "PREFLIGHT");
    if (!consumedGrantPlanId && guardMode) {
      record.status = typed.decision;
      record.decision = typed.decision;
    }
    record.failure = {
      stage:
        typed.stage ??
        (consumedGrantPlanId
          ? "POST_AUTHORIZATION"
          : "PRE_EXECUTION_GATE"),
      code: typed.code ?? "PREFLIGHT_UNAVAILABLE",
      class:
        typed.decision === "BLOCK"
          ? "POLICY_VIOLATION"
          : "UNABLE_TO_VERIFY",
      message,
      recovery: typed.recovery ?? null,
      retryable: typed.retryable === true,
      http_status: typed.httpStatus ?? null,
    };
    return finish();
  }
}

/**
 * Public execution entrypoint.
 *
 * PROBE is available in the checked-in build. LIVE additionally requires the
 * module-private capability that only the reviewed production composition can
 * return after engineering changes that source file. A caller-supplied adapter
 * or environment variable cannot forge the capability.
 */
export async function runExecutionPipeline(args) {
  return runExecutionPipelineCore(args);
}

/**
 * Runs the production-shaped controller against fixed, in-memory adapters.
 *
 * The signature deliberately accepts only a plan and confirmation digest. It
 * does not accept transport or adapter callbacks, so it cannot be repurposed
 * to reach Coinbase Create.
 */
export async function runBuiltInSimulation(
  plan,
  confirmPolicyDigest,
  {
    preflightNonce = randomUUID(),
    onProgress = () => {},
  } = {},
) {
  const fixtureNow = new Date();
  const now = () => new Date(fixtureNow);
  const consumed = new Set();
  const consumedPlans = new Set();
  const capabilityProfile = await loadPreviewCapabilityProfile();
  const attestation = {
    can_view: true,
    can_trade: false,
    can_transfer: false,
    can_receive: false,
    jwt_profile: JWT_PROFILE,
    portfolio_fingerprint: digest("simulated-portfolio"),
    key_fingerprint: digest("simulated-view-only-session"),
  };
  const boundExecution = createBoundExecution(
    plan,
    attestation,
    confirmPolicyDigest,
  );
  const executionConfirmation = createExecutionConfirmation({
    boundExecution,
    attestation,
    confirmedExecutionDigest: boundExecution.execution_digest,
    confirmedAt: fixtureNow,
  });
  const decimalQuantum = (value, fallback = "0.00000001") => {
    const fraction = String(value).split(".")[1] ?? "";
    if (!fraction.length) return "1";
    if (fraction.length > 18) return fallback;
    return `0.${"0".repeat(fraction.length - 1)}1`;
  };
  const sizeValue = plan.policy.size.value;
  const settlementValue = plan.policy.limits.settlement.value;
  const sellReference =
    plan.policy.side === "SELL" &&
    compareDecimals(settlementValue, "0") > 0
      ? divideDecimals(settlementValue, sizeValue, { scale: 8 })
      : "100.00000000";
  const conditionalReference = plan.policy.market_condition?.value ?? null;
  const baseReference =
    plan.policy.side === "SELL"
      ? conditionalReference &&
        compareDecimals(conditionalReference, sellReference) > 0
        ? conditionalReference
        : sellReference
      : conditionalReference ?? "100.00";
  const priceIncrement = decimalQuantum(baseReference, "0.00000001");
  const bestBid =
    plan.policy.side === "SELL"
      ? baseReference
      : subtractDecimals(baseReference, priceIncrement);
  const bestAsk =
    plan.policy.side === "SELL"
      ? addDecimals(bestBid, priceIncrement)
      : baseReference;
  const previewBaseSize =
    plan.policy.side === "BUY"
      ? divideDecimals(sizeValue, bestAsk, { scale: 18 })
      : sizeValue;
  const previewQuoteSize =
    plan.policy.side === "BUY"
      ? sizeValue
      : multiplyDecimals(sizeValue, bestBid);
  const fillPrice =
    plan.policy.side === "BUY" ? bestAsk : bestBid;
  const funding = plan.action_descriptor.funding;

  const liveShapedRecord = await runExecutionPipelineCore({
    mode: "SIMULATION",
    executionCapability: BUILT_IN_SIMULATION_CAPABILITY,
    plan,
    confirmPolicyDigest,
    boundExecution,
    executionConfirmation,
    capabilityProfile,
    attestation,
    now,
    listAccounts: async () => ({
      accounts: [
        {
          uuid: "simulated-funding-account",
          currency: funding.asset,
          available_balance: {
            currency: funding.asset,
            value: funding.required_available,
          },
          active: true,
          ready: true,
          deleted_at: null,
          platform: "ACCOUNT_PLATFORM_CONSUMER",
          retail_portfolio_id: "simulated-portfolio",
        },
      ],
      has_next: false,
      cursor: null,
    }),
    getProduct: async (productId) => ({
      product_id: productId,
      product_type: "SPOT",
      status: "online",
      base_currency_id: plan.policy.base_asset,
      quote_currency_id: plan.policy.quote_asset,
      base_increment:
        plan.policy.side === "SELL"
          ? decimalQuantum(sizeValue)
          : "0.00000001",
      quote_increment:
        plan.policy.side === "BUY"
          ? decimalQuantum(sizeValue)
          : "0.00000001",
      price_increment: priceIncrement,
      base_min_size:
        plan.policy.side === "SELL"
          ? decimalQuantum(sizeValue)
          : "0.00000001",
      base_max_size: "999999999999999999",
      quote_min_size:
        plan.policy.side === "BUY"
          ? decimalQuantum(sizeValue)
          : "0.00000001",
      quote_max_size: "999999999999999999",
      is_disabled: false,
      trading_disabled: false,
      view_only: false,
      cancel_only: false,
      limit_only: false,
      post_only: false,
      auction_mode: false,
    }),
    getBestBidAsk: async (productId) => ({
      pricebooks: [
        {
          product_id: productId,
          bids: [{ price: bestBid, size: "1.0" }],
          asks: [{ price: bestAsk, size: "1.0" }],
          time: fixtureNow.toISOString(),
        },
      ],
    }),
    previewAdapter: async (requestBody) => {
      const serializedBody = JSON.stringify(requestBody);
      return {
        response: {
          order_total: previewQuoteSize,
          commission_total: "0",
          quote_size: previewQuoteSize,
          base_size: previewBaseSize,
          est_average_filled_price: fillPrice,
          best_bid: bestBid,
          best_ask: bestAsk,
          preview_id: `sim-preview-${randomUUID()}`,
          errs: [],
          warning: [],
        },
        transport: {
          method: "SIMULATED",
          host: "none",
          path: "/api/v3/brokerage/orders/preview",
          sent_body_digest: digestBytes(serializedBody),
        },
      };
    },
    mandateAdapter: createSimulatedMandateAdapter({ now }),
    consumeGrant: async (planId, intentId) => {
      const grant = `${planId}:${intentId}`;
      if (consumed.has(grant) || consumedPlans.has(planId)) {
        throw new Error(
          "human-confirmed execution grant has already been consumed",
        );
      }
      consumed.add(grant);
      consumedPlans.add(planId);
    },
    markGrant: async () => {},
    preflightNonce,
    onProgress,
  });
  const { record_digest: _previousDigest, ...record } = liveShapedRecord;
  const simulatedRecord = {
    ...record,
    artifact_class: "SIMULATED",
    target_environment: plan.policy.environment,
    run_mode: "NO_NETWORK_SIMULATION",
    fixture_clock: {
      mode: "RUN_RELATIVE",
      observed_at: fixtureNow.toISOString(),
      max_market_age_ms: capabilityProfile.max_market_age_ms,
      max_preview_age_ms: capabilityProfile.max_preview_age_ms,
    },
  };
  return {
    ...simulatedRecord,
    record_digest: digest(simulatedRecord),
  };
}
