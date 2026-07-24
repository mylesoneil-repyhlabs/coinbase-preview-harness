import { parseDecimal } from "../decimal.js";

export const COINBASE_POLICY_KIND = "coinbase_spot";
export const COINBASE_EVIDENCE_CATEGORY =
  "COINBASE_ADVANCED_SPOT_ORDER";

export const COINBASE_SPOT_POLICY_SOURCE = `name coinbase_spot_order_v1

parameters {
  product_id: string
  base_asset: string
  quote_asset: string
  side: string
  exact_quote_size_microunits: int
  max_slippage_bps: int
  max_commission_microunits: int
  max_all_in_debit_microunits: int
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
  evidence.quote_size_microunits == parameters.exact_quote_size_microunits;
  evidence.slippage_bps <= parameters.max_slippage_bps;
  evidence.commission_microunits <= parameters.max_commission_microunits;
  evidence.all_in_debit_microunits <= parameters.max_all_in_debit_microunits;
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
  "evidence.quote_size_microunits == parameters.exact_quote_size_microunits",
  "evidence.slippage_bps <= parameters.max_slippage_bps",
  "evidence.commission_microunits <= parameters.max_commission_microunits",
  "evidence.all_in_debit_microunits <= parameters.max_all_in_debit_microunits",
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
]);

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
    throw new Error("A confirmed execution plan and policy expiry are required");
  }
  if (
    typeof attestation?.portfolio_fingerprint !== "string" ||
    typeof attestation?.key_fingerprint !== "string"
  ) {
    throw new Error("Credential and portfolio fingerprints are required");
  }

  const parameters = {
    product_id: plan.policy.product_id,
    base_asset: plan.policy.base_asset,
    quote_asset: plan.policy.quote_asset,
    side: plan.policy.side,
    exact_quote_size_microunits: decimalToMicrounits(
      plan.policy.size.value,
      "policy.size.value",
    ),
    max_slippage_bps: plan.policy.limits.max_slippage_bps,
    max_commission_microunits: decimalToMicrounits(
      plan.policy.limits.max_commission.value,
      "policy.limits.max_commission.value",
    ),
    max_all_in_debit_microunits: decimalToMicrounits(
      plan.policy.limits.max_all_in_debit.value,
      "policy.limits.max_all_in_debit.value",
    ),
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
