import { compareDecimals, isPositiveDecimal } from "./decimal.js";
import { blockError, reviewError } from "./guard-errors.js";

function requiredString(value, name) {
  if (typeof value !== "string" || !value) {
    throw reviewError(
      "PRODUCT_SCHEMA_MISSING_FIELD",
      `${name} is required`,
    );
  }
  return value;
}

export function normalizeCoinbaseMarketData(product, bestBidAsk, productId) {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw reviewError(
      "PRODUCT_RESPONSE_MALFORMED",
      "Coinbase product response must be an object",
    );
  }
  if (product.product_id !== productId) {
    throw reviewError(
      "PRODUCT_RESPONSE_MISMATCH",
      "Coinbase product response does not match the authorized product",
    );
  }
  if (product.product_type !== "SPOT") {
    throw blockError(
      "PRODUCT_NOT_SPOT",
      "Coinbase product is not SPOT",
    );
  }
  if (typeof product.status !== "string" || product.status.toLowerCase() !== "online") {
    throw blockError(
      "PRODUCT_NOT_ONLINE",
      "Coinbase product status is not online",
    );
  }
  for (const flag of [
    "is_disabled",
    "trading_disabled",
    "view_only",
    "cancel_only",
    "limit_only",
    "post_only",
    "auction_mode",
  ]) {
    if (typeof product[flag] !== "boolean") {
      throw reviewError(
        "PRODUCT_SCHEMA_MISSING_FLAG",
        `Coinbase product response is missing required boolean: ${flag}`,
      );
    }
  }
  for (const flag of [
    "is_disabled",
    "trading_disabled",
    "view_only",
    "cancel_only",
    "post_only",
    "auction_mode",
  ]) {
    if (product[flag] === true) {
      throw blockError(
        "PRODUCT_UNAVAILABLE",
        `Coinbase product is not executable: ${flag}`,
      );
    }
  }

  const books = bestBidAsk?.pricebooks;
  if (!Array.isArray(books)) {
    throw reviewError(
      "BBO_RESPONSE_MALFORMED",
      "Coinbase best bid/ask response is malformed",
    );
  }
  const book = books.find((item) => item?.product_id === productId);
  const bestBid = book?.bids?.[0]?.price;
  const bestAsk = book?.asks?.[0]?.price;
  if (!isPositiveDecimal(bestBid) || !isPositiveDecimal(bestAsk)) {
    throw reviewError(
      "BBO_MISSING",
      "Coinbase did not return a positive best bid and ask",
    );
  }
  if (compareDecimals(bestBid, bestAsk) >= 0) {
    throw reviewError(
      "BBO_CROSSED",
      "Coinbase best bid must be below best ask",
    );
  }

  const priceIncrement = product.price_increment;
  if (!isPositiveDecimal(priceIncrement)) {
    throw reviewError(
      "PRODUCT_SCHEMA_INVALID_INCREMENT",
      "Coinbase product is missing a valid price increment",
    );
  }
  if (!isPositiveDecimal(product.quote_increment)) {
    throw reviewError(
      "PRODUCT_SCHEMA_INVALID_INCREMENT",
      "Coinbase product is missing a valid quote increment",
    );
  }
  if (!isPositiveDecimal(product.base_increment)) {
    throw reviewError(
      "PRODUCT_SCHEMA_INVALID_INCREMENT",
      "Coinbase product is missing a valid base increment",
    );
  }
  for (const field of [
    "base_min_size",
    "base_max_size",
    "quote_min_size",
    "quote_max_size",
  ]) {
    if (!isPositiveDecimal(product[field])) {
      throw reviewError(
        "PRODUCT_SCHEMA_INVALID_SIZE",
        `Coinbase product is missing a valid ${field}`,
      );
    }
  }
  if (
    compareDecimals(product.base_min_size, product.base_max_size) > 0 ||
    compareDecimals(product.quote_min_size, product.quote_max_size) > 0
  ) {
    throw reviewError(
      "PRODUCT_SCHEMA_CONTRADICTORY_SIZE",
      "Coinbase product size bounds are contradictory",
    );
  }

  return {
    product_id: productId,
    product_type: product.product_type,
    status: product.status.toLowerCase(),
    base_asset: requiredString(product.base_currency_id, "base_currency_id"),
    quote_asset: requiredString(product.quote_currency_id, "quote_currency_id"),
    base_increment: product.base_increment,
    quote_increment: product.quote_increment,
    price_increment: priceIncrement,
    base_min_size: product.base_min_size,
    base_max_size: product.base_max_size,
    quote_min_size: product.quote_min_size,
    quote_max_size: product.quote_max_size,
    best_bid: bestBid,
    best_ask: bestAsk,
    observed_at: requiredString(book.time, "pricebook.time"),
    product_flags: {
      is_disabled: product.is_disabled === true,
      trading_disabled: product.trading_disabled === true,
      view_only: product.view_only === true,
      cancel_only: product.cancel_only === true,
      limit_only: product.limit_only === true,
      post_only: product.post_only === true,
      auction_mode: product.auction_mode === true,
    },
  };
}
