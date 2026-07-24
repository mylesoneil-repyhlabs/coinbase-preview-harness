import {
  addDecimals,
  compareDecimals,
  isIncrementAligned,
  isPositiveDecimal,
  isSlippageWithinBps,
  parseDecimal,
} from "./decimal.js";
import { validatePolicy } from "./policy-validator.js";

const ACTION_FIELDS = Object.freeze([
  "product_id",
  "side",
  "type",
  "time_in_force",
  "quote_size",
  "limit_price",
]);

function failure(code, message, expected, actual) {
  return { code, message, expected, actual };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function evaluateExecutionProposal(policy, proposal, market) {
  validatePolicy(policy);
  const failures = [];
  if (!isPlainObject(proposal)) {
    return {
      verdict: "BLOCK",
      failures: [failure("INVALID_PROPOSAL", "Proposal must be an object", "object", typeof proposal)],
    };
  }
  const unknown = Object.keys(proposal).filter((field) => !ACTION_FIELDS.includes(field));
  if (unknown.length) {
    failures.push(
      failure("UNKNOWN_ORDER_FIELD", "Proposal contains unknown fields", ACTION_FIELDS, unknown),
    );
  }
  if (proposal.product_id !== policy.product_id) {
    failures.push(
      failure("PRODUCT_MISMATCH", "Product differs from the policy", policy.product_id, proposal.product_id),
    );
  }
  if (proposal.side !== policy.side) {
    failures.push(failure("SIDE_MISMATCH", "Side differs from the policy", policy.side, proposal.side));
  }
  if (proposal.type !== "limit" || proposal.time_in_force !== "IOC") {
    failures.push(
      failure(
        "ORDER_TYPE_MISMATCH",
        "V1 requires a price-bounded IOC limit order",
        { type: "limit", time_in_force: "IOC" },
        { type: proposal.type, time_in_force: proposal.time_in_force },
      ),
    );
  }
  if (proposal.quote_size !== policy.size.value || !isPositiveDecimal(proposal.quote_size)) {
    failures.push(
      failure(
        "SIZE_MISMATCH",
        "Quote size differs from the exact human-confirmed amount",
        policy.size.value,
        proposal.quote_size,
      ),
    );
  }
  if (!isPositiveDecimal(proposal.limit_price)) {
    failures.push(
      failure("INVALID_LIMIT_PRICE", "Limit price must be positive", "positive decimal", proposal.limit_price),
    );
  }
  if (
    market &&
    (!isIncrementAligned(proposal.quote_size, market.quote_increment) ||
      !isIncrementAligned(proposal.limit_price, market.price_increment))
  ) {
    failures.push(
      failure(
        "INCREMENT_MISMATCH",
        "Size or price is not aligned to Coinbase increments",
        {
          quote_increment: market.quote_increment,
          price_increment: market.price_increment,
        },
        {
          quote_size: proposal.quote_size,
          limit_price: proposal.limit_price,
        },
      ),
    );
  }
  return {
    verdict: failures.length ? "BLOCK" : "ALLOW",
    failures,
  };
}

export function selectExecutionPreviewEvidence(preview) {
  if (!isPlainObject(preview)) return null;
  const fields = [
    "order_total",
    "commission_total",
    "quote_size",
    "base_size",
    "est_average_filled_price",
    "best_bid",
    "best_ask",
    "preview_id",
    "errs",
    "warning",
  ];
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(preview, field)).map((field) => [field, preview[field]]),
  );
}

export function evaluateExecutionPreview(policy, proposal, market, preview) {
  const failures = [];
  if (!isPlainObject(preview)) {
    return {
      verdict: "BLOCK",
      failures: [failure("INVALID_PREVIEW", "Preview must be an object", "object", typeof preview)],
    };
  }
  if (!Array.isArray(preview.errs) || preview.errs.length) {
    failures.push(
      failure("PREVIEW_ERRORS", "Coinbase preview errors must be an empty array", [], preview.errs),
    );
  }
  if (!Array.isArray(preview.warning) || preview.warning.length) {
    failures.push(
      failure(
        "PREVIEW_WARNINGS",
        "V1 blocks every Coinbase preview warning",
        [],
        preview.warning,
      ),
    );
  }
  if (typeof preview.preview_id !== "string" || !preview.preview_id) {
    failures.push(
      failure("MISSING_PREVIEW_ID", "Coinbase preview_id is required", "non-empty string", preview.preview_id),
    );
  }
  for (const field of [
    "order_total",
    "commission_total",
    "quote_size",
    "base_size",
    "est_average_filled_price",
  ]) {
    try {
      const parsed = parseDecimal(preview[field], field);
      if (
        (field === "commission_total" && parsed.coefficient < 0n) ||
        (field !== "commission_total" && parsed.coefficient <= 0n)
      ) {
        throw new Error("not positive");
      }
    } catch {
      failures.push(
        failure(
          "INVALID_PREVIEW_DECIMAL",
          `Coinbase preview ${field} is missing or invalid`,
          "decimal string",
          preview[field],
        ),
      );
    }
  }
  if (
    typeof preview.quote_size === "string" &&
    isPositiveDecimal(preview.quote_size) &&
    compareDecimals(preview.quote_size, proposal.quote_size) !== 0
  ) {
    failures.push(
      failure(
        "PREVIEW_SIZE_MISMATCH",
        "Coinbase preview size differs from the proposal",
        proposal.quote_size,
        preview.quote_size,
      ),
    );
  }
  let conservativeAllInDebit = null;
  try {
    const quotePlusCommission = addDecimals(
      proposal.quote_size,
      preview.commission_total,
    );
    conservativeAllInDebit =
      compareDecimals(preview.order_total, quotePlusCommission) >= 0
        ? preview.order_total
        : quotePlusCommission;
  } catch {}
  if (
    conservativeAllInDebit !== null &&
    compareDecimals(
      conservativeAllInDebit,
      policy.limits.max_all_in_debit.value,
    ) > 0
  ) {
    failures.push(
      failure(
        "ALL_IN_CAP_EXCEEDED",
        "Conservative Preview all-in debit exceeds the policy",
        policy.limits.max_all_in_debit.value,
        conservativeAllInDebit,
      ),
    );
  }
  if (
    typeof preview.commission_total === "string" &&
    compareDecimals(preview.commission_total, policy.limits.max_commission.value) > 0
  ) {
    failures.push(
      failure(
        "COMMISSION_CAP_EXCEEDED",
        "Preview commission exceeds the policy",
        policy.limits.max_commission.value,
        preview.commission_total,
      ),
    );
  }
  if (
    typeof preview.est_average_filled_price === "string" &&
    isPositiveDecimal(preview.est_average_filled_price) &&
    compareDecimals(preview.est_average_filled_price, proposal.limit_price) > 0
  ) {
    failures.push(
      failure(
        "LIMIT_PRICE_EXCEEDED",
        "Estimated fill price exceeds the proposed price bound",
        proposal.limit_price,
        preview.est_average_filled_price,
      ),
    );
  }
  if (
    typeof preview.est_average_filled_price === "string" &&
    isPositiveDecimal(preview.est_average_filled_price) &&
    !isSlippageWithinBps(
      preview.est_average_filled_price,
      market.best_ask,
      policy.limits.max_slippage_bps,
      "BUY",
    )
  ) {
    failures.push(
      failure(
        "SLIPPAGE_CAP_EXCEEDED",
        "Estimated fill exceeds the allowed basis points above fresh best ask",
        policy.limits.max_slippage_bps,
        {
          best_ask: market.best_ask,
          estimated_fill: preview.est_average_filled_price,
        },
      ),
    );
  }
  return {
    verdict: failures.length ? "BLOCK" : "ALLOW",
    failures,
  };
}
