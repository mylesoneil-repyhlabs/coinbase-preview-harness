import { compareDecimals, isPositiveDecimal, parseDecimal } from "./decimal.js";

export const ORDER_FIELDS = Object.freeze([
  "product_id",
  "side",
  "type",
  "quote_size",
]);

const PRODUCT_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;
const PREVIEW_DECIMAL_FIELDS = [
  "order_total",
  "commission_total",
  "est_average_filled_price",
  "base_size",
  "quote_size",
  "best_bid",
  "best_ask",
];

function failure(code, message, expected, actual) {
  return { code, message, expected, actual };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function evaluateProposal(mandate, order) {
  const failures = [];

  if (!isPlainObject(order)) {
    return {
      verdict: "BLOCK",
      failures: [failure("INVALID_PROPOSAL", "Proposal must be a JSON object", "object", typeof order)],
    };
  }

  const unknownFields = Object.keys(order).filter((field) => !ORDER_FIELDS.includes(field));
  if (unknownFields.length) {
    failures.push(
      failure(
        "UNKNOWN_ORDER_FIELD",
        "Proposal contains fields outside the closed preview schema",
        ORDER_FIELDS,
        unknownFields,
      ),
    );
  }

  if (typeof order.product_id !== "string" || !PRODUCT_PATTERN.test(order.product_id)) {
    failures.push(
      failure(
        "INVALID_PRODUCT_ID",
        "Product must use Coinbase BASE-QUOTE format",
        "ETH-USDC",
        order.product_id,
      ),
    );
  } else if (!mandate.allowed_products.includes(order.product_id)) {
    failures.push(
      failure(
        "PRODUCT_NOT_AUTHORIZED",
        "Trading pair is outside the authorized mandate",
        mandate.allowed_products,
        order.product_id,
      ),
    );
  }

  if (!mandate.allowed_sides.includes(order.side)) {
    failures.push(
      failure("SIDE_NOT_AUTHORIZED", "Order side is outside the authorized mandate", mandate.allowed_sides, order.side),
    );
  }

  if (!mandate.allowed_order_types.includes(order.type)) {
    failures.push(
      failure(
        "ORDER_TYPE_NOT_AUTHORIZED",
        "Order type is outside the authorized mandate",
        mandate.allowed_order_types,
        order.type,
      ),
    );
  }

  if (!Object.hasOwn(order, "quote_size") || !isPositiveDecimal(order.quote_size)) {
    failures.push(
      failure(
        "INVALID_QUOTE_SIZE",
        "This preview accepts one positive quote_size and no other sizing mode",
        "positive decimal string",
        order.quote_size,
      ),
    );
  } else if (compareDecimals(order.quote_size, mandate.max_quote_size) > 0) {
    failures.push(
      failure(
        "PRINCIPAL_CAP_EXCEEDED",
        "Proposed principal exceeds the authorized cap",
        mandate.max_quote_size,
        order.quote_size,
      ),
    );
  }

  return {
    verdict: failures.length ? "BLOCK" : "ALLOW",
    failures,
    checks: {
      closed_schema: unknownFields.length === 0,
      product: mandate.allowed_products.includes(order.product_id),
      side: mandate.allowed_sides.includes(order.side),
      order_type: mandate.allowed_order_types.includes(order.type),
      principal_cap:
        typeof order.quote_size === "string" &&
        isPositiveDecimal(order.quote_size) &&
        compareDecimals(order.quote_size, mandate.max_quote_size) <= 0,
    },
  };
}

export function selectPreviewEvidence(preview) {
  if (!isPlainObject(preview)) return null;
  const selected = {};
  for (const field of [...PREVIEW_DECIMAL_FIELDS, "slippage"]) {
    if (Object.hasOwn(preview, field)) selected[field] = preview[field];
  }
  return selected;
}

export function evaluatePreview(mandate, order, preview) {
  const failures = [];

  if (!isPlainObject(preview)) {
    return {
      verdict: "BLOCK",
      failures: [failure("INVALID_PREVIEW", "Coinbase preview response must be a JSON object", "object", typeof preview)],
    };
  }

  if (Array.isArray(preview.errs) && preview.errs.length) {
    failures.push(
      failure("COINBASE_PREVIEW_ERROR", "Coinbase reported that the proposed order cannot be submitted", [], preview.errs),
    );
  }

  for (const field of PREVIEW_DECIMAL_FIELDS) {
    if (!Object.hasOwn(preview, field)) continue;
    try {
      parseDecimal(preview[field], field);
    } catch {
      failures.push(
        failure("INVALID_PREVIEW_DECIMAL", `Coinbase preview field ${field} is not a decimal string`, "decimal string", preview[field]),
      );
    }
  }

  for (const requiredField of ["order_total", "commission_total", "quote_size"]) {
    if (!Object.hasOwn(preview, requiredField)) {
      failures.push(
        failure("MISSING_PREVIEW_FIELD", `Coinbase preview is missing ${requiredField}`, requiredField, null),
      );
    }
  }

  for (const positiveField of ["order_total", "quote_size"]) {
    if (
      Object.hasOwn(preview, positiveField) &&
      !isPositiveDecimal(preview[positiveField])
    ) {
      failures.push(
        failure(
          "NON_POSITIVE_PREVIEW_VALUE",
          `Coinbase preview field ${positiveField} must be positive`,
          "positive decimal string",
          preview[positiveField],
        ),
      );
    }
  }

  if (
    typeof preview.quote_size === "string" &&
    isPositiveDecimal(preview.quote_size) &&
    compareDecimals(preview.quote_size, order.quote_size) !== 0
  ) {
    failures.push(
      failure(
        "PREVIEW_SIZE_MISMATCH",
        "Coinbase preview size differs from the evaluated proposal",
        order.quote_size,
        preview.quote_size,
      ),
    );
  }

  if (
    typeof preview.order_total === "string" &&
    typeof preview.quote_size === "string" &&
    isPositiveDecimal(preview.order_total) &&
    isPositiveDecimal(preview.quote_size) &&
    compareDecimals(preview.order_total, preview.quote_size) < 0
  ) {
    failures.push(
      failure(
        "PREVIEW_TOTAL_BELOW_PRINCIPAL",
        "Coinbase preview all-in total cannot be below the quoted principal",
        `at least ${preview.quote_size}`,
        preview.order_total,
      ),
    );
  }

  if (
    typeof preview.order_total === "string" &&
    isPositiveDecimal(preview.order_total) &&
    compareDecimals(preview.order_total, mandate.max_order_total) > 0
  ) {
    failures.push(
      failure(
        "ALL_IN_CAP_EXCEEDED",
        "Estimated all-in debit exceeds the mandate",
        mandate.max_order_total,
        preview.order_total,
      ),
    );
  }

  if (
    typeof preview.commission_total === "string" &&
    isPositiveDecimal(preview.commission_total) &&
    compareDecimals(preview.commission_total, mandate.max_commission_total) > 0
  ) {
    failures.push(
      failure(
        "COMMISSION_CAP_EXCEEDED",
        "Estimated commission exceeds the mandate",
        mandate.max_commission_total,
        preview.commission_total,
      ),
    );
  }

  return {
    verdict: failures.length ? "BLOCK" : "ALLOW",
    failures,
    checks: {
      preview_complete: !failures.some((item) => item.code === "MISSING_PREVIEW_FIELD"),
      preview_size_matches: !failures.some((item) => item.code === "PREVIEW_SIZE_MISMATCH"),
      positive_economics: !failures.some(
        (item) => item.code === "NON_POSITIVE_PREVIEW_VALUE",
      ),
      total_not_below_principal: !failures.some(
        (item) => item.code === "PREVIEW_TOTAL_BELOW_PRINCIPAL",
      ),
      all_in_cap: !failures.some((item) => item.code === "ALL_IN_CAP_EXCEEDED"),
      commission_cap: !failures.some((item) => item.code === "COMMISSION_CAP_EXCEEDED"),
      slippage: "OBSERVE_ONLY",
    },
  };
}
