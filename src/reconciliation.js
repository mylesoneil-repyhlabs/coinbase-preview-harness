import {
  addDecimals,
  compareDecimals,
  divideDecimals,
  isPositiveDecimal,
  isSlippageWithinBps,
  isWithinDecimalTolerance,
  multiplyDecimals,
  parseDecimal,
  subtractDecimals,
} from "./decimal.js";

const PENDING_STATUSES = new Set([
  "PENDING",
  "OPEN",
  "QUEUED",
  "CANCEL_QUEUED",
  "EDIT_QUEUED",
]);
const NO_MORE_FILL_STATUSES = new Set([
  "CANCELLED",
  "EXPIRED",
  "FAILED",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireDecimal(
  value,
  field,
  { positive = false, nonnegative = false } = {},
) {
  const parsed = parseDecimal(value, field);
  if (positive && parsed.coefficient <= 0n) {
    throw new Error(`${field} must be positive`);
  }
  if (nonnegative && parsed.coefficient < 0n) {
    throw new Error(`${field} must be nonnegative`);
  }
  return value;
}

function requireFillCount(value) {
  const serialized =
    typeof value === "number" && Number.isInteger(value)
      ? String(value)
      : value;
  if (
    typeof serialized !== "string" ||
    !/^(0|[1-9]\d*)$/.test(serialized)
  ) {
    throw new Error("order.number_of_fills must be a nonnegative integer");
  }
  const count = Number(serialized);
  if (!Number.isSafeInteger(count)) {
    throw new Error("order.number_of_fills is too large");
  }
  return count;
}

function selectOrder(order) {
  const configuration = order.order_configuration?.sor_limit_ioc ?? {};
  const selectedConfiguration = {
    ...(configuration.quote_size === undefined
      ? {}
      : { quote_size: configuration.quote_size }),
    ...(configuration.base_size === undefined
      ? {}
      : { base_size: configuration.base_size }),
    limit_price: configuration.limit_price,
  };
  return {
    order_id: order.order_id,
    client_order_id: order.client_order_id,
    product_id: order.product_id,
    side: order.side,
    status: order.status,
    product_type: order.product_type,
    order_type: order.order_type,
    time_in_force: order.time_in_force,
    completion_percentage: order.completion_percentage,
    average_filled_price: order.average_filled_price,
    filled_size: order.filled_size,
    filled_value: order.filled_value,
    total_fees: order.total_fees,
    total_value_after_fees: order.total_value_after_fees,
    number_of_fills: order.number_of_fills,
    settled: order.settled,
    created_time: order.created_time,
    last_fill_time: order.last_fill_time,
    reject_reason: order.reject_reason,
    reject_message: order.reject_message,
    cancel_message: order.cancel_message,
    order_configuration: {
      sor_limit_ioc: selectedConfiguration,
    },
  };
}

function selectFill(fill) {
  return {
    entry_id: fill.entry_id,
    trade_id: fill.trade_id,
    order_id: fill.order_id,
    trade_time: fill.trade_time,
    price: fill.price,
    size: fill.size,
    commission: fill.commission,
    product_id: fill.product_id,
    side: fill.side,
  };
}

function assertOrderBinding(order, createPayload, expectedOrderId) {
  if (!isObject(order)) throw new Error("Coinbase Get Order response omitted order");
  if (
    order.order_id !== expectedOrderId ||
    order.client_order_id !== createPayload.client_order_id ||
    order.product_id !== createPayload.product_id ||
    order.side !== createPayload.side
  ) {
    throw new Error("Coinbase Get Order response is not bound to the submitted payload");
  }
  const expectedConfiguration = createPayload.order_configuration?.sor_limit_ioc;
  const actualConfiguration = order.order_configuration?.sor_limit_ioc;
  const sizeField = createPayload.side === "BUY" ? "quote_size" : "base_size";
  if (
    !isObject(expectedConfiguration) ||
    !isObject(actualConfiguration) ||
    compareDecimals(
      actualConfiguration[sizeField],
      expectedConfiguration[sizeField],
    ) !== 0 ||
    compareDecimals(
      actualConfiguration.limit_price,
      expectedConfiguration.limit_price,
    ) !== 0
  ) {
    throw new Error("Coinbase Get Order configuration differs from the authorized payload");
  }
  if (
    order.product_type !== "SPOT" ||
    order.order_type !== "LIMIT" ||
    order.time_in_force !== "IMMEDIATE_OR_CANCEL"
  ) {
    throw new Error("Coinbase Get Order returned an unauthorized product or order type");
  }
}

function evaluateActualConstraints(order, fills, policy, market, createPayload) {
  const failures = [];
  const filledValue = requireDecimal(order.filled_value, "order.filled_value", {
    nonnegative: true,
  });
  const totalFees = requireDecimal(order.total_fees, "order.total_fees", {
    nonnegative: true,
  });
  const totalValueAfterFees = requireDecimal(
    order.total_value_after_fees,
    "order.total_value_after_fees",
    { nonnegative: true },
  );
  const averagePrice = requireDecimal(
    order.average_filled_price,
    "order.average_filled_price",
    { nonnegative: true },
  );
  const completionPercentage = requireDecimal(
    order.completion_percentage,
    "order.completion_percentage",
    { nonnegative: true },
  );
  const filledSize = requireDecimal(order.filled_size, "order.filled_size", {
    nonnegative: true,
  });
  if (compareDecimals(completionPercentage, "100") > 0) {
    throw new Error("order.completion_percentage cannot exceed 100");
  }

  const actualPrincipal =
    policy.side === "BUY" ? filledValue : filledSize;
  if (compareDecimals(actualPrincipal, policy.size.value) > 0) {
    failures.push({
      code: "ACTUAL_PRINCIPAL_EXCEEDED",
      expected: policy.size.value,
      actual: actualPrincipal,
    });
  }
  if (compareDecimals(totalFees, policy.limits.max_commission.value) > 0) {
    failures.push({
      code: "ACTUAL_COMMISSION_EXCEEDED",
      expected: policy.limits.max_commission.value,
      actual: totalFees,
    });
  }
  let actualSettlement;
  if (policy.side === "BUY") {
    const calculatedAllIn = addDecimals(filledValue, totalFees);
    actualSettlement =
      compareDecimals(calculatedAllIn, totalValueAfterFees) >= 0
        ? calculatedAllIn
        : totalValueAfterFees;
    if (
      compareDecimals(
        actualSettlement,
        policy.limits.settlement.value,
      ) > 0
    ) {
      failures.push({
        code: "ACTUAL_MAX_QUOTE_DEBIT_EXCEEDED",
        expected: policy.limits.settlement.value,
        actual: actualSettlement,
      });
    }
  } else {
    const calculatedNet = subtractDecimals(filledValue, totalFees);
    actualSettlement =
      compareDecimals(calculatedNet, totalValueAfterFees) <= 0
        ? calculatedNet
        : totalValueAfterFees;
    const proportionalFloor = divideDecimals(
      multiplyDecimals(
        policy.limits.settlement.value,
        completionPercentage,
      ),
      "100",
      { scale: 18 },
    );
    if (compareDecimals(actualSettlement, proportionalFloor) < 0) {
      failures.push({
        code: "ACTUAL_MIN_NET_PROCEEDS_NOT_MET",
        expected: proportionalFloor,
        actual: actualSettlement,
      });
    }
  }

  if (isPositiveDecimal(averagePrice)) {
    const limitPrice =
      createPayload.order_configuration.sor_limit_ioc.limit_price;
    const limitComparison = compareDecimals(averagePrice, limitPrice);
    if (
      (policy.side === "BUY" && limitComparison > 0) ||
      (policy.side === "SELL" && limitComparison < 0)
    ) {
      failures.push({
        code: "ACTUAL_LIMIT_PRICE_VIOLATION",
        expected: limitPrice,
        actual: averagePrice,
      });
    }
    if (
      !isSlippageWithinBps(
        averagePrice,
        policy.side === "BUY" ? market.best_ask : market.best_bid,
        policy.limits.max_slippage_bps,
        policy.side,
      )
    ) {
      failures.push({
        code: "ACTUAL_SLIPPAGE_EXCEEDED",
        expected_bps: policy.limits.max_slippage_bps,
        reference_price:
          policy.side === "BUY" ? market.best_ask : market.best_bid,
        actual: averagePrice,
      });
    }
  }

  let fillCommission = "0";
  let fillSize = "0";
  let fillNotional = "0";
  for (const fill of fills) {
    if (
      !isObject(fill) ||
      fill.order_id !== order.order_id ||
      fill.product_id !== order.product_id ||
      fill.side !== order.side
    ) {
      throw new Error("Coinbase fill is not bound to the submitted order");
    }
    requireDecimal(fill.price, "fill.price", { positive: true });
    requireDecimal(fill.size, "fill.size", { positive: true });
    requireDecimal(fill.commission, "fill.commission", {
      nonnegative: true,
    });
    fillCommission = addDecimals(fillCommission, fill.commission);
    fillSize = addDecimals(fillSize, fill.size);
    fillNotional = addDecimals(
      fillNotional,
      multiplyDecimals(fill.price, fill.size),
    );
    const fillLimitComparison = compareDecimals(
      fill.price,
      createPayload.order_configuration.sor_limit_ioc.limit_price,
    );
    if (
      (policy.side === "BUY" && fillLimitComparison > 0) ||
      (policy.side === "SELL" && fillLimitComparison < 0)
    ) {
      failures.push({
        code: "FILL_LIMIT_PRICE_VIOLATION",
        expected:
          createPayload.order_configuration.sor_limit_ioc.limit_price,
        actual: fill.price,
        trade_id: fill.trade_id,
      });
    }
  }
  if (
    fills.length &&
    compareDecimals(fillCommission, policy.limits.max_commission.value) > 0
  ) {
    failures.push({
      code: "FILL_COMMISSION_EXCEEDED",
      expected: policy.limits.max_commission.value,
      actual: fillCommission,
    });
  }

  const averagePriceNotional = multiplyDecimals(
    averagePrice,
    order.filled_size,
  );
  const fillAggregatesCoherent =
    isWithinDecimalTolerance(
      fillSize,
      order.filled_size,
      market.base_increment,
    ) &&
    isWithinDecimalTolerance(
      fillNotional,
      order.filled_value,
      market.quote_increment,
    ) &&
    isWithinDecimalTolerance(
      averagePriceNotional,
      order.filled_value,
      market.quote_increment,
    );

  return {
    verdict: failures.length ? "BREACH" : "PASS",
    failures,
    settlement_kind: policy.limits.settlement.kind,
    actual_settlement_value: actualSettlement,
    observed_fill_commission: fillCommission,
    observed_fill_size: fillSize,
    observed_fill_notional: fillNotional,
    average_price_notional: averagePriceNotional,
    fill_aggregates_coherent: fillAggregatesCoherent,
  };
}

function hasCompletePositiveFillAggregate(order) {
  return (
    isPositiveDecimal(order.filled_value) &&
    isPositiveDecimal(order.filled_size) &&
    isPositiveDecimal(order.average_filled_price) &&
    isPositiveDecimal(order.completion_percentage) &&
    isPositiveDecimal(order.total_value_after_fees)
  );
}

function hasZeroFillAggregate(order) {
  return (
    compareDecimals(order.filled_value, "0") === 0 &&
    compareDecimals(order.filled_size, "0") === 0 &&
    compareDecimals(order.average_filled_price, "0") === 0 &&
    compareDecimals(order.completion_percentage, "0") === 0 &&
    compareDecimals(order.total_fees, "0") === 0 &&
    compareDecimals(order.total_value_after_fees, "0") === 0
  );
}

function classifyOrder(order, numberOfFills, fillsComplete, evidenceCoherent) {
  const status = order.status;
  const terminalFillEvidence =
    numberOfFills > 0 &&
    fillsComplete &&
    evidenceCoherent &&
    order.settled === true &&
    hasCompletePositiveFillAggregate(order);
  const terminalNoFillEvidence =
    numberOfFills === 0 &&
    fillsComplete &&
    evidenceCoherent &&
    order.settled === true &&
    hasZeroFillAggregate(order);

  if (status === "FILLED") {
    return terminalFillEvidence &&
      compareDecimals(order.completion_percentage, "100") === 0
      ? "FILLED"
      : "RECONCILIATION_PENDING";
  }
  if (NO_MORE_FILL_STATUSES.has(status)) {
    if (
      terminalFillEvidence &&
      compareDecimals(order.completion_percentage, "100") < 0
    ) {
      return "PARTIAL_FILL";
    }
    return terminalNoFillEvidence ? "NO_FILL" : "RECONCILIATION_PENDING";
  }
  if (PENDING_STATUSES.has(status)) return "ORDER_PENDING";
  return "RECONCILIATION_PENDING";
}

export function reconcileSubmittedOrder({
  orderResponse,
  fillsResponse,
  createPayload,
  expectedOrderId,
  policy,
  market,
  checkedAt = new Date(),
}) {
  const order = orderResponse?.order;
  assertOrderBinding(order, createPayload, expectedOrderId);
  if (!Array.isArray(fillsResponse?.fills)) {
    throw new Error("Coinbase List Fills response omitted fills");
  }
  const fills = fillsResponse.fills;
  const numberOfFills = requireFillCount(order.number_of_fills);
  const checks = evaluateActualConstraints(
    order,
    fills,
    policy,
    market,
    createPayload,
  );
  const paginationComplete =
    fillsResponse.has_next !== true &&
    (fillsResponse.cursor === undefined ||
      fillsResponse.cursor === null ||
      fillsResponse.cursor === "");
  const fillsComplete =
    paginationComplete && numberOfFills === fills.length;
  const evidenceCoherent =
    fillsComplete &&
    checks.fill_aggregates_coherent &&
    (numberOfFills === 0
      ? compareDecimals(checks.observed_fill_commission, "0") === 0
      : isWithinDecimalTolerance(
          checks.observed_fill_commission,
          order.total_fees,
          market.quote_increment,
        ));
  const outcome = classifyOrder(
    order,
    numberOfFills,
    fillsComplete,
    evidenceCoherent,
  );
  return {
    checked_at: checkedAt.toISOString(),
    outcome:
      checks.verdict === "BREACH" ? "EXECUTION_POLICY_BREACH" : outcome,
    checks,
    order: selectOrder(order),
    fills: fills.map(selectFill),
    fills_complete: fillsComplete,
    pagination_complete: paginationComplete,
    evidence_coherent: evidenceCoherent,
  };
}
