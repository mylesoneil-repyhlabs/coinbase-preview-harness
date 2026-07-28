import { parseDecimal } from "../decimal.js";

export const COINBASE_POLICY_KIND = "coinbase_spot_v2";
export const COINBASE_EVIDENCE_CATEGORY =
  "COINBASE_ADVANCED_SPOT_ORDER";

// This source is the narrow adapter contract exercised by the simulator. It is
// intentionally kept separate from the private Delta implementation; the
// production adapter must validate its concrete type mapping before Create can
// be enabled.
export const COINBASE_SPOT_POLICY_SOURCE = `name coinbase_spot_order_v2

parameters {
  product_id: string
  base_asset: string
  quote_asset: string
  side: string
  size_field: string
  exact_size_value: string
  funding_asset: string
  max_slippage_bps: int
  max_commission_value: string
  settlement_kind: string
  settlement_value: string
  action_descriptor_digest: string
  portfolio_fingerprint: string
  credential_fingerprint: string
  expires_at_epoch_ms: int
}

requires {
  evidence.category == "COINBASE_ADVANCED_SPOT_ORDER";
  evidence.environment == "production";
  evidence.execution_domain == "coinbase_custodial_ledger";
  evidence.product_id == parameters.product_id;
  evidence.base_asset == parameters.base_asset;
  evidence.quote_asset == parameters.quote_asset;
  evidence.side == parameters.side;
  evidence.order_type == "sor_limit_ioc";
  evidence.time_in_force == "ioc";
  evidence.size_field == parameters.size_field;
  evidence.size_value == parameters.exact_size_value;
  evidence.funding_asset == parameters.funding_asset;
  evidence.action_descriptor_digest == parameters.action_descriptor_digest;
  evidence.limit_price_within_bound;
  evidence.slippage_within_limit;
  evidence.commission_within_limit;
  evidence.settlement_within_limit;
  evidence.funding_sufficient;
  evidence.portfolio_fingerprint == parameters.portfolio_fingerprint;
  evidence.credential_fingerprint == parameters.credential_fingerprint;
  evidence.evaluated_at_epoch_ms <= parameters.expires_at_epoch_ms;
  evidence.preview_present;
  evidence.preview_request_matches_create;
  evidence.preview_id == evidence.create_preview_id;
  evidence.create_payload_digest == evidence.claimed_create_payload_digest;
  evidence.preview_request_digest == evidence.claimed_preview_request_digest;
  evidence.market_status == "online";
  not evidence.trading_disabled;
  not evidence.product_disabled;
  not evidence.view_only;
}
`;

export const COINBASE_POLICY_CONSTRAINTS = Object.freeze([
  'evidence.category == "COINBASE_ADVANCED_SPOT_ORDER"',
  'evidence.environment == "production"',
  'evidence.execution_domain == "coinbase_custodial_ledger"',
  "evidence.product_id == parameters.product_id",
  "evidence.base_asset == parameters.base_asset",
  "evidence.quote_asset == parameters.quote_asset",
  "evidence.side == parameters.side",
  'evidence.order_type == "sor_limit_ioc"',
  'evidence.time_in_force == "ioc"',
  "evidence.size_field == parameters.size_field",
  "evidence.size_value == parameters.exact_size_value",
  "evidence.funding_asset == parameters.funding_asset",
  "evidence.action_descriptor_digest == parameters.action_descriptor_digest",
  "evidence.limit_price_within_bound",
  "evidence.slippage_within_limit",
  "evidence.commission_within_limit",
  "evidence.settlement_within_limit",
  "evidence.funding_sufficient",
  "evidence.portfolio_fingerprint == parameters.portfolio_fingerprint",
  "evidence.credential_fingerprint == parameters.credential_fingerprint",
  "evidence.evaluated_at_epoch_ms <= parameters.expires_at_epoch_ms",
  "evidence.preview_present",
  "evidence.preview_request_matches_create",
  "evidence.preview_id == evidence.create_preview_id",
  "evidence.create_payload_digest == evidence.claimed_create_payload_digest",
  "evidence.preview_request_digest == evidence.claimed_preview_request_digest",
  'evidence.market_status == "online"',
  "not evidence.trading_disabled",
  "not evidence.product_disabled",
  "not evidence.view_only",
]);

// Retained only for reading/verifying legacy v1 evidence. V2 policy parameters
// use canonical decimal strings so an eight-decimal base-asset SELL is not
// truncated or rejected by a universal 1e6 scale.
export function decimalToMicrounits(value, field = "value") {
  const parsed = parseDecimal(value, field);
  if (parsed.coefficient < 0n) {
    throw new Error(`${field} must not be negative`);
  }
  if (parsed.scale > 6) {
    throw new Error(`${field} has more than six decimal places`);
  }
  const scaled = parsed.coefficient * 10n ** BigInt(6 - parsed.scale);
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeds the safe policy integer range`);
  }
  return Number(scaled);
}

export function buildCoinbasePolicyBundle({
  plan,
  attestation,
  policyExpiresAt,
}) {
  if (!plan?.policy || !(policyExpiresAt instanceof Date)) {
    throw new Error(
      "A confirmed execution plan and policy expiry are required",
    );
  }
  if (
    typeof attestation?.portfolio_fingerprint !== "string" ||
    typeof attestation?.key_fingerprint !== "string"
  ) {
    throw new Error("Credential and portfolio fingerprints are required");
  }
  const descriptor = plan.action_descriptor;
  if (
    descriptor?.descriptor_digest == null ||
    descriptor?.size?.field == null ||
    descriptor?.funding?.asset == null
  ) {
    throw new Error("The canonical action descriptor is missing");
  }
  const parameters = {
    product_id: plan.policy.product_id,
    base_asset: plan.policy.base_asset,
    quote_asset: plan.policy.quote_asset,
    side: plan.policy.side,
    size_field: descriptor.size.field,
    exact_size_value: plan.policy.size.value,
    funding_asset: descriptor.funding.asset,
    max_slippage_bps: plan.policy.limits.max_slippage_bps,
    max_commission_value: plan.policy.limits.max_commission.value,
    settlement_kind: plan.policy.limits.settlement.kind,
    settlement_value: plan.policy.limits.settlement.value,
    action_descriptor_digest: descriptor.descriptor_digest,
    portfolio_fingerprint: attestation.portfolio_fingerprint,
    credential_fingerprint: attestation.key_fingerprint,
    expires_at_epoch_ms: policyExpiresAt.getTime(),
  };
  for (const [name, value] of Object.entries(parameters)) {
    if (
      !(
        (typeof value === "string" && value.length > 0) ||
        (Number.isSafeInteger(value) && value >= 0)
      )
    ) {
      throw new Error(`Invalid Delta policy parameter: ${name}`);
    }
  }
  return {
    policy_kind: COINBASE_POLICY_KIND,
    source: COINBASE_SPOT_POLICY_SOURCE,
    parameters,
    integration_status:
      "SIMULATED_CONTRACT_PENDING_PRIVATE_DELTA_VALIDATION",
  };
}

export function toDeltaWireAttributes(parameters) {
  const fields = {};
  for (const [name, value] of Object.entries(parameters)) {
    if (typeof value === "string") {
      fields[name] = { String: value };
    } else if (typeof value === "boolean") {
      fields[name] = { Bool: value };
    } else if (Number.isSafeInteger(value)) {
      fields[name] = { Int: value };
    } else {
      throw new Error(`Unsupported Delta parameter type: ${name}`);
    }
  }
  return { fields };
}
