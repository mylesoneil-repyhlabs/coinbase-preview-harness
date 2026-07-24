const ACTION_FIELDS = Object.freeze([
  "product_id",
  "side",
  "type",
  "time_in_force",
  "quote_size",
  "limit_price",
]);

function assertExactAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error("Coinbase action must be an object");
  }
  const fields = Object.keys(action);
  const unknown = fields.filter((field) => !ACTION_FIELDS.includes(field));
  const missing = ACTION_FIELDS.filter((field) => !Object.hasOwn(action, field));
  if (unknown.length || missing.length) {
    throw new Error(
      `Coinbase action schema mismatch: unknown=${unknown.join(",") || "none"}; missing=${missing.join(",") || "none"}`,
    );
  }
  if (
    action.side !== "BUY" ||
    action.type !== "limit" ||
    action.time_in_force !== "IOC"
  ) {
    throw new Error("Live v1 only transports BUY SOR limit IOC actions");
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
        quote_size: action.quote_size,
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
