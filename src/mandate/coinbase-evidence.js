import {
  addDecimals,
  compareDecimals,
  parseDecimal,
} from "../decimal.js";
import { digest, digestBytes } from "../evidence.js";
import {
  COINBASE_EVIDENCE_CATEGORY,
  decimalToMicrounits,
} from "./coinbase-policy.js";
import { parseCoinbaseSolution } from "./coinbase-solution.js";

function decimalRatioBps(fillValue, referenceValue) {
  const fill = parseDecimal(fillValue, "estimated fill price");
  const reference = parseDecimal(referenceValue, "best ask");
  const scale = Math.max(fill.scale, reference.scale);
  const fillScaled =
    fill.coefficient * 10n ** BigInt(scale - fill.scale);
  const referenceScaled =
    reference.coefficient * 10n ** BigInt(scale - reference.scale);
  if (referenceScaled <= 0n || fillScaled <= 0n) {
    throw new Error("fill and reference prices must be positive");
  }
  if (fillScaled <= referenceScaled) return 0;
  const numerator = (fillScaled - referenceScaled) * 10_000n;
  const quotient = numerator / referenceScaled;
  const roundedUp =
    numerator % referenceScaled === 0n ? quotient : quotient + 1n;
  if (roundedUp > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("slippage exceeds the safe policy integer range");
  }
  return Number(roundedUp);
}

export function extractSimulatedCoinbaseEvidence(solution, now = new Date()) {
  const envelope = parseCoinbaseSolution(solution);
  const payload = envelope.create_payload;
  const configuration = payload?.order_configuration?.sor_limit_ioc;
  const market = envelope.claimed_evidence?.market;
  const preview = envelope.claimed_evidence?.preview;
  if (!configuration || !market || !preview) {
    throw new Error("Coinbase proposal omitted required action or evidence claims");
  }

  const createPayloadDigest = digestBytes(
    envelope.create_payload_serialized,
  );
  const previewRequestDigest = digest(envelope.preview_request);
  const previewRequestMatchesCreate =
    envelope.preview_request?.product_id === payload.product_id &&
    envelope.preview_request?.side === payload.side &&
    digest(envelope.preview_request?.order_configuration) ===
      digest(payload.order_configuration);
  const requestedDebitWithCommission = addDecimals(
    configuration.quote_size,
    preview.commission_total,
  );
  // Coinbase's order_total is treated as one estimate, not an authoritative
  // ceiling. The mandate therefore uses the larger of that value and the exact
  // requested quote debit plus commission, so an understated preview cannot
  // weaken the all-in cap.
  const conservativeAllInDebit =
    compareDecimals(preview.order_total, requestedDebitWithCommission) >= 0
      ? preview.order_total
      : requestedDebitWithCommission;
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
    quote_size_microunits: decimalToMicrounits(
      configuration.quote_size,
      "proposal quote size",
    ),
    limit_price_microunits: decimalToMicrounits(
      configuration.limit_price,
      "proposal limit price",
    ),
    slippage_bps: decimalRatioBps(
      preview.est_average_filled_price,
      market.best_ask,
    ),
    commission_microunits: decimalToMicrounits(
      preview.commission_total,
      "preview commission",
    ),
    all_in_debit_microunits: decimalToMicrounits(
      conservativeAllInDebit,
      "conservative all-in debit",
    ),
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
  };
}
