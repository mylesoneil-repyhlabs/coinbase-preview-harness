import { digest } from "./evidence.js";
import { validatePolicy } from "./policy-validator.js";

const DESCRIPTOR_FIELDS = Object.freeze([
  "schema_version",
  "action_type",
  "venue",
  "execution_domain",
  "instrument",
  "side",
  "order",
  "size",
  "funding",
  "constraints",
  "usage",
]);

function assertExactFields(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(`${name} has an invalid field set`);
  }
}

export function createCanonicalSpotAction(policy) {
  validatePolicy(policy);
  const sizeField = policy.side === "BUY" ? "quote_size" : "base_size";
  const fundingAsset =
    policy.side === "BUY" ? policy.quote_asset : policy.base_asset;
  const requiredAvailable =
    policy.side === "BUY"
      ? policy.limits.settlement.value
      : policy.size.value;
  const descriptor = {
    schema_version: "delta.coinbase.spot_action.v2",
    action_type: "COINBASE_SPOT_TRADE",
    venue: "COINBASE_ADVANCED",
    execution_domain: "COINBASE_CUSTODIAL_LEDGER",
    instrument: {
      product_id: policy.product_id,
      product_type: "SPOT",
      base_asset: policy.base_asset,
      quote_asset: policy.quote_asset,
    },
    side: policy.side,
    order: {
      type: "SOR_LIMIT_IOC",
      time_in_force: "IOC",
      partial_fill_policy: policy.partial_fill_policy,
    },
    size: {
      field: sizeField,
      denomination: policy.size.denomination,
      asset: policy.size.asset,
      operator: policy.size.operator,
      value: policy.size.value,
    },
    funding: {
      source: "COINBASE_AVAILABLE_BALANCE",
      asset: fundingAsset,
      required_available: requiredAvailable,
      conversion_allowed: false,
    },
    constraints: {
      price_reference:
        policy.side === "BUY" ? "FRESH_BEST_ASK" : "FRESH_BEST_BID",
      price_bound:
        policy.side === "BUY" ? "MAXIMUM_BUY_PRICE" : "MINIMUM_SELL_PRICE",
      max_slippage_bps: policy.limits.max_slippage_bps,
      max_commission: { ...policy.limits.max_commission },
      settlement: { ...policy.limits.settlement },
      market_condition:
        policy.market_condition == null
          ? null
          : { ...policy.market_condition },
    },
    usage: {
      max_executions: 1,
      validity_starts: policy.validity.starts,
      ttl_seconds: policy.validity.ttl_seconds,
    },
  };
  return {
    ...descriptor,
    descriptor_digest: digest(descriptor),
  };
}

export function assertCanonicalSpotAction(descriptor, policy) {
  assertCanonicalSpotActionIntegrity(descriptor);
  const expected = createCanonicalSpotAction(policy);
  if (digest(descriptor) !== digest(expected)) {
    throw new Error("Canonical spot action does not match the authorized policy");
  }
  return descriptor;
}

export function assertCanonicalSpotActionIntegrity(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new Error("Canonical spot action is required");
  }
  const { descriptor_digest: claimedDigest, ...unsigned } = descriptor;
  assertExactFields(unsigned, DESCRIPTOR_FIELDS, "canonical spot action");
  if (digest(unsigned) !== claimedDigest) {
    throw new Error("Canonical spot action digest mismatch");
  }
  return descriptor;
}
