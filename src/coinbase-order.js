const COMMON_ACTION_FIELDS = Object.freeze([
  "product_id",
  "side",
  "type",
  "time_in_force",
  "limit_price",
]);

function assertExactAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error("Coinbase action must be an object");
  }
  const sizeField =
    action.side === "BUY"
      ? "quote_size"
      : action.side === "SELL"
        ? "base_size"
        : null;
  const expectedFields = sizeField
    ? [...COMMON_ACTION_FIELDS, sizeField]
    : COMMON_ACTION_FIELDS;
  const fields = Object.keys(action);
  const unknown = fields.filter((field) => !expectedFields.includes(field));
  const missing = expectedFields.filter(
    (field) => !Object.hasOwn(action, field),
  );
  if (unknown.length || missing.length) {
    throw new Error(
      `Coinbase action schema mismatch: unknown=${unknown.join(",") || "none"}; missing=${missing.join(",") || "none"}`,
    );
  }
  if (
    !["BUY", "SELL"].includes(action.side) ||
    action.type !== "limit" ||
    action.time_in_force !== "IOC"
  ) {
    throw new Error(
      "Only BUY or SELL SOR limit IOC spot actions are supported",
    );
  }
  return action;
}

export function buildCoinbasePreviewRequest(action) {
  assertExactAction(action);
  return {
    product_id: action.product_id,
    side: action.side,
    order_configuration: {
      sor_limit_ioc: {
        [action.side === "BUY" ? "quote_size" : "base_size"]:
          action[action.side === "BUY" ? "quote_size" : "base_size"],
        limit_price: action.limit_price,
      },
    },
  };
}

export function buildCoinbaseCreateRequest(action, clientOrderId, previewId) {
  const preview = buildCoinbasePreviewRequest(action);
  if (typeof clientOrderId !== "string" || !clientOrderId) {
    throw new Error("client_order_id is required");
  }
  if (typeof previewId !== "string" || !previewId) {
    throw new Error("preview_id is required");
  }
  return {
    client_order_id: clientOrderId,
    ...preview,
    preview_id: previewId,
  };
}
