import {
  addDecimals,
  compareDecimals,
  isIncrementAligned,
  isPositiveDecimal,
  isSlippageWithinBps,
  isWithinDecimalTolerance,
  isWithinRelativeBps,
  parseDecimal,
  priceBoundFromBps,
  divideDecimals,
  subtractDecimals,
} from "./decimal.js";
import { validatePolicy } from "./policy-validator.js";

const COMMON_ACTION_FIELDS = Object.freeze([
  "product_id",
  "side",
  "type",
  "time_in_force",
  "limit_price",
]);
const MAX_PREVIEW_BBO_DRIFT_BPS = 50;
const MAX_PREVIEW_IMPLIED_PRICE_DRIFT_BPS = 5;

function issue(code, message, expected, actual) {
  return { code, message, expected, actual };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function proposalDecision(failures) {
  return failures.length ? "BLOCK" : "PASS";
}

const UNVERIFIABLE_PREVIEW_CODES = new Set([
  "INVALID_PREVIEW",
  "PREVIEW_ERRORS",
  "PREVIEW_WARNINGS_INVALID",
  "MISSING_PREVIEW_ID",
  "INVALID_PREVIEW_DECIMAL",
  "PREVIEW_BBO_INVALID",
  "PREVIEW_BBO_DRIFT",
  "PREVIEW_SIZE_PRICE_INCONSISTENT",
  "PREVIEW_ORDER_TOTAL_INCONSISTENT",
  "SETTLEMENT_ECONOMICS_INVALID",
]);

function previewDecision(failures, reviewReasons) {
  if (
    failures.some((failure) =>
      UNVERIFIABLE_PREVIEW_CODES.has(failure.code),
    )
  ) {
    return "REVIEW";
  }
  if (failures.length) return "BLOCK";
  if (reviewReasons.length) return "REVIEW";
  return "PASS";
}

function sideSize(policy, value) {
  const field = policy.side === "BUY" ? "quote_size" : "base_size";
  return { field, value: value?.[field] };
}

function deriveAuthorizedLimitPrice(policy, market) {
  if (!isPlainObject(market)) {
    throw new Error("trusted market evidence is required");
  }
  const priceReferenceValue =
    policy.side === "BUY" ? market.best_ask : market.best_bid;
  return {
    price_reference_value: priceReferenceValue,
    authorized_limit_price: priceBoundFromBps(
      priceReferenceValue,
      policy.limits.max_slippage_bps,
      market.price_increment,
      policy.side,
    ),
  };
}

export function evaluateExecutionProposal(policy, proposal, market) {
  validatePolicy(policy);
  const failures = [];
  if (!isPlainObject(proposal)) {
    return {
      decision: "BLOCK",
      verdict: "BLOCK",
      failures: [
        issue(
          "INVALID_PROPOSAL",
          "Proposal must be an object",
          "object",
          typeof proposal,
        ),
      ],
    };
  }
  let priceBound = {
    price_reference_value: null,
    authorized_limit_price: null,
  };
  try {
    priceBound = deriveAuthorizedLimitPrice(policy, market);
  } catch (error) {
    failures.push(
      issue(
        "PRICE_BOUND_UNAVAILABLE",
        "A side-specific limit price could not be derived from trusted market evidence",
        {
          reference_field:
            policy.side === "BUY" ? "best_ask" : "best_bid",
          max_slippage_bps: policy.limits.max_slippage_bps,
        },
        error.message,
      ),
    );
  }
  if (policy.market_condition && priceBound.price_reference_value) {
    const comparison = compareDecimals(
      priceBound.price_reference_value,
      policy.market_condition.value,
    );
    const conditionMet =
      policy.market_condition.operator === "AT_OR_BELOW"
        ? comparison <= 0
        : comparison >= 0;
    if (!conditionMet) {
      failures.push(
        issue(
          "MARKET_PRICE_CONDITION_NOT_MET",
          "Fresh Coinbase market evidence does not satisfy the human-authorized absolute price condition",
          policy.market_condition,
          {
            reference: policy.market_condition.reference,
            value: priceBound.price_reference_value,
          },
        ),
      );
    }
  }
  const size = sideSize(policy, proposal);
  const actionFields = [...COMMON_ACTION_FIELDS, size.field];
  const unknown = Object.keys(proposal).filter(
    (field) => !actionFields.includes(field),
  );
  const missing = actionFields.filter(
    (field) => !Object.hasOwn(proposal, field),
  );
  if (unknown.length || missing.length) {
    failures.push(
      issue(
        "ORDER_FIELD_SET_MISMATCH",
        "Proposal contains an unsupported or missing field",
        actionFields,
        { unknown, missing },
      ),
    );
  }
  if (proposal.product_id !== policy.product_id) {
    failures.push(
      issue(
        "PRODUCT_MISMATCH",
        "Product differs from the policy",
        policy.product_id,
        proposal.product_id,
      ),
    );
  }
  if (proposal.side !== policy.side) {
    failures.push(
      issue(
        "SIDE_MISMATCH",
        "Side differs from the policy",
        policy.side,
        proposal.side,
      ),
    );
  }
  if (proposal.type !== "limit" || proposal.time_in_force !== "IOC") {
    failures.push(
      issue(
        "ORDER_TYPE_MISMATCH",
        "The policy requires a price-bounded SOR limit IOC order",
        { type: "limit", time_in_force: "IOC" },
        { type: proposal.type, time_in_force: proposal.time_in_force },
      ),
    );
  }
  const sizeWithinPolicy =
    isPositiveDecimal(size.value) &&
    (policy.size.operator === "EXACT"
      ? compareDecimals(size.value, policy.size.value) === 0
      : compareDecimals(size.value, policy.size.value) <= 0);
  if (!sizeWithinPolicy) {
    failures.push(
      issue(
        "SIZE_MISMATCH",
        `${size.field} is outside the human-authorized ${policy.size.operator === "EXACT" ? "exact amount" : "maximum"}`,
        {
          operator: policy.size.operator,
          value: policy.size.value,
        },
        size.value,
      ),
    );
  }
  if (!isPositiveDecimal(proposal.limit_price)) {
    failures.push(
      issue(
        "INVALID_LIMIT_PRICE",
        "Limit price must be positive",
        "positive decimal",
        proposal.limit_price,
      ),
    );
  } else if (priceBound.authorized_limit_price) {
    const comparison = compareDecimals(
      proposal.limit_price,
      priceBound.authorized_limit_price,
    );
    const withinAuthorizedBound =
      policy.side === "BUY" ? comparison <= 0 : comparison >= 0;
    if (!withinAuthorizedBound) {
      failures.push(
        issue(
          "LIMIT_PRICE_OUTSIDE_AUTHORIZED_BOUND",
          `The ${policy.side} limit price is outside the human-authorized side-specific bound`,
          {
            operator: policy.side === "BUY" ? "<=" : ">=",
            authorized_limit_price:
              priceBound.authorized_limit_price,
            reference_price: priceBound.price_reference_value,
            reference_field:
              policy.side === "BUY" ? "best_ask" : "best_bid",
            max_slippage_bps: policy.limits.max_slippage_bps,
          },
          proposal.limit_price,
        ),
      );
    }
  }
  if (market) {
    const sizeIncrement =
      policy.side === "BUY"
        ? market.quote_increment
        : market.base_increment;
    if (
      !isIncrementAligned(size.value, sizeIncrement) ||
      !isIncrementAligned(proposal.limit_price, market.price_increment)
    ) {
      failures.push(
        issue(
          "INCREMENT_MISMATCH",
          "Size or price is not aligned to Coinbase increments",
          {
            size_field: size.field,
            size_increment: sizeIncrement,
            price_increment: market.price_increment,
          },
          {
            size: size.value,
            limit_price: proposal.limit_price,
          },
        ),
      );
    }
  }
  const decision = proposalDecision(failures);
  return {
    decision,
    verdict: decision,
    failures,
    ...priceBound,
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
    fields
      .filter((field) => Object.hasOwn(preview, field))
      .map((field) => [field, preview[field]]),
  );
}

export function derivePreviewSettlement(policy, proposal, preview) {
  if (policy.side === "BUY") {
    const requestedWithCommission = addDecimals(
      proposal.quote_size,
      preview.commission_total,
    );
    return {
      kind: "MAX_QUOTE_DEBIT",
      value:
        compareDecimals(preview.order_total, requestedWithCommission) >= 0
          ? preview.order_total
          : requestedWithCommission,
    };
  }
  const grossProceeds =
    compareDecimals(preview.order_total, preview.quote_size) <= 0
      ? preview.order_total
      : preview.quote_size;
  return {
    kind: "MIN_NET_QUOTE_PROCEEDS",
    value: subtractDecimals(grossProceeds, preview.commission_total),
  };
}

export function evaluateExecutionPreview(policy, proposal, market, preview) {
  validatePolicy(policy);
  const failures = [];
  const reviewReasons = [];
  if (!isPlainObject(preview)) {
    return {
      decision: "REVIEW",
      verdict: "REVIEW",
      failures: [
        issue(
          "INVALID_PREVIEW",
          "Preview must be an object",
          "object",
          typeof preview,
        ),
      ],
      review_reasons: [],
      settlement: null,
    };
  }
  if (!Array.isArray(preview.errs) || preview.errs.length) {
    failures.push(
      issue(
        "PREVIEW_ERRORS",
        "Coinbase Preview errors must be an empty array",
        [],
        preview.errs,
      ),
    );
  }
  if (!Array.isArray(preview.warning)) {
    failures.push(
      issue(
        "PREVIEW_WARNINGS_INVALID",
        "Coinbase Preview warning must be an array",
        [],
        preview.warning,
      ),
    );
  } else if (preview.warning.length) {
    reviewReasons.push(
      issue(
        "PREVIEW_WARNINGS",
        "Coinbase returned a warning that requires human review",
        [],
        preview.warning,
      ),
    );
  }
  if (typeof preview.preview_id !== "string" || !preview.preview_id) {
    failures.push(
      issue(
        "MISSING_PREVIEW_ID",
        "Coinbase preview_id is required",
        "non-empty string",
        preview.preview_id,
      ),
    );
  }
  for (const field of [
    "order_total",
    "commission_total",
    "quote_size",
    "base_size",
    "est_average_filled_price",
    "best_bid",
    "best_ask",
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
        issue(
          "INVALID_PREVIEW_DECIMAL",
          `Coinbase Preview ${field} is missing or invalid`,
          "decimal string",
          preview[field],
        ),
      );
    }
  }
  const size = sideSize(policy, proposal);
  if (
    typeof preview[size.field] === "string" &&
    isPositiveDecimal(preview[size.field]) &&
    compareDecimals(preview[size.field], size.value) !== 0
  ) {
    failures.push(
      issue(
        "PREVIEW_SIZE_MISMATCH",
        `Coinbase Preview ${size.field} differs from the exact proposal`,
        size.value,
        preview[size.field],
      ),
    );
  }

  const previewBookValid =
    isPositiveDecimal(preview.best_bid) &&
    isPositiveDecimal(preview.best_ask) &&
    compareDecimals(preview.best_bid, preview.best_ask) < 0;
  if (!previewBookValid) {
    failures.push(
      issue(
        "PREVIEW_BBO_INVALID",
        "Coinbase Preview best bid/ask must be positive and uncrossed",
        "best_bid < best_ask",
        { best_bid: preview.best_bid, best_ask: preview.best_ask },
      ),
    );
  } else {
    const bboMatchesTrustedSnapshot =
      isWithinRelativeBps(
        preview.best_bid,
        market.best_bid,
        MAX_PREVIEW_BBO_DRIFT_BPS,
      ) &&
      isWithinRelativeBps(
        preview.best_ask,
        market.best_ask,
        MAX_PREVIEW_BBO_DRIFT_BPS,
      );
    if (!bboMatchesTrustedSnapshot) {
      failures.push(
        issue(
          "PREVIEW_BBO_DRIFT",
          "Coinbase Preview best bid/ask drifted too far from the trusted market snapshot",
          {
            best_bid: market.best_bid,
            best_ask: market.best_ask,
            max_drift_bps: MAX_PREVIEW_BBO_DRIFT_BPS,
          },
          { best_bid: preview.best_bid, best_ask: preview.best_ask },
        ),
      );
    }
    if (policy.market_condition) {
      const previewReference =
        policy.side === "BUY" ? preview.best_ask : preview.best_bid;
      const conditionComparison = compareDecimals(
        previewReference,
        policy.market_condition.value,
      );
      const conditionMet =
        policy.market_condition.operator === "AT_OR_BELOW"
          ? conditionComparison <= 0
          : conditionComparison >= 0;
      if (!conditionMet) {
        failures.push(
          issue(
            "PREVIEW_MARKET_CONDITION_NOT_MET",
            "Coinbase Preview no longer satisfies the absolute market-price condition",
            policy.market_condition,
            previewReference,
          ),
        );
      }
    }
  }

  if (
    isPositiveDecimal(preview.quote_size) &&
    isPositiveDecimal(preview.base_size) &&
    isPositiveDecimal(preview.est_average_filled_price)
  ) {
    const impliedPrice = divideDecimals(
      preview.quote_size,
      preview.base_size,
      { scale: 18 },
    );
    if (
      !isWithinRelativeBps(
        impliedPrice,
        preview.est_average_filled_price,
        MAX_PREVIEW_IMPLIED_PRICE_DRIFT_BPS,
      )
    ) {
      failures.push(
        issue(
          "PREVIEW_SIZE_PRICE_INCONSISTENT",
          "Coinbase Preview quote size, base size, and estimated average price are contradictory",
          {
            max_drift_bps: MAX_PREVIEW_IMPLIED_PRICE_DRIFT_BPS,
            implied_price: impliedPrice,
          },
          preview.est_average_filled_price,
        ),
      );
    }
  }
  if (
    typeof preview.order_total === "string" &&
    typeof preview.quote_size === "string" &&
    typeof preview.commission_total === "string"
  ) {
    try {
      const quoteWithCommission = addDecimals(
        preview.quote_size,
        preview.commission_total,
      );
      const totalMatches =
        isWithinDecimalTolerance(
          preview.order_total,
          preview.quote_size,
          market.quote_increment,
        ) ||
        isWithinDecimalTolerance(
          preview.order_total,
          quoteWithCommission,
          market.quote_increment,
        );
      if (!totalMatches) {
        failures.push(
          issue(
            "PREVIEW_ORDER_TOTAL_INCONSISTENT",
            "Coinbase Preview order total is inconsistent with quote size and commission",
            {
              quote_size: preview.quote_size,
              quote_plus_commission: quoteWithCommission,
              tolerance: market.quote_increment,
            },
            preview.order_total,
          ),
        );
      }
    } catch {
      // The existing decimal validation emits the primary malformed-value failure.
    }
  }

  let settlement = null;
  try {
    settlement = derivePreviewSettlement(policy, proposal, preview);
    const comparison = compareDecimals(
      settlement.value,
      policy.limits.settlement.value,
    );
    const violates =
      settlement.kind === "MAX_QUOTE_DEBIT"
        ? comparison > 0
        : comparison < 0;
    if (violates) {
      failures.push(
        issue(
          settlement.kind === "MAX_QUOTE_DEBIT"
            ? "MAX_QUOTE_DEBIT_EXCEEDED"
            : "MIN_NET_PROCEEDS_NOT_MET",
          settlement.kind === "MAX_QUOTE_DEBIT"
            ? "Conservative Preview debit exceeds the policy"
            : "Conservative Preview net proceeds are below the policy",
          policy.limits.settlement.value,
          settlement.value,
        ),
      );
    }
  } catch {
    failures.push(
      issue(
        "SETTLEMENT_ECONOMICS_INVALID",
        "Preview settlement economics could not be derived safely",
        policy.limits.settlement,
        null,
      ),
    );
  }
  if (
    typeof preview.commission_total === "string" &&
    isPositiveDecimal(preview.commission_total) &&
    compareDecimals(
      preview.commission_total,
      policy.limits.max_commission.value,
    ) > 0
  ) {
    failures.push(
      issue(
        "COMMISSION_CAP_EXCEEDED",
        "Preview commission exceeds the policy",
        policy.limits.max_commission.value,
        preview.commission_total,
      ),
    );
  }
  if (
    typeof preview.est_average_filled_price === "string" &&
    isPositiveDecimal(preview.est_average_filled_price)
  ) {
    const priceComparison = compareDecimals(
      preview.est_average_filled_price,
      proposal.limit_price,
    );
    const violatesLimit =
      policy.side === "BUY"
        ? priceComparison > 0
        : priceComparison < 0;
    if (violatesLimit) {
      failures.push(
        issue(
          "LIMIT_PRICE_VIOLATION",
          policy.side === "BUY"
            ? "Estimated BUY fill exceeds the maximum price"
            : "Estimated SELL fill is below the minimum price",
          proposal.limit_price,
          preview.est_average_filled_price,
        ),
      );
    }
    const reference =
      policy.side === "BUY" ? market.best_ask : market.best_bid;
    if (
      !isSlippageWithinBps(
        preview.est_average_filled_price,
        reference,
        policy.limits.max_slippage_bps,
        policy.side,
      )
    ) {
      failures.push(
        issue(
          "SLIPPAGE_CAP_EXCEEDED",
          `Estimated fill exceeds the allowed ${policy.side === "BUY" ? "upside" : "downside"} slippage`,
          {
            max_bps: policy.limits.max_slippage_bps,
            reference,
          },
          preview.est_average_filled_price,
        ),
      );
    }
  }
  const decision = previewDecision(failures, reviewReasons);
  return {
    decision,
    verdict: decision,
    failures,
    review_reasons: reviewReasons,
    settlement,
  };
}
