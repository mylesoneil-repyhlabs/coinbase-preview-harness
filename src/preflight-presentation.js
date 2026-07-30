import { GUARD_MODES, guardDecision } from "./guard-receipt.js";

function humanDecimal(value, maximumFractionDigits = 8) {
  if (value == null) return "—";
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const [integer, fraction = ""] = text.split(".");
  const trimmed = fraction
    .slice(0, maximumFractionDigits)
    .replace(/0+$/, "");
  return trimmed ? `${integer}.${trimmed}` : integer;
}

function sizeText(policy) {
  if (!policy?.size) return "size unavailable";
  return `${policy.size.operator === "MAX" ? "up to" : "exactly"} ${humanDecimal(policy.size.value)} ${policy.size.asset}`;
}

function conditionText(policy) {
  const condition = policy?.market_condition;
  if (!condition) return "with no absolute market-price condition";
  const relation =
    condition.operator === "AT_OR_BELOW" ? "at or below" : "at or above";
  const reference =
    condition.reference === "BEST_ASK" ? "best ask" : "best bid";
  return `only while Coinbase's fresh ${reference} is ${relation} ${humanDecimal(condition.value)} ${condition.asset}`;
}

function settlementText(policy) {
  const settlement = policy?.limits?.settlement;
  return settlement?.kind === "MAX_QUOTE_DEBIT"
    ? `all-in debit no more than ${humanDecimal(settlement.value)} ${policy.quote_asset}`
    : `net proceeds at least ${humanDecimal(settlement?.value)} ${policy?.quote_asset}`;
}

function mandateLines(policy, actionDescriptor) {
  if (!policy) return ["Mandate details are unavailable."];
  const fundingAsset =
    actionDescriptor?.funding?.asset ??
    (policy.side === "BUY" ? policy.quote_asset : policy.base_asset);
  return [
    `${policy.side === "BUY" ? "Buy" : "Sell"}: ${sizeText(policy)} on ${policy.product_id}`,
    `Condition: ${conditionText(policy)}`,
    `Execution: price-bounded IOC limit; partial fills ${policy.partial_fill_policy === "ALLOW" ? "allowed" : "not allowed"}; slippage no more than ${policy.limits?.max_slippage_bps ?? "—"} bps`,
    `Economics: fee no more than ${humanDecimal(policy.limits?.max_commission?.value)} ${policy.quote_asset}; ${settlementText(policy)}`,
    `Funding: held ${fundingAsset} only; no asset conversion`,
    `Validity: one use; expires ${policy.validity?.ttl_seconds ?? "—"} seconds after authorization`,
  ];
}

export function mandateSentence(policy, actionDescriptor = null) {
  if (!policy) return "Mandate details are unavailable.";
  return mandateLines(policy, actionDescriptor).join(" · ");
}

function proposalSentence(record) {
  const action = record?.proposal?.action;
  if (!action) {
    const stage = record?.failure?.stage;
    const friendlyStage = {
      PRE_EXECUTION_GATE: "authorization",
      VIEW_ONLY_CREDENTIAL: "the View-only credential check",
      VIEW_ONLY_PREFLIGHT: "the View-only evidence check",
      PRODUCT: "the product check",
      BEST_BID_ASK: "the market-data check",
      ACCOUNTS: "the held-funds check",
      PREVIEW: "Coinbase Preview",
    }[stage];
    return stage
      ? `Not created — verification stopped at ${friendlyStage ?? stage.toLowerCase().replaceAll("_", " ")}.`
      : "Not created — required evidence was unavailable.";
  }
  const size =
    action.quote_size != null
      ? `${humanDecimal(action.quote_size)} ${record.policy.quote_asset}`
      : `${humanDecimal(action.base_size)} ${record.policy.base_asset}`;
  const conditionNote = record.policy?.market_condition
    ? " · the condition checks fresh BBO; the IOC limit separately caps slippage"
    : "";
  return `${action.side} ${size} on ${action.product_id} · IOC limit ${humanDecimal(action.limit_price)} ${record.policy.quote_asset}${conditionNote}`;
}

function impactSentence(record) {
  const preview = record?.preview?.evidence;
  if (!preview) return "Not calculated — no complete Preview evidence.";
  if (record.policy?.side === "BUY") {
    return `up to ${humanDecimal(record.preview_check?.settlement?.value ?? preview.order_total)} ${record.policy.quote_asset} debited · estimated ${humanDecimal(preview.base_size)} ${record.policy.base_asset} received · ${humanDecimal(preview.commission_total)} ${record.policy.quote_asset} fee`;
  }
  return `sell ${humanDecimal(preview.base_size)} ${record.policy.base_asset} · estimated ${humanDecimal(record.preview_check?.settlement?.value ?? preview.order_total)} ${record.policy.quote_asset} net proceeds · ${humanDecimal(preview.commission_total)} ${record.policy.quote_asset} fee`;
}

function ageLabel(source) {
  if (!source) return "not available";
  const age = Number.isFinite(source.age_ms) ? source.age_ms : null;
  if (age == null) return "age unavailable";
  if (age < 1_000) return "<1s old";
  return `${Math.ceil(age / 1_000)}s old`;
}

function evidenceSentence(record, mode) {
  const observedAt =
    record.sources?.preview?.received_at ??
    record.sources?.best_bid_ask?.observed_at ??
    record.generated_at ??
    "time unavailable";
  const marketReference =
    record.policy?.side === "SELL" ? record.market?.best_bid : record.market?.best_ask;
  const marketName =
    record.policy?.side === "SELL" ? "best bid" : "best ask";
  const facts = [];
  if (record.funding?.available_balance != null) {
    facts.push(
      `${humanDecimal(record.funding.available_balance)} ${record.funding.funding_asset} available`,
    );
  }
  if (marketReference != null) {
    facts.push(
      `${marketName} ${humanDecimal(marketReference)} ${record.policy?.quote_asset}`,
    );
  }
  if (record.preview?.evidence) {
    facts.push("exact Preview economics");
  }
  if (facts.length === 0) {
    return mode === GUARD_MODES.DRY_RUN
      ? "no simulated market, balance, or Preview evidence was reached"
      : "no complete Coinbase balance, product, BBO, or Preview evidence was collected";
  }
  if (mode === GUARD_MODES.DRY_RUN) {
    return `simulated ${facts.join(" · ")} · checked ${observedAt}`;
  }
  return `${facts.join(" · ")} · balances ${ageLabel(record.sources?.accounts)} · product ${ageLabel(record.sources?.product)} · BBO ${ageLabel(record.sources?.best_bid_ask)} · Preview ${ageLabel(record.sources?.preview)} · checked ${observedAt}`;
}

export function formatGuardResult(record, { details = false } = {}) {
  const mode =
    record?.guard_receipt?.mode ??
    record?.guard_mode ??
    GUARD_MODES.DRY_RUN;
  const decision =
    record?.guard_receipt?.decision ?? guardDecision(record, mode);
  const factsReached = Boolean(
    record?.sources?.accounts ||
      record?.sources?.product ||
      record?.sources?.best_bid_ask ||
      record?.sources?.preview,
  );
  const banner =
    mode === GUARD_MODES.DRY_RUN
      ? factsReached
        ? "DRY RUN · SIMULATED FACTS · NO ORDER SUBMITTED"
        : "DRY RUN · STOPPED BEFORE EVIDENCE · NO ORDER SUBMITTED"
      : factsReached
        ? "VIEW ONLY · COINBASE PREFLIGHT · NO ORDER CAN BE SENT"
        : "VIEW ONLY · NO COMPLETE COINBASE EVIDENCE · NO ORDER CAN BE SENT";
  const lines = [
    banner,
    "",
    "Mandate captured",
    ...mandateLines(record.policy, record.action_descriptor),
    "",
    "Proposal",
    proposalSentence(record),
    "",
    `${mode === GUARD_MODES.VIEW_ONLY_PREFLIGHT && decision.outcome === "PASS" ? "VIEW-ONLY PREFLIGHT PASS" : decision.outcome} — ${decision.reason}`,
    `Impact: ${impactSentence(record)}`,
    `Checked: ${evidenceSentence(record, mode)}`,
  ];
  const proposalReached = Boolean(record?.proposal);
  const previewReached = Boolean(record?.preview?.evidence);
  if (mode === GUARD_MODES.DRY_RUN) {
    lines.push(
      decision.outcome === "PASS" && proposalReached && previewReached
        ? "Boundary: local Delta simulation checked this exact proposal; simulated one-time eligibility was consumed. No Coinbase contact, executor, Create, order, or money movement."
        : "Boundary: local dry run stopped safely. No Coinbase contact, execution eligibility, Create, order, or money movement.",
    );
  } else {
    lines.push(
      decision.outcome === "PASS" && proposalReached && previewReached
        ? "Boundary: View-only preflight, not Delta authorization. Preview is point-in-time evidence, not an order or price guarantee; Create and execution remain unavailable."
        : "Boundary: View-only verification stopped safely. No execution grant, Create, order, or money movement.",
    );
  }
  if (decision.recovery) lines.push(`Next: ${decision.recovery}`);
  lines.push(
    "",
    "Local receipt saved with the run history. Ask for details to see hashes and normalized metadata.",
  );
  if (details) {
    lines.push(
      "",
      "Technical details",
      `Policy digest: ${record.policy_digest ?? "unavailable"}`,
      `Proposal digest: ${record.proposal?.proposal_digest ?? "unavailable"}`,
      `Preflight fingerprint: ${record.preflight?.fingerprint ?? "unavailable"}`,
      `Receipt digest: ${record.guard_receipt?.receipt_digest ?? "unavailable"}`,
      `Receipt proof class: ${record.guard_receipt?.proof_class ?? "unavailable"}`,
      `Receipt limitation: ${record.guard_receipt?.proof_limit ?? "unavailable"}`,
      `Record digest: ${record.record_digest ?? "unavailable"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatMandateCaptured(plan, { details = false } = {}) {
  const lines = [
    "MANDATE CAPTURED · AWAITING YOUR AUTHORIZATION · NO ORDER CAN BE SENT",
    "",
    ...mandateLines(plan.policy, plan.action_descriptor),
    "",
    'Reply “Authorize this mandate” to run the credential-free dry run. The installed skill will bind that new message to this exact saved policy; you do not need to handle a hash.',
    "",
    "Optional: ask to use a View-only Coinbase key for permissions, held balances, this product, BBO, and Preview. Create is unavailable in this release.",
  ];
  if (details) {
    lines.push(
      `Plan: ${plan.__path ?? "saved privately"}`,
      `Policy digest: ${plan.policy_digest}`,
      `Source-intent digest: ${plan.source_intent?.digest ?? "unavailable"}`,
      `Canonical action digest: ${plan.action_descriptor?.descriptor_digest ?? "unavailable"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatHistory(entries) {
  if (!entries.length) {
    return (
      "GUARD HISTORY · LOCAL AND PRIVATE · NO ORDERS\n\n" +
      "No Guard preflights have been recorded yet.\n"
    );
  }
  const lines = [
    "GUARD HISTORY · LOCAL AND PRIVATE · NO ORDERS",
    "",
  ];
  for (const entry of entries) {
    const mandate = entry.input?.mandate;
    const amount = mandate?.size
      ? `${mandate.size.operator === "MAX" ? "up to" : "exactly"} ${humanDecimal(mandate.size.value)} ${mandate.size.asset}`
      : "amount unavailable";
    const condition = mandate?.market_condition
      ? conditionText({ market_condition: mandate.market_condition })
      : "no market-price condition";
    lines.push(
      `${entry.recorded_at} · ${entry.mode === GUARD_MODES.DRY_RUN ? "SIMULATED" : "VIEW ONLY"} · ${entry.outcome}${entry.current_status ? ` · ${entry.current_status}` : ""}`,
      `${mandate?.side ?? "—"} ${amount} on ${mandate?.product_id ?? "—"} · ${condition}`,
      `${entry.reason}`,
      `Evidence: ${entry.provenance} · ${entry.evidence?.age_ms ?? "?"}ms old at capture · no order submitted`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
