import { randomUUID } from "node:crypto";
import {
  consumeAuthorization,
  consumeExecutionPlan,
  markAuthorization,
  markExecutionPlan,
} from "./authorization-store.js";
import {
  buildCoinbaseCreateRequest,
  buildCoinbasePreviewRequest,
} from "./coinbase-order.js";
import { verifyDeltaDecision } from "./delta-client.js";
import { digest, digestBytes } from "./evidence.js";
import { assertBoundExecution } from "./execution-binding.js";
import {
  evaluateExecutionPreview,
  evaluateExecutionProposal,
  selectExecutionPreviewEvidence,
} from "./execution-policy.js";
import { normalizeCoinbaseMarketData } from "./market.js";
import { assertPolicyWithinSafetyProfile } from "./policy-validator.js";
import { proposeSpotOrder } from "./proposer.js";
import { sanitize } from "./sanitize.js";
import { JWT_PROFILE } from "./permissions.js";
import { reconcileSubmittedOrder } from "./reconciliation.js";

function finalRecord(record) {
  const safe = sanitize(record);
  return { ...safe, record_digest: digest(safe) };
}

function validAttestation(attestation) {
  return (
    attestation?.can_view === true &&
    attestation?.can_trade === true &&
    attestation?.can_transfer === false &&
    attestation?.can_receive === false &&
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

export async function runExecutionPipeline({
  mode,
  plan,
  confirmPolicyDigest,
  boundExecution,
  confirmExecutionDigest,
  safetyProfile,
  attestation,
  getProduct,
  getBestBidAsk,
  previewAdapter,
  deltaAdapter,
  createAdapter,
  getOrderAdapter,
  listFillsAdapter,
  deltaPublicKey,
  executionConfirmedAt,
  now = () => new Date(),
  consume = consumeAuthorization,
  markConsumed = markAuthorization,
  consumePlan = consumeExecutionPlan,
  markPlan = markExecutionPlan,
}) {
  if (!["LIVE", "PROBE"].includes(mode)) {
    throw new Error("Execution mode must be exactly LIVE or PROBE");
  }
  const boundPlan = assertBoundExecution(
    boundExecution,
    attestation,
    confirmExecutionDigest,
  );
  if (boundPlan.plan_id !== plan?.plan_id) {
    throw new Error("Execution plan does not match its confirmed binding");
  }
  const startedAt = now();
  const confirmedAt =
    executionConfirmedAt instanceof Date
      ? new Date(executionConfirmedAt.getTime())
      : new Date(executionConfirmedAt);
  if (!Number.isFinite(confirmedAt.getTime())) {
    throw new Error("Final execution confirmation time is required");
  }
  if (confirmedAt.getTime() > startedAt.getTime() + 2_000) {
    throw new Error("Final execution confirmation time is in the future");
  }
  const record = {
    schema_version: "delta.coinbase.execution_record.v1",
    artifact_class: mode,
    generated_at: startedAt.toISOString(),
    status: "BLOCKED",
    source_intent_digest: plan?.source_intent?.digest ?? null,
    policy: plan?.policy ?? null,
    policy_digest: plan?.policy_digest ?? null,
    safety_profile: plan?.safety_profile ?? null,
    confirmation: {
      supplied_digest: confirmPolicyDigest ?? null,
      matched: false,
      execution_digest: boundExecution.execution_digest,
      supplied_execution_digest: confirmExecutionDigest ?? null,
      execution_matched:
        boundExecution.execution_digest === confirmExecutionDigest,
    },
    credential_binding: attestation
      ? {
          portfolio_fingerprint: attestation.portfolio_fingerprint,
          credential_fingerprint: attestation.key_fingerprint,
        }
      : null,
    market: null,
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
      persistence_warnings: [],
    },
    failure: null,
  };

  let consumedJti = null;
  let consumedPlanId = null;
  try {
    if (plan?.schema_version !== "delta.coinbase.execution_plan.v1") {
      throw new Error("Execution plan schema is invalid");
    }
    if (plan.status !== "AWAITING_HUMAN_CONFIRMATION") {
      throw new Error("Execution plan is not ready for confirmation");
    }
    if (typeof plan.plan_id !== "string" || !plan.plan_id) {
      throw new Error("Execution plan id is missing");
    }
    if (
      typeof plan.source_intent?.text !== "string" ||
      digest(plan.source_intent.text) !== plan.source_intent.digest
    ) {
      throw new Error("Execution plan source intent digest does not match its text");
    }
    if (digest(plan.policy) !== plan.policy_digest) {
      throw new Error("Execution plan policy digest does not match its policy");
    }
    if (confirmPolicyDigest !== plan.policy_digest) {
      throw new Error("Human confirmation digest does not match the compiled policy");
    }
    record.confirmation.matched = true;

    if (
      plan.safety_profile?.id !== safetyProfile.id ||
      plan.safety_profile?.digest !== digest(safetyProfile)
    ) {
      throw new Error("Execution safety profile has changed since planning");
    }
    assertPolicyWithinSafetyProfile(plan.policy, safetyProfile);
    if (!validAttestation(attestation)) {
      throw new Error("Coinbase Trade credential attestation is missing or unsafe");
    }

    const policyExpiresAt = new Date(
      confirmedAt.getTime() + plan.policy.validity.ttl_seconds * 1_000,
    );
    record.confirmation.confirmed_at = confirmedAt.toISOString();
    record.confirmation.policy_expires_at = policyExpiresAt.toISOString();
    if (startedAt.getTime() >= policyExpiresAt.getTime()) {
      throw new Error(
        "Human-confirmed policy expired before credential verification completed",
      );
    }

    const [productResponse, bestBidAskResponse] = await Promise.all([
      getProduct(plan.policy.product_id),
      getBestBidAsk(plan.policy.product_id),
    ]);
    const market = normalizeCoinbaseMarketData(
      productResponse,
      bestBidAskResponse,
      plan.policy.product_id,
    );
    assertFreshTimestamp(
      market.observed_at,
      now(),
      safetyProfile.max_market_age_ms,
      "Coinbase market evidence",
    );
    record.market = market;

    const proposed = proposeSpotOrder(plan.policy, market, { now: startedAt });
    record.proposal = proposed;
    const proposalCheck = evaluateExecutionProposal(
      plan.policy,
      proposed.action,
      market,
    );
    record.proposal_check = proposalCheck;
    if (proposalCheck.verdict !== "ALLOW") {
      throw new Error("Agent proposal failed the deterministic policy check");
    }

    const previewRequest = buildCoinbasePreviewRequest(proposed.action);
    const previewResult = await previewAdapter(previewRequest);
    const previewResponse = previewResult?.response ?? previewResult;
    const selectedPreview = selectExecutionPreviewEvidence(previewResponse);
    const previewCollectedAt = now().toISOString();
    record.preview = {
      collected_at: previewCollectedAt,
      evidence: selectedPreview,
      evidence_digest: digest({
        market,
        preview: selectedPreview,
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
    if (previewCheck.verdict !== "ALLOW") {
      throw new Error("Coinbase preview failed the deterministic policy check");
    }
    if (mode === "PROBE") {
      assertSubmissionWindow({
        current: now(),
        policyExpiresAt,
        proposalExpiresAt: proposed.expires_at,
        marketObservedAt: market.observed_at,
        previewCollectedAt,
        safetyProfile,
      });
      record.status = "PREVIEW_PROBE_PASS";
      return finalRecord(record);
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
    const expectedBindings = deepFreeze({
      plan_id: plan.plan_id,
      execution_digest: boundExecution.execution_digest,
      execution_confirmed_at: confirmedAt.toISOString(),
      policy_expires_at: policyExpiresAt.toISOString(),
      policy_digest: plan.policy_digest,
      proposal_digest: proposed.proposal_digest,
      evidence_digest: record.preview.evidence_digest,
      create_payload_digest: createPayloadDigest,
      portfolio_fingerprint: attestation.portfolio_fingerprint,
      credential_fingerprint: attestation.key_fingerprint,
      client_order_id: clientOrderId,
      preview_id: previewResponse.preview_id,
    });
    const evaluationRequest = deepFreeze(structuredClone({
      schema_version: "delta.coinbase.evaluation_request.v1",
      requested_at: now().toISOString(),
      plan_id: plan.plan_id,
      execution_digest: boundExecution.execution_digest,
      execution_confirmed_at: confirmedAt.toISOString(),
      policy_expires_at: policyExpiresAt.toISOString(),
      source_intent_digest: plan.source_intent.digest,
      policy: plan.policy,
      policy_digest: plan.policy_digest,
      proposal: proposed,
      proposal_digest: proposed.proposal_digest,
      evidence: {
        market,
        preview: selectedPreview,
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
    const deltaDecision = await deltaAdapter(evaluationRequest, expectedBindings);
    if (
      JSON.stringify(createPayload) !== createPayloadSerialized ||
      JSON.stringify(evaluationRequest.create_payload) !==
        evaluationRequest.create_payload_serialized ||
      digestBytes(evaluationRequest.create_payload_serialized) !==
        createPayloadDigest
    ) {
      throw new Error(
        "The Coinbase Create payload changed during delta evaluation",
      );
    }
    verifyDeltaDecision(deltaDecision, expectedBindings, deltaPublicKey, {
      now: now(),
    });
    record.delta = {
      decision_id: deltaDecision.decision_id,
      decision: deltaDecision.decision,
      evaluated_at: deltaDecision.evaluated_at,
      expires_at: deltaDecision.expires_at,
      bindings: deltaDecision.bindings,
      signature_verified: true,
      one_time_grant_digest: digest(deltaDecision.authorization.jti),
    };

    const preSubmitNow = now();
    assertSubmissionWindow({
      current: preSubmitNow,
      policyExpiresAt,
      proposalExpiresAt: proposed.expires_at,
      deltaExpiresAt: deltaDecision.expires_at,
      marketObservedAt: market.observed_at,
      previewCollectedAt,
      safetyProfile,
    });

    consumedPlanId = plan.plan_id;
    await consumePlan(consumedPlanId, {
      status: "SUBMITTING",
      plan_id: plan.plan_id,
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
    consumedJti = deltaDecision.authorization.jti;
    await consume(consumedJti, {
      status: "SUBMITTING",
      consumed_at: now().toISOString(),
      plan_id: plan.plan_id,
      policy: plan.policy,
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

    const finalSubmitNow = now();
    assertSubmissionWindow({
      current: finalSubmitNow,
      policyExpiresAt,
      proposalExpiresAt: proposed.expires_at,
      deltaExpiresAt: deltaDecision.expires_at,
      marketObservedAt: market.observed_at,
      previewCollectedAt,
      safetyProfile,
    });
    if (
      JSON.stringify(createPayload) !== createPayloadSerialized ||
      digestBytes(createPayloadSerialized) !== createPayloadDigest
    ) {
      throw new Error("The authorized Coinbase Create payload changed before submission");
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
        [
          (patch) => markConsumed(consumedJti, patch),
          (patch) => markPlan(consumedPlanId, patch),
        ],
        {
          status: "SUBMISSION_UNCERTAIN",
          error: error instanceof Error ? error.message : String(error),
        },
        record.execution.persistence_warnings,
      );
      return finalRecord(record);
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
          [
            (patch) => markConsumed(consumedJti, patch),
            (patch) => markPlan(consumedPlanId, patch),
          ],
          { status: "COINBASE_REJECTED", error: error.message },
          record.execution.persistence_warnings,
        );
        return finalRecord(record);
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
        [
          (patch) => markConsumed(consumedJti, patch),
          (patch) => markPlan(consumedPlanId, patch),
        ],
        {
          status: "SUBMISSION_UNCERTAIN",
          error: error instanceof Error ? error.message : String(error),
        },
        record.execution.persistence_warnings,
      );
      return finalRecord(record);
    }
    record.execution = {
      ...record.execution,
      adapter_invoked: true,
      order_submitted: true,
      ...submitted,
    };
    await bestEffortMark(
      [
        (patch) => markConsumed(consumedJti, patch),
        (patch) => markPlan(consumedPlanId, patch),
      ],
      { status: "SUBMITTED", order_id: submitted.order_id },
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
        [
          (patch) => markConsumed(consumedJti, patch),
          (patch) => markPlan(consumedPlanId, patch),
        ],
        {
          status: "RECONCILIATION_PENDING",
          order_id: submitted.order_id,
          error: error instanceof Error ? error.message : String(error),
        },
        record.execution.persistence_warnings,
      );
      return finalRecord(record);
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
        [
          (patch) => markConsumed(consumedJti, patch),
          (patch) => markPlan(consumedPlanId, patch),
        ],
        {
          status: "RECONCILIATION_PENDING",
          order_id: submitted.order_id,
          error: error instanceof Error ? error.message : String(error),
        },
        record.execution.persistence_warnings,
      );
      return finalRecord(record);
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
      [
        (patch) => markConsumed(consumedJti, patch),
        (patch) => markPlan(consumedPlanId, patch),
      ],
      {
        status: record.status,
        order_id: submitted.order_id,
        reconciliation: record.reconciliation,
        error: record.failure?.message ?? null,
      },
      record.execution.persistence_warnings,
    );
    return finalRecord(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (consumedJti || consumedPlanId) {
      await bestEffortMark(
        [
          consumedJti ? (patch) => markConsumed(consumedJti, patch) : null,
          consumedPlanId ? (patch) => markPlan(consumedPlanId, patch) : null,
        ],
        {
          status: "PRE_SUBMISSION_ABORTED",
          error: message,
        },
        record.execution.persistence_warnings,
      );
    }
    record.failure = {
      stage:
        consumedJti || consumedPlanId ? "POST_AUTHORIZATION" : "PRE_EXECUTION_GATE",
      message,
    };
    return finalRecord(record);
  }
}
