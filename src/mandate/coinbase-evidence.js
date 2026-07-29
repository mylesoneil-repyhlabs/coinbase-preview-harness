import {
  compareDecimals,
  parseDecimal,
  priceBoundFromBps,
} from "../decimal.js";
import { digest, digestBytes } from "../evidence.js";
import { derivePreviewSettlement } from "../execution-policy.js";
import { COINBASE_EVIDENCE_CATEGORY } from "./coinbase-policy.js";
import { parseCoinbaseSolution } from "./coinbase-solution.js";

function slippageBps(fillValue, referenceValue, side) {
  const fill = parseDecimal(fillValue, "estimated fill price");
  const reference = parseDecimal(referenceValue, "reference price");
  const scale = Math.max(fill.scale, reference.scale);
  const fillScaled =
    fill.coefficient * 10n ** BigInt(scale - fill.scale);
  const referenceScaled =
    reference.coefficient * 10n ** BigInt(scale - reference.scale);
  if (referenceScaled <= 0n || fillScaled <= 0n) {
    throw new Error("fill and reference prices must be positive");
  }
  const adverse =
    side === "BUY"
      ? fillScaled - referenceScaled
      : referenceScaled - fillScaled;
  if (adverse <= 0n) return 0;
  const numerator = adverse * 10_000n;
  const quotient = numerator / referenceScaled;
  const roundedUp =
    numerator % referenceScaled === 0n ? quotient : quotient + 1n;
  if (roundedUp > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("slippage exceeds the safe policy integer range");
  }
  return Number(roundedUp);
}

export function extractSimulatedCoinbaseEvidence(
  solution,
  now = new Date(),
) {
  const envelope = parseCoinbaseSolution(solution);
  const payload = envelope.create_payload;
  const configuration = payload?.order_configuration?.sor_limit_ioc;
  const market = envelope.claimed_evidence?.market;
  const preview = envelope.claimed_evidence?.preview;
  const funding = envelope.claimed_evidence?.funding;
  const descriptor = envelope.action_descriptor;
  if (!configuration || !market || !preview || !funding || !descriptor) {
    throw new Error(
      "Coinbase proposal omitted required action or evidence claims",
    );
  }
  const sizeField = payload.side === "BUY" ? "quote_size" : "base_size";
  const proposal = {
    product_id: payload.product_id,
    side: payload.side,
    type: "limit",
    time_in_force: "IOC",
    [sizeField]: configuration[sizeField],
    limit_price: configuration.limit_price,
  };
  const settlement = derivePreviewSettlement(
    {
      side: payload.side,
    },
    proposal,
    preview,
  );
  const createPayloadDigest = digestBytes(
    envelope.create_payload_serialized,
  );
  const previewRequestDigest = digest(envelope.preview_request);
  const previewRequestMatchesCreate =
    envelope.preview_request?.product_id === payload.product_id &&
    envelope.preview_request?.side === payload.side &&
    digest(envelope.preview_request?.order_configuration) ===
      digest(payload.order_configuration);
  const adverseSlippageBps = slippageBps(
    preview.est_average_filled_price,
    payload.side === "BUY" ? market.best_ask : market.best_bid,
    payload.side,
  );
  const priceReferenceValue =
    payload.side === "BUY" ? market.best_ask : market.best_bid;
  const authorizedLimitPrice = priceBoundFromBps(
    priceReferenceValue,
    descriptor.constraints.max_slippage_bps,
    market.price_increment,
    payload.side,
  );
  const limitPriceComparison = compareDecimals(
    configuration.limit_price,
    authorizedLimitPrice,
  );
  const limitPriceWithinBound =
    payload.side === "BUY"
      ? limitPriceComparison <= 0
      : limitPriceComparison >= 0;
  const settlementComparison = compareDecimals(
    settlement.value,
    descriptor.constraints.settlement.value,
  );
  const settlementWithinLimit =
    settlement.kind === descriptor.constraints.settlement.kind &&
    (settlement.kind === "MAX_QUOTE_DEBIT"
      ? settlementComparison <= 0
      : settlementComparison >= 0);
  const sizeComparison = compareDecimals(
    configuration[sizeField],
    descriptor.size.value,
  );
  const sizeWithinLimit =
    descriptor.size.operator === "EXACT"
      ? sizeComparison === 0
      : descriptor.size.operator === "MAX" && sizeComparison <= 0;
  const marketCondition = descriptor.constraints.market_condition;
  let marketConditionMet = marketCondition == null;
  if (marketCondition) {
    const marketReference =
      marketCondition.reference === "BEST_ASK"
        ? market.best_ask
        : market.best_bid;
    const previewReference =
      marketCondition.reference === "BEST_ASK"
        ? preview.best_ask
        : preview.best_bid;
    const marketComparison = compareDecimals(
      marketReference,
      marketCondition.value,
    );
    const previewComparison = compareDecimals(
      previewReference,
      marketCondition.value,
    );
    marketConditionMet =
      marketCondition.operator === "AT_OR_BELOW"
        ? marketComparison <= 0 && previewComparison <= 0
        : marketComparison >= 0 && previewComparison >= 0;
  }
  return {
    category: COINBASE_EVIDENCE_CATEGORY,
    environment: "production",
    execution_domain: "coinbase_custodial_ledger",
    product_id: payload.product_id,
    base_asset: market.base_asset,
    quote_asset: market.quote_asset,
    side: payload.side,
    order_type: "sor_limit_ioc",
    time_in_force: "ioc",
    size_field: sizeField,
    size_value: configuration[sizeField],
    size_operator: descriptor.size.operator,
    size_within_limit: sizeWithinLimit,
    limit_price: configuration.limit_price,
    price_reference_value: priceReferenceValue,
    authorized_limit_price: authorizedLimitPrice,
    limit_price_within_bound: limitPriceWithinBound,
    slippage_bps: adverseSlippageBps,
    slippage_within_limit:
      adverseSlippageBps <=
      descriptor.constraints.max_slippage_bps,
    commission_value: preview.commission_total,
    commission_within_limit:
      compareDecimals(
        preview.commission_total,
        descriptor.constraints.max_commission.value,
      ) <= 0,
    settlement_kind: settlement.kind,
    settlement_value: settlement.value,
    settlement_within_limit: settlementWithinLimit,
    market_condition_reference: marketCondition?.reference ?? "NONE",
    market_condition_operator: marketCondition?.operator ?? "NONE",
    market_condition_value: marketCondition?.value ?? "0",
    market_condition_met: marketConditionMet,
    funding_asset: funding.funding_asset,
    funding_available: funding.available_balance,
    funding_required: funding.required_available,
    funding_evidence_digest: funding.evidence_digest,
    funding_sufficient:
      compareDecimals(
        funding.available_balance,
        funding.required_available,
      ) >= 0,
    action_descriptor_digest: descriptor.descriptor_digest,
    portfolio_fingerprint:
      envelope.claimed_evidence.portfolio_fingerprint,
    credential_fingerprint:
      envelope.claimed_evidence.credential_fingerprint,
    evaluated_at_epoch_ms: now.getTime(),
    preview_id: preview.preview_id,
    preview_present:
      typeof preview.preview_id === "string" &&
      preview.preview_id.length > 0,
    create_preview_id: payload.preview_id,
    preview_request_matches_create: previewRequestMatchesCreate,
    create_payload_digest: createPayloadDigest,
    claimed_create_payload_digest: envelope.create_payload_digest,
    preview_request_digest: previewRequestDigest,
    claimed_preview_request_digest: envelope.preview_request_digest,
    market_status: market.status,
    trading_disabled: market.product_flags.trading_disabled,
    product_disabled: market.product_flags.is_disabled,
    view_only: market.product_flags.view_only,
  };
}
