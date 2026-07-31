import { guardDecision, verifyGuardReceipt } from "../guard-receipt.js";

const SIMULATED_SOURCE = "SIMULATED_FIXTURE_NOT_COINBASE";

function decimal(value) {
  return typeof value === "string" ? value : null;
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
  if (record.policy.side === "BUY") {
    return {
      debit: {
        asset: record.policy.quote_asset,
        value:
          decimal(record.preview_check?.settlement?.value) ??
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
        decimal(record.preview_check?.settlement?.value) ??
        decimal(preview.order_total),
    },
    estimated_fee: {
      asset: record.policy.quote_asset,
      value: decimal(preview.commission_total),
    },
  };
}

function receiptView(record) {
  const receipt = record?.guard_receipt;
  if (!receipt) return null;
  let verified = false;
  try {
    verified =
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

export function advisorGuardResultView(record) {
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
