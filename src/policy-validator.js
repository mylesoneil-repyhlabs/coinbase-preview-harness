import { compareDecimals, isPositiveDecimal, parseDecimal } from "./decimal.js";
import {
  assertPolicyAndGroundingMatchSource,
  findSourceConstraintIssues,
  MATERIAL_SOURCE_PATHS,
} from "./intent-source-validator.js";

const TOP_LEVEL_FIELDS = Object.freeze([
  "schema_version",
  "taxonomy_version",
  "status",
  "policy",
  "ambiguities",
  "unsupported_constraints",
  "grounding",
]);

const POLICY_FIELDS = Object.freeze([
  "venue",
  "environment",
  "execution_domain",
  "product_type",
  "product_id",
  "base_asset",
  "quote_asset",
  "side",
  "order_type",
  "size",
  "partial_fill_policy",
  "limits",
  "validity",
  "usage",
]);

export const MATERIAL_POLICY_PATHS = MATERIAL_SOURCE_PATHS;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownFields(value, allowed) {
  return Object.keys(value).filter((field) => !allowed.includes(field));
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
}

function assertExactFields(value, allowed, name) {
  assertPlainObject(value, name);
  const unknown = unknownFields(value, allowed);
  if (unknown.length) throw new Error(`${name} contains unknown fields: ${unknown.join(", ")}`);
  for (const field of allowed) {
    if (!Object.hasOwn(value, field)) throw new Error(`${name}.${field} is required`);
  }
}

function assertEnum(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  }
}

function assertDecimal(value, name, { positive = true } = {}) {
  try {
    const parsed = parseDecimal(value, name);
    if (positive && parsed.coefficient <= 0n) throw new Error("not positive");
  } catch {
    throw new Error(`${name} must be a ${positive ? "positive " : ""}decimal string`);
  }
}

function assertGrounding(compilation, sourceIntent) {
  if (!Array.isArray(compilation.grounding)) throw new Error("grounding must be an array");
  const groundedPaths = new Set();
  for (const item of compilation.grounding) {
    assertExactFields(item, ["field", "source_quote"], "grounding item");
    if (typeof item.field !== "string" || !item.field) {
      throw new Error("grounding.field must be a non-empty string");
    }
    if (typeof item.source_quote !== "string" || !item.source_quote.trim()) {
      throw new Error(`grounding quote for ${item.field} is empty`);
    }
    if (!sourceIntent.includes(item.source_quote)) {
      throw new Error(`grounding quote for ${item.field} is not present in the source intent`);
    }
    if (!MATERIAL_POLICY_PATHS.includes(item.field)) {
      throw new Error(`grounding contains an unknown material field: ${item.field}`);
    }
    if (groundedPaths.has(item.field)) {
      throw new Error(`material field has duplicate grounding: ${item.field}`);
    }
    groundedPaths.add(item.field);
  }
  for (const path of MATERIAL_POLICY_PATHS) {
    if (!groundedPaths.has(path)) throw new Error(`material field is not grounded: ${path}`);
  }
}

export function validatePolicy(policy) {
  assertExactFields(policy, POLICY_FIELDS, "policy");
  if (policy.venue !== "COINBASE_ADVANCED") throw new Error("policy venue is unsupported");
  if (policy.environment !== "PRODUCTION") throw new Error("policy environment is unsupported");
  if (policy.execution_domain !== "COINBASE_CUSTODIAL_LEDGER") {
    throw new Error("policy execution_domain is unsupported");
  }
  if (policy.product_type !== "SPOT") throw new Error("only SPOT products are supported");

  if (
    typeof policy.product_id !== "string" ||
    !/^[A-Z0-9]+-[A-Z0-9]+$/.test(policy.product_id)
  ) {
    throw new Error("policy.product_id must be an ASCII Coinbase product ID");
  }
  const [baseAsset, quoteAsset, extra] = policy.product_id.split("-");
  if (extra || baseAsset !== policy.base_asset || quoteAsset !== policy.quote_asset) {
    throw new Error("policy base_asset and quote_asset must exactly match product_id");
  }

  assertEnum(policy.side, ["BUY", "SELL"], "policy.side");
  assertEnum(policy.order_type, ["SOR_LIMIT_IOC"], "policy.order_type");
  assertEnum(
    policy.partial_fill_policy,
    ["ALLOW", "REQUIRE_FULL"],
    "policy.partial_fill_policy",
  );
  if (policy.order_type === "SOR_LIMIT_IOC" && policy.partial_fill_policy !== "ALLOW") {
    throw new Error("SOR_LIMIT_IOC requires partial_fill_policy ALLOW");
  }

  assertExactFields(policy.size, ["denomination", "asset", "operator", "value"], "policy.size");
  assertEnum(policy.size.denomination, ["QUOTE", "BASE"], "policy.size.denomination");
  if (policy.size.operator !== "EXACT") throw new Error("v1.3 requires an exact order size");
  assertDecimal(policy.size.value, "policy.size.value");
  if (
    policy.side === "BUY" &&
    (policy.size.denomination !== "QUOTE" || policy.size.asset !== policy.quote_asset)
  ) {
    throw new Error("BUY orders must be sized exactly in the quote asset");
  }
  if (
    policy.side === "SELL" &&
    (policy.size.denomination !== "BASE" || policy.size.asset !== policy.base_asset)
  ) {
    throw new Error("SELL orders must be sized exactly in the base asset");
  }

  assertExactFields(
    policy.limits,
    ["max_slippage_bps", "max_commission", "settlement"],
    "policy.limits",
  );
  if (
    !Number.isInteger(policy.limits.max_slippage_bps) ||
    policy.limits.max_slippage_bps < 0 ||
    policy.limits.max_slippage_bps > 9_999
  ) {
    throw new Error("policy.limits.max_slippage_bps must be an integer from 0 to 9999");
  }
  const commission = policy.limits.max_commission;
  assertExactFields(
    commission,
    ["asset", "value"],
    "policy.limits.max_commission",
  );
  if (commission.asset !== policy.quote_asset) {
    throw new Error(
      "policy.limits.max_commission.asset must equal the quote asset",
    );
  }
  assertDecimal(
    commission.value,
    "policy.limits.max_commission.value",
    { positive: false },
  );
  const settlement = policy.limits.settlement;
  assertExactFields(
    settlement,
    ["kind", "asset", "value"],
    "policy.limits.settlement",
  );
  assertEnum(
    settlement.kind,
    ["MAX_QUOTE_DEBIT", "MIN_NET_QUOTE_PROCEEDS"],
    "policy.limits.settlement.kind",
  );
  if (settlement.asset !== policy.quote_asset) {
    throw new Error(
      "policy.limits.settlement.asset must equal the quote asset",
    );
  }
  assertDecimal(
    settlement.value,
    "policy.limits.settlement.value",
    { positive: false },
  );
  if (
    (policy.side === "BUY" &&
      settlement.kind !== "MAX_QUOTE_DEBIT") ||
    (policy.side === "SELL" &&
      settlement.kind !== "MIN_NET_QUOTE_PROCEEDS")
  ) {
    throw new Error("policy settlement kind does not match the order side");
  }
  if (
    policy.side === "BUY" &&
    compareDecimals(settlement.value, policy.size.value) < 0
  ) {
    throw new Error("MAX_QUOTE_DEBIT cannot be below BUY principal");
  }

  assertExactFields(policy.validity, ["starts", "ttl_seconds"], "policy.validity");
  if (policy.validity.starts !== "ON_EXECUTION_CONFIRMATION") {
    throw new Error(
      "policy.validity.starts must be ON_EXECUTION_CONFIRMATION",
    );
  }
  if (
    !Number.isInteger(policy.validity.ttl_seconds) ||
    policy.validity.ttl_seconds < 30 ||
    policy.validity.ttl_seconds > 600
  ) {
    throw new Error("policy validity must be between 30 and 600 seconds");
  }

  assertExactFields(policy.usage, ["max_executions"], "policy.usage");
  if (policy.usage.max_executions !== 1) {
    throw new Error("v1.3 policies must authorize exactly one execution");
  }
  return policy;
}

function validateIssues(items, name, requiredFields) {
  if (!Array.isArray(items)) throw new Error(`${name} must be an array`);
  for (const item of items) {
    assertExactFields(item, requiredFields, `${name} item`);
    for (const field of requiredFields) {
      if (typeof item[field] !== "string") throw new Error(`${name}.${field} must be a string`);
    }
  }
}

export function validateCompilation(compilation, sourceIntent) {
  assertExactFields(compilation, TOP_LEVEL_FIELDS, "compilation");
  if (compilation.schema_version !== "delta.coinbase.compilation.v2") {
    throw new Error("unsupported compilation schema_version");
  }
  if (compilation.taxonomy_version !== "digital-asset-spot-order.v2") {
    throw new Error("unsupported taxonomy_version");
  }
  assertEnum(
    compilation.status,
    ["READY_FOR_CONFIRMATION", "NEEDS_CLARIFICATION", "UNSUPPORTED"],
    "compilation.status",
  );
  validateIssues(compilation.ambiguities, "ambiguities", ["code", "source_text", "question"]);
  validateIssues(compilation.unsupported_constraints, "unsupported_constraints", [
    "code",
    "source_text",
    "reason",
  ]);

  if (compilation.status === "READY_FOR_CONFIRMATION") {
    if (compilation.ambiguities.length || compilation.unsupported_constraints.length) {
      throw new Error("ready compilation cannot contain ambiguity or unsupported items");
    }
    const sourceConstraintIssues = findSourceConstraintIssues(sourceIntent);
    if (sourceConstraintIssues.length) {
      throw new Error(
        `source intent contains unsupported or repeated constraints: ${sourceConstraintIssues
          .map((item) => item.source_text)
          .join("; ")}`,
      );
    }
    validatePolicy(compilation.policy);
    assertGrounding(compilation, sourceIntent);
    assertPolicyAndGroundingMatchSource(
      compilation.policy,
      compilation.grounding,
      sourceIntent,
    );
  } else if (compilation.policy !== null) {
    throw new Error("non-ready compilation must set policy to null");
  }
  return compilation;
}

export function assertPolicyWithinSafetyProfile(policy, safetyProfile) {
  validatePolicy(policy);
  assertPlainObject(safetyProfile, "safety profile");
  const failures = [];
  if (!safetyProfile.allowed_products?.includes(policy.product_id)) {
    failures.push("product is outside the local safety profile");
  }
  if (!safetyProfile.allowed_sides?.includes(policy.side)) {
    failures.push("side is outside the local safety profile");
  }
  if (!safetyProfile.allowed_order_types?.includes(policy.order_type)) {
    failures.push("order type is outside the local safety profile");
  }
  if (compareDecimals(policy.size.value, safetyProfile.max_principal) > 0) {
    failures.push("principal exceeds the local safety profile");
  }
  if (policy.side === "BUY") {
    if (
      compareDecimals(
        policy.limits.settlement.value,
        safetyProfile.max_all_in_debit,
      ) > 0
    ) {
      failures.push("all-in debit exceeds the local safety profile");
    }
  } else {
    failures.push("SELL is not enabled by the future live safety profile");
  }
  if (
    compareDecimals(policy.limits.max_commission.value, safetyProfile.max_commission) > 0
  ) {
    failures.push("commission exceeds the local safety profile");
  }
  if (policy.limits.max_slippage_bps > safetyProfile.max_slippage_bps) {
    failures.push("slippage exceeds the local safety profile");
  }
  if (policy.validity.ttl_seconds > safetyProfile.max_ttl_seconds) {
    failures.push("validity exceeds the local safety profile");
  }
  if (policy.usage.max_executions > safetyProfile.max_executions) {
    failures.push("execution count exceeds the local safety profile");
  }
  if (failures.length) throw new Error(`Policy exceeds safety profile: ${failures.join("; ")}`);
  return true;
}

export function assertPolicyWithinPreviewCapability(
  policy,
  capabilityProfile,
) {
  validatePolicy(policy);
  assertPlainObject(capabilityProfile, "preview capability profile");
  const failures = [];
  if (capabilityProfile.create_enabled !== false) {
    failures.push("preview capability must keep Create disabled");
  }
  if (!capabilityProfile.allowed_product_types?.includes(policy.product_type)) {
    failures.push("product type is outside the preview capability");
  }
  if (!capabilityProfile.allowed_sides?.includes(policy.side)) {
    failures.push("side is outside the preview capability");
  }
  if (!capabilityProfile.allowed_order_types?.includes(policy.order_type)) {
    failures.push("order type is outside the preview capability");
  }
  if (policy.limits.max_slippage_bps > capabilityProfile.max_slippage_bps) {
    failures.push("slippage exceeds the preview capability");
  }
  if (policy.validity.ttl_seconds > capabilityProfile.max_ttl_seconds) {
    failures.push("validity exceeds the preview capability");
  }
  if (policy.usage.max_executions > capabilityProfile.max_executions) {
    failures.push("execution count exceeds the preview capability");
  }
  if (failures.length) {
    throw new Error(
      `Policy exceeds preview capability: ${failures.join("; ")}`,
    );
  }
  return true;
}
