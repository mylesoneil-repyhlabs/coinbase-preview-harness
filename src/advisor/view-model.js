import { guardDecision, verifyGuardReceipt } from "../guard-receipt.js";
import {
  buildCoinbaseCreateRequest,
  buildCoinbasePreviewRequest,
} from "../coinbase-order.js";
import { digest, digestBytes } from "../evidence.js";
import { derivePreviewSettlement } from "../execution-policy.js";
import { assertCanonicalSpotAction } from "../spot-action.js";

const SIMULATED_SOURCE = "SIMULATED_FIXTURE_NOT_COINBASE";
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function decimal(value) {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    DECIMAL_PATTERN.test(value)
  )
    ? value
    : null;
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function recordIntegrityVerified(record) {
  if (!record || !sha256(record.record_digest)) return false;
  const { record_digest: recordDigest, ...recordPayload } = record;
  return digest(recordPayload) === recordDigest;
}

function mandateView(policy, descriptor = null) {
  if (!policy) return null;
  return {
    product_id: policy.product_id,
    base_asset: policy.base_asset,
    quote_asset: policy.quote_asset,
    side: policy.side,
    size: {
      operator: policy.size?.operator ?? null,
      denomination: policy.size?.denomination ?? null,
      asset: policy.size?.asset ?? null,
      value: decimal(policy.size?.value),
    },
    condition:
      policy.market_condition == null
        ? null
        : {
            reference: policy.market_condition.reference,
            operator: policy.market_condition.operator,
            asset: policy.market_condition.asset,
            value: decimal(policy.market_condition.value),
          },
    order: {
      type: policy.order_type,
      time_in_force: descriptor?.order?.time_in_force ?? "IOC",
      partial_fills: policy.partial_fill_policy,
    },
    funding: {
      source: descriptor?.funding?.source ?? "COINBASE_AVAILABLE_BALANCE",
      asset:
        descriptor?.funding?.asset ??
        (policy.side === "BUY" ? policy.quote_asset : policy.base_asset),
      required_available:
        decimal(descriptor?.funding?.required_available) ??
        decimal(policy.size?.value),
      conversion_allowed: false,
    },
    limits: {
      max_slippage_bps: policy.limits?.max_slippage_bps ?? null,
      max_commission: {
        asset: policy.limits?.max_commission?.asset ?? null,
        value: decimal(policy.limits?.max_commission?.value),
      },
      settlement: {
        kind: policy.limits?.settlement?.kind ?? null,
        asset: policy.limits?.settlement?.asset ?? null,
        value: decimal(policy.limits?.settlement?.value),
      },
    },
    validity: {
      starts: policy.validity?.starts ?? null,
      ttl_seconds: policy.validity?.ttl_seconds ?? null,
      max_executions: policy.usage?.max_executions ?? null,
    },
  };
}

function issuesView(items, field) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    code: item?.code ?? "UNSPECIFIED",
    message: item?.[field] ?? "This request needs review.",
  }));
}

export function advisorPlanView(plan) {
  const ready = plan?.status === "AWAITING_HUMAN_CONFIRMATION";
  return {
    schema_version: "delta.coinbase.advisor_plan_view.v1",
    plan_id: plan?.plan_id ?? null,
    created_at: plan?.created_at ?? null,
    status: plan?.status ?? "UNAVAILABLE",
    mandate: ready
      ? mandateView(plan.policy, plan.action_descriptor)
      : null,
    clarification: issuesView(
      plan?.compilation?.ambiguities,
      "question",
    ),
    unsupported: issuesView(
      plan?.compilation?.unsupported_constraints,
      "reason",
    ),
    authorization: {
      required: ready,
      state: ready
        ? "AWAITING_USER_CONFIRMATION"
        : "NOT_READY_FOR_CONFIRMATION",
      instruction: ready
        ? "Review the complete mandate, then confirm this exact plan once."
        : "Resolve the listed request details before authorization.",
    },
    boundary: {
      mode: "dry_run",
      source: SIMULATED_SOURCE,
      create_available: false,
      order_submitted: false,
      money_moved: false,
    },
  };
}

function proposalView(record) {
  const action = record?.proposal?.action;
  if (!action) return null;
  return {
    product_id: action.product_id,
    side: action.side,
    type: action.type,
    time_in_force: action.time_in_force,
    quote_size: decimal(action.quote_size),
    base_size: decimal(action.base_size),
    limit_price: decimal(action.limit_price),
  };
}

function impactView(record) {
  const preview = record?.preview?.evidence;
  if (!preview || !record?.policy) return null;
  let settlement = null;
  try {
    settlement = derivePreviewSettlement(
      record.policy,
      record.proposal?.action,
      preview,
    );
  } catch {
    settlement = null;
  }
  if (record.policy.side === "BUY") {
    return {
      debit: {
        asset: record.policy.quote_asset,
        value:
          decimal(settlement?.value) ??
          decimal(preview.order_total),
      },
      estimated_receive: {
        asset: record.policy.base_asset,
        value: decimal(preview.base_size),
      },
      estimated_fee: {
        asset: record.policy.quote_asset,
        value: decimal(preview.commission_total),
      },
    };
  }
  return {
    debit: {
      asset: record.policy.base_asset,
      value: decimal(preview.base_size),
    },
    estimated_receive: {
      asset: record.policy.quote_asset,
      value:
        decimal(settlement?.value) ??
        decimal(preview.order_total),
    },
    estimated_fee: {
      asset: record.policy.quote_asset,
      value: decimal(preview.commission_total),
    },
  };
}

function completeImpactView(record, impact) {
  let expectedSettlement;
  try {
    expectedSettlement = derivePreviewSettlement(
      record.policy,
      record.proposal.action,
      record.preview.evidence,
    );
  } catch {
    return false;
  }
  const expectedDebitAsset =
    record?.policy?.side === "BUY"
      ? record?.policy?.quote_asset
      : record?.policy?.base_asset;
  const expectedReceiveAsset =
    record?.policy?.side === "BUY"
      ? record?.policy?.base_asset
      : record?.policy?.quote_asset;
  return (
    record?.preview_check?.settlement?.kind ===
      expectedSettlement.kind &&
    record?.preview_check?.settlement?.value ===
      expectedSettlement.value &&
    impact?.debit?.asset === expectedDebitAsset &&
    impact?.debit?.value ===
      (record.policy.side === "BUY"
        ? expectedSettlement.value
        : record.preview.evidence.base_size) &&
    impact?.estimated_receive?.asset === expectedReceiveAsset &&
    impact?.estimated_receive?.value ===
      (record.policy.side === "BUY"
        ? record.preview.evidence.base_size
        : expectedSettlement.value) &&
    impact?.estimated_fee?.asset === record?.policy?.quote_asset &&
    impact?.estimated_fee?.value ===
      record.preview.evidence.commission_total &&
    decimal(impact.debit.value) != null &&
    decimal(impact.estimated_receive.value) != null &&
    decimal(impact.estimated_fee.value) != null
  );
}

function receiptView(record) {
  const receipt = record?.guard_receipt;
  if (!receipt) return null;
  let verified = false;
  try {
    verified =
      recordIntegrityVerified(record) &&
      verifyGuardReceipt(receipt, record).verified === true;
  } catch {
    verified = false;
  }
  return {
    receipt_digest: receipt.receipt_digest,
    verified,
    issued_at: receipt.issued_at,
    expires_at: receipt.expires_at,
    mode: receipt.mode,
    proof_class: receipt.proof_class,
    proof_limit: receipt.proof_limit,
    binding_completeness: receipt.binding_completeness,
  };
}

function actionIntegrityVerified(record) {
  try {
    assertCanonicalSpotAction(record.action_descriptor, record.policy);
    assertCanonicalSpotAction(
      record.proposal.action_descriptor,
      record.policy,
    );
    return (
      digest(record.action_descriptor) ===
      digest(record.proposal.action_descriptor)
    );
  } catch {
    return false;
  }
}

function exactRequestBindingsVerified(record) {
  try {
    const previewRequest = buildCoinbasePreviewRequest(
      record.proposal.action,
    );
    const createRequest = buildCoinbaseCreateRequest(
      record.proposal.action,
      record.execution.client_order_id,
      record.preview.evidence.preview_id,
    );
    return (
      digestBytes(JSON.stringify(previewRequest)) ===
        record.preview.request_digest &&
      digestBytes(JSON.stringify(createRequest)) ===
        record.execution.create_payload_digest
    );
  } catch {
    return false;
  }
}

function sourceFactsVerified(record) {
  const accounts = record?.sources?.accounts;
  const product = record?.sources?.product;
  const bestBidAsk = record?.sources?.best_bid_ask;
  const preview = record?.sources?.preview;
  const parsed = Object.fromEntries(
    [
      ["confirmation", record?.confirmation?.confirmed_at],
      ["evidenceRequested", accounts?.requested_at],
      ["evidenceReceived", accounts?.received_at],
      ["bboObserved", bestBidAsk?.observed_at],
      ["previewRequested", preview?.requested_at],
      ["previewReceived", preview?.received_at],
    ].map(([name, value]) => [name, Date.parse(value)]),
  );
  if (
    Object.values(parsed).some((value) => !Number.isFinite(value))
  ) {
    return false;
  }
  const expectedBboAge = Math.max(
    0,
    parsed.evidenceReceived - parsed.bboObserved,
  );
  return (
    accounts?.timestamp_kind === "LOCAL_RECEIPT_TIME" &&
    product?.timestamp_kind === "LOCAL_RECEIPT_TIME" &&
    bestBidAsk?.timestamp_kind === "COINBASE_PRICEBOOK_TIME" &&
    preview?.timestamp_kind === "LOCAL_RECEIPT_TIME" &&
    product?.requested_at === accounts.requested_at &&
    bestBidAsk?.requested_at === accounts.requested_at &&
    product?.received_at === accounts.received_at &&
    bestBidAsk?.received_at === accounts.received_at &&
    accounts?.age_ms === 0 &&
    product?.age_ms === 0 &&
    preview?.age_ms === 0 &&
    bestBidAsk?.age_ms === expectedBboAge &&
    parsed.confirmation <= parsed.evidenceRequested &&
    parsed.evidenceRequested <= parsed.evidenceReceived &&
    parsed.evidenceReceived <= parsed.previewRequested &&
    parsed.previewRequested <= parsed.previewReceived &&
    parsed.bboObserved <= parsed.evidenceReceived + 2_000 &&
    preview?.received_at === record?.preview?.collected_at
  );
}

function viewCredentialScopeVerified(record) {
  const binding = record?.credential_binding;
  const verifiedAt = Date.parse(binding?.verified_at);
  const generatedAt = Date.parse(record?.generated_at);
  const receiveScopeAccepted =
    binding?.can_receive === false ||
    (
      binding?.can_receive === null &&
      binding?.can_receive_reported === false
    );
  return (
    binding?.attestation_schema ===
      "delta.coinbase.view_permission_attestation.v2" &&
    binding?.environment === "coinbase-read-preview" &&
    binding?.request_auth_profile === "CDP_URIS_V1" &&
    binding?.can_view === true &&
    binding?.can_trade === false &&
    binding?.can_transfer === false &&
    receiveScopeAccepted &&
    Number.isFinite(verifiedAt) &&
    Number.isFinite(generatedAt) &&
    verifiedAt <= generatedAt
  );
}

function confirmationWindowVerified(record) {
  const confirmedAt = Date.parse(record?.confirmation?.confirmed_at);
  const policyExpiresAt = Date.parse(
    record?.confirmation?.policy_expires_at,
  );
  const generatedAt = Date.parse(record?.generated_at);
  const preflightExpiresAt = Date.parse(record?.preflight?.expires_at);
  const receiptExpiresAt = Date.parse(
    record?.guard_receipt?.expires_at,
  );
  const ttlSeconds = record?.policy?.validity?.ttl_seconds;
  return (
    Number.isFinite(confirmedAt) &&
    Number.isFinite(policyExpiresAt) &&
    Number.isFinite(generatedAt) &&
    Number.isFinite(preflightExpiresAt) &&
    Number.isFinite(receiptExpiresAt) &&
    Number.isInteger(ttlSeconds) &&
    ttlSeconds > 0 &&
    policyExpiresAt - confirmedAt === ttlSeconds * 1_000 &&
    confirmedAt <= generatedAt &&
    preflightExpiresAt <= policyExpiresAt &&
    receiptExpiresAt <= policyExpiresAt
  );
}

function completeLiveReadinessBindings(record, receipt) {
  const action = record?.proposal?.action;
  const evidence = record?.preview?.evidence;
  const credential = record?.credential_binding;
  const funding = record?.funding;
  const sources = record?.sources;
  return (
    recordIntegrityVerified(record) &&
    record?.schema_version === "delta.coinbase.execution_record.v3" &&
    record?.artifact_class === "PROBE" &&
    record?.status === "PREVIEW_PROBE_PASS" &&
    record?.decision === "PASS" &&
    record?.guard_mode === "view_only_preflight" &&
    record?.boundary?.mode === "view_only_preflight" &&
    record?.boundary?.view_only === true &&
    record?.boundary?.dry_run === false &&
    record?.boundary?.create_available === false &&
    record?.boundary?.no_order_submitted === true &&
    record?.boundary?.money_moved === false &&
    record?.boundary?.coinbase_contacted === true &&
    record?.boundary
      ?.preview_is_not_execution_or_price_guarantee === true &&
    record?.policy != null &&
    sha256(record?.policy_digest) &&
    record?.policy?.usage?.max_executions === 1 &&
    record?.confirmation?.matched === true &&
    record?.confirmation?.execution_matched === true &&
    record?.confirmation?.supplied_digest ===
      record.policy_digest &&
    sha256(record?.confirmation?.execution_digest) &&
    sha256(record?.confirmation?.supplied_execution_digest) &&
    record?.confirmation?.supplied_execution_digest ===
      record.confirmation.execution_digest &&
    sha256(record?.confirmation?.receipt_digest) &&
    confirmationWindowVerified(record) &&
    actionIntegrityVerified(record) &&
    sha256(record?.action_descriptor?.descriptor_digest) &&
    action != null &&
    sha256(record?.proposal?.proposal_digest) &&
    typeof evidence?.preview_id === "string" &&
    evidence.preview_id.length > 0 &&
    sha256(record?.preview?.request_digest) &&
    record?.preview?.transport_body_digest ===
      record.preview.request_digest &&
    sha256(record?.preview?.response_fingerprint) &&
    sha256(record?.preview?.evidence_digest) &&
    sha256(record?.execution?.create_payload_digest) &&
    typeof record?.execution?.client_order_id === "string" &&
    record.execution.client_order_id.length > 0 &&
    exactRequestBindingsVerified(record) &&
    record?.execution?.adapter_invoked === false &&
    record?.execution?.order_submitted === false &&
    record?.execution?.order_id == null &&
    record?.execution?.transmitted_body_digest == null &&
    record?.execution?.one_time_gate_consumed === false &&
    sha256(credential?.credential_fingerprint) &&
    sha256(credential?.portfolio_fingerprint) &&
    viewCredentialScopeVerified(record) &&
    funding?.complete === true &&
    funding?.decision === "PASS" &&
    funding?.portfolio_fingerprint ===
      credential.portfolio_fingerprint &&
    sha256(funding?.evidence_digest) &&
    sources?.accounts?.provenance ===
      "COINBASE_AUTHENTICATED_VIEW" &&
    sources?.accounts?.complete === true &&
    sources?.product?.provenance ===
      "COINBASE_AUTHENTICATED_VIEW" &&
    sources?.best_bid_ask?.provenance ===
      "COINBASE_AUTHENTICATED_VIEW" &&
    sources?.preview?.provenance ===
      "COINBASE_AUTHENTICATED_VIEW" &&
    sourceFactsVerified(record) &&
    sources?.preview?.received_at ===
      record?.preview?.collected_at &&
    record?.proposal_check?.decision === "PASS" &&
    record?.preview_check?.decision === "PASS" &&
    record?.delta == null &&
    record?.preflight?.schema_version ===
      "delta.coinbase.preflight_binding.v1" &&
    sha256(record?.preflight?.nonce_digest) &&
    sha256(record?.preflight?.fingerprint) &&
    typeof record?.preflight?.expires_at === "string" &&
    receipt?.mode === "view_only_preflight" &&
    record?.guard_receipt?.nonce_digest ===
      record?.preflight?.nonce_digest &&
    receipt?.issued_at === record?.generated_at &&
    receipt?.expires_at === record?.preflight?.expires_at &&
    receipt?.binding_completeness === "COMPLETE" &&
    record?.guard_receipt?.provenance?.source ===
      "COINBASE_VIEW_ONLY" &&
    record?.guard_receipt?.provenance?.coinbase_contacted === true &&
    record?.guard_receipt?.provenance
      ?.production_delta_contacted === false &&
    record?.guard_receipt?.decision?.outcome === "PASS" &&
    record?.guard_receipt?.execution_boundary?.create_available ===
      false &&
    record?.guard_receipt?.execution_boundary?.order_submitted ===
      false &&
    record?.guard_receipt?.execution_boundary?.money_moved === false &&
    record?.guard_receipt?.execution_boundary?.one_use_status ===
      "LOCKED"
  );
}

const LIVE_READINESS_PREREQUISITES = Object.freeze([
  "Authenticated execution principal",
  "Production Delta verifier",
  "Isolated View+Trade credential in an executor",
  "Server-issued final review challenge",
  "Durable atomic one-use grant and journal",
  "Server kill-switch epoch",
  "Exact-byte Create service",
  "Submission reconciliation",
  "Separate first-order approval",
]);

function liveReadinessView(
  record,
  receipt,
  { enabled = false, now = new Date() } = {},
) {
  if (enabled !== true || receipt?.verified !== true) return null;
  const bindingsComplete = completeLiveReadinessBindings(
    record,
    receipt,
  );
  if (!bindingsComplete) return null;
  const current = now instanceof Date ? now : new Date(now);
  const receiptExpiry = Date.parse(receipt.expires_at);
  const preflightExpiry = Date.parse(record.preflight.expires_at);
  const policyExpiry = Date.parse(
    record.confirmation.policy_expires_at,
  );
  const evidenceTimes = [
    receipt.issued_at,
    record.generated_at,
    record.confirmation.confirmed_at,
    record.proposal.created_at,
    record.preview.collected_at,
    record.sources.accounts.requested_at,
    record.sources.accounts.received_at,
    record.sources.product.requested_at,
    record.sources.product.received_at,
    record.sources.best_bid_ask.requested_at,
    record.sources.best_bid_ask.received_at,
    record.sources.best_bid_ask.observed_at,
    record.sources.preview.requested_at,
    record.sources.preview.received_at,
  ].map((value) => Date.parse(value));
  if (
    !Number.isFinite(current.getTime()) ||
    !Number.isFinite(receiptExpiry) ||
    !Number.isFinite(preflightExpiry) ||
    !Number.isFinite(policyExpiry) ||
    evidenceTimes.some(
      (timestamp) =>
        !Number.isFinite(timestamp) ||
        timestamp > current.getTime(),
    ) ||
    current.getTime() >=
      Math.min(receiptExpiry, preflightExpiry, policyExpiry)
  ) {
    return null;
  }
  const action = proposalView(record);
  const impact = impactView(record);
  const actionSizeComplete =
    record.policy.side === "BUY"
      ? decimal(action?.quote_size) != null &&
        action?.base_size == null
      : decimal(action?.base_size) != null &&
        action?.quote_size == null;
  if (
    !action ||
    decimal(action.limit_price) == null ||
    !actionSizeComplete ||
    !impact ||
    !completeImpactView(record, impact)
  ) {
    return null;
  }
  const exactAction = {
    ...action,
    base_asset: record.policy.base_asset,
    quote_asset: record.policy.quote_asset,
  };
  return {
    schema_version: "delta.coinbase.live_readiness_preview.v1",
    status: "LOCKED_EXPLANATION_ONLY",
    label: "What remains before any future live order",
    statement:
      "Explanation only. This View-only PASS is not authorization, eligibility, or readiness to trade.",
    exact_action: exactAction,
    mandate_condition:
      mandateView(record.policy, record.action_descriptor)?.condition ??
      null,
    estimated_impact: impact,
    preview_checked_at:
      record.sources.preview.received_at ??
      record.preview.collected_at ??
      null,
    preview_expires_at: record.preflight.expires_at,
    future_one_order_scope: {
      max_orders: 1,
      grant_exists: false,
      statement:
        "A future design would bind one exact order; no execution grant exists.",
    },
    protected_bindings: {
      policy: true,
      action: true,
      proposal: true,
      preview: true,
      evidence: true,
      prospective_create_digest: true,
      credential_scope: true,
      portfolio_scope: true,
      current_preflight: true,
    },
    missing_prerequisites: LIVE_READINESS_PREREQUISITES.map(
      (label) => ({ label, status: "MISSING" }),
    ),
    boundary: {
      orders_off: true,
      create_available: false,
      authorized: false,
      eligible: false,
      ready_to_trade: false,
      final_confirmation_available: false,
      grant_exists: false,
    },
  };
}

export function advisorGuardResultView(
  record,
  { liveReadinessEnabled = false, now = new Date() } = {},
) {
  const rawDecision = guardDecision(record, record?.guard_mode);
  const receipt = receiptView(record);
  const decision =
    rawDecision.outcome === "PASS" &&
    receipt?.verified !== true
      ? {
          outcome: "REVIEW",
          code: "ADVISOR_RECEIPT_UNVERIFIED",
          reason:
            "The protected result could not be verified against this exact check.",
          recovery:
            "Run a fresh protected check. No order was submitted.",
        }
      : rawDecision;
  const viewOnly =
    record?.guard_mode === "view_only_preflight";
  const coinbaseContacted =
    record?.boundary?.coinbase_contacted === true;
  const completeCoinbasePreview =
    coinbaseContacted && Boolean(record?.preview?.evidence);
  const liveReadiness = liveReadinessView(record, receipt, {
    enabled:
      liveReadinessEnabled === true &&
      decision === rawDecision &&
      decision.outcome === "PASS",
    now,
  });
  return {
    schema_version: "delta.coinbase.advisor_guard_result_view.v1",
    mode: record?.guard_mode ?? "dry_run",
    source: !viewOnly
      ? SIMULATED_SOURCE
      : completeCoinbasePreview
        ? "COINBASE_VIEW_ONLY_READS_AND_PREVIEW"
        : coinbaseContacted
          ? "COINBASE_VIEW_ONLY_CHECK_INCOMPLETE"
          : "VIEW_ONLY_NO_COINBASE_EVIDENCE",
    status:
      decision !== rawDecision
        ? "REVIEW"
        : record?.status ?? decision.outcome,
    mandate: mandateView(record?.policy, record?.action_descriptor),
    proposal: proposalView(record),
    decision: {
      outcome: decision.outcome,
      code: decision.code,
      reason: decision.reason,
      recovery: decision.recovery,
    },
    impact: impactView(record),
    checked: {
      at:
        record?.sources?.preview?.received_at ??
        record?.generated_at ??
        null,
      balance: decimal(record?.funding?.available_balance),
      balance_asset: record?.funding?.funding_asset ?? null,
      best_bid: decimal(record?.market?.best_bid),
      best_ask: decimal(record?.market?.best_ask),
      preview_present: Boolean(record?.preview?.evidence),
    },
    delta: {
      kind: viewOnly
        ? "LOCAL_DETERMINISTIC_PREFLIGHT"
        : "LOCAL_DELTA_SIMULATION",
      production_delta_contacted: false,
      decision:
        decision !== rawDecision
          ? "REVIEW"
          : record?.delta?.decision ?? decision.outcome,
      verifier_confirmed:
        decision === rawDecision &&
        record?.delta?.verifier_confirmed === true,
    },
    receipt,
    ...(liveReadiness ? { live_readiness: liveReadiness } : {}),
    boundary: {
      create_available: false,
      order_submitted: false,
      money_moved: false,
      coinbase_contacted: coinbaseContacted,
      one_use_status:
        record?.guard_receipt?.execution_boundary?.one_use_status ??
        "LOCKED",
      statement:
        record?.guard_receipt?.execution_boundary?.statement ??
        "Dry run only. No Coinbase order was submitted.",
    },
  };
}

function showcaseMandateView(mandate) {
  return {
    product_id: mandate?.product_id ?? null,
    side: mandate?.side ?? null,
    max_allocation_usdc: decimal(mandate?.max_allocation_usdc),
    max_market_price_usdc: decimal(mandate?.max_market_price_usdc),
    max_limit_price_usdc: decimal(mandate?.max_limit_price_usdc),
    max_slippage_bps: mandate?.max_slippage_bps ?? null,
    max_fee_usdc: decimal(mandate?.max_fee_usdc),
    max_post_trade_eth_exposure_usdc: decimal(
      mandate?.max_post_trade_eth_exposure_usdc,
    ),
    order_type: mandate?.order_type ?? null,
    max_executions: mandate?.max_executions ?? null,
    ttl_seconds: mandate?.ttl_seconds ?? null,
  };
}

function showcaseAttemptView(attempt) {
  const configuration =
    attempt?.exact_payload?.order_configuration?.sor_limit_ioc ?? {};
  return {
    attempt: attempt?.attempt ?? null,
    proposal: {
      product_id: attempt?.exact_payload?.product_id ?? null,
      side: attempt?.exact_payload?.side ?? null,
      quote_size: decimal(configuration.quote_size),
      base_size: decimal(configuration.base_size),
      limit_price: decimal(configuration.limit_price),
    },
    evidence: {
      source: SIMULATED_SOURCE,
      observed_at: attempt?.evidence?.market?.observed_at ?? null,
      best_ask: decimal(attempt?.evidence?.market?.best_ask),
      estimated_fill_price: decimal(
        attempt?.evidence?.preview?.est_average_filled_price,
      ),
      estimated_fee: decimal(
        attempt?.evidence?.preview?.commission_total,
      ),
      post_trade_exposure: decimal(
        attempt?.economics?.post_trade_eth_exposure_usdc,
      ),
    },
    decision: {
      outcome: attempt?.receipt?.verdict ?? "REVIEW",
      disposition: attempt?.disposition ?? "STOP",
      reasons: Array.isArray(attempt?.constraint_failures)
        ? attempt.constraint_failures.map((failure) => ({
            code: failure.id ?? "CONSTRAINT_FAILED",
            reason:
              failure.reason ??
              "The simulated proposal did not satisfy the mandate.",
          }))
        : [],
    },
    receipt: {
      receipt_digest: attempt?.receipt?.receipt_digest ?? null,
      verified: attempt?.receipt?.verified === true,
      proof_class: "LOCAL_SIMULATION_DIGEST",
      proof_limit:
        "Simulated local integrity evidence, not a production Delta signature or Coinbase evidence.",
    },
  };
}

export function advisorShowcaseView(record) {
  return {
    schema_version: "delta.coinbase.advisor_showcase_view.v1",
    source: SIMULATED_SOURCE,
    status: record?.status ?? "SIMULATION_UNAVAILABLE",
    mandate: showcaseMandateView(record?.mandate),
    authorization: {
      status: record?.authorization?.status ?? "SIMULATION_ONLY",
      live_trade_authorized: false,
      authorized_at: record?.authorization?.authorized_at ?? null,
      expires_at: record?.authorization?.expires_at ?? null,
    },
    attempts: Array.isArray(record?.demo?.bounded_retry?.attempts)
      ? record.demo.bounded_retry.attempts.map(showcaseAttemptView)
      : [],
    controller: {
      result: record?.execution?.status ?? "STOPPED",
      gate: record?.execution?.gate ?? null,
      durable_one_time_grant_issued: false,
      external_executor_invoked: false,
    },
    boundary: {
      coinbase_contacted: false,
      production_delta_contacted: false,
      create_available: false,
      order_submitted: false,
      money_moved: false,
    },
  };
}

export function advisorHistoryView(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    history_id: entry?.history_id ?? null,
    recorded_at: entry?.recorded_at ?? null,
    mode: entry?.mode ?? null,
    outcome: entry?.outcome ?? null,
    reason: entry?.reason ?? null,
    current_status: entry?.current_status ?? null,
    mandate: {
      product_id: entry?.input?.mandate?.product_id ?? null,
      side: entry?.input?.mandate?.side ?? null,
      size: entry?.input?.mandate?.size ?? null,
      market_condition:
        entry?.input?.mandate?.market_condition ?? null,
    },
    evidence: {
      provenance: entry?.provenance ?? null,
      observed_at: entry?.evidence?.observed_at ?? null,
      age_ms: entry?.evidence?.age_ms ?? null,
    },
    receipt: {
      receipt_digest: entry?.receipt?.receipt_digest ?? null,
      expires_at: entry?.receipt?.expires_at ?? null,
    },
    boundary: {
      create_available: false,
      order_submitted: false,
      money_moved: false,
    },
  }));
}

export function advisorActivityView(activity) {
  if (!Array.isArray(activity)) return [];
  return activity.map((entry) => ({
    activity_id: entry.activity_id,
    occurred_at: entry.occurred_at,
    kind: entry.kind,
    status: entry.status,
    product_id: entry.product_id ?? null,
    side: entry.side ?? null,
    decision: entry.decision ?? null,
    receipt_digest: entry.receipt_digest ?? null,
  }));
}
