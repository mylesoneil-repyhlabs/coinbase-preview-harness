import { createRequestJwt } from "./permissions.js";
import { digestBytes } from "./evidence.js";
import { assertProductionExecutionCapability } from "./integration/production-composition.js";
import { reviewError } from "./guard-errors.js";

export const COINBASE_API_ORIGIN = "https://api.coinbase.com";
export const COINBASE_API_HOST = "api.coinbase.com";
export const BROKERAGE_PATH = "/api/v3/brokerage";
export const VIEW_ONLY_PREFLIGHT_ROUTES = Object.freeze([
  Object.freeze({
    method: "GET",
    path: `${BROKERAGE_PATH}/accounts`,
  }),
  Object.freeze({
    method: "GET",
    pathPattern: /^\/api\/v3\/brokerage\/products\/[A-Z0-9]+-[A-Z0-9]+$/,
  }),
  Object.freeze({
    method: "GET",
    path: `${BROKERAGE_PATH}/best_bid_ask`,
  }),
  Object.freeze({
    method: "POST",
    path: `${BROKERAGE_PATH}/orders/preview`,
  }),
]);

function assertCredential(credentials) {
  if (
    typeof credentials?.keyId !== "string" ||
    !credentials.keyId ||
    typeof credentials?.privateKey !== "string" ||
    !credentials.privateKey
  ) {
    throw new Error("Verified Coinbase trade credentials are required");
  }
}

function safeProductId(productId) {
  if (typeof productId !== "string" || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(productId)) {
    throw new Error("Invalid Coinbase product_id");
  }
  return productId;
}

function safeOrderId(orderId) {
  if (
    typeof orderId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(orderId)
  ) {
    throw new Error("Invalid Coinbase order_id");
  }
  return orderId;
}

function safeSide(side) {
  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("Invalid Coinbase order side");
  }
  return side;
}

function safeTimestamp(timestamp, name) {
  if (
    typeof timestamp !== "string" ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new Error(`Invalid Coinbase ${name}`);
  }
  return timestamp;
}

function safeCursor(cursor) {
  if (
    typeof cursor !== "string" ||
    !cursor ||
    cursor.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(cursor)
  ) {
    throw new Error("Invalid Coinbase pagination cursor");
  }
  return cursor;
}

function safeErrorMessage(_body, status) {
  // Provider bodies can contain account, request, or tenant identifiers. The
  // local receipt needs the typed class and status, not arbitrary upstream
  // text.
  return `Coinbase API request failed (HTTP ${status})`;
}

function createCoinbaseRequest(
  credentials,
  {
    fetchImpl = fetch,
    timeoutMs = 5_000,
    routeAllowlist = null,
  } = {},
) {
  assertCredential(credentials);

  return async function request(
    method,
    requestPath,
    { query, body, serializedBody } = {},
  ) {
    if (
      typeof requestPath !== "string" ||
      !requestPath.startsWith(`${BROKERAGE_PATH}/`)
    ) {
      throw new Error("Coinbase request path is outside the pinned brokerage API");
    }
    if (
      routeAllowlist &&
      !routeAllowlist.some(
        (route) =>
          route.method === method &&
          (route.path === requestPath ||
            route.pathPattern?.test(requestPath)),
      )
    ) {
      throw new Error(
        "Coinbase View-only preflight denied a route outside its explicit allowlist",
      );
    }
    const url = new URL(requestPath, COINBASE_API_ORIGIN);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, value);
      }
    }
    const jwt = createRequestJwt(
      credentials.keyId,
      credentials.privateKey,
      method,
      COINBASE_API_HOST,
      requestPath,
    );
    const bodyText =
      serializedBody === undefined
        ? body === undefined
          ? undefined
          : JSON.stringify(body)
        : serializedBody;
    if (
      serializedBody !== undefined &&
      (typeof serializedBody !== "string" ||
        body === undefined ||
        JSON.stringify(body) !== serializedBody)
    ) {
      throw new Error(
        "Serialized Coinbase body does not match the authorized payload",
      );
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${jwt}`,
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
      },
      body: bodyText,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (text.length > 256 * 1024) {
      throw new Error("Coinbase API response exceeded the safety limit");
    }
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw reviewError(
        "COINBASE_RESPONSE_MALFORMED",
        `Coinbase API returned invalid JSON (HTTP ${response.status})`,
        { httpStatus: response.status },
      );
    }
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "COINBASE_CREDENTIAL_REJECTED"
          : response.status === 429
            ? "COINBASE_RATE_LIMITED"
            : response.status >= 500
              ? "COINBASE_OUTAGE"
              : "COINBASE_REQUEST_REJECTED";
      throw reviewError(code, safeErrorMessage(parsed, response.status), {
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
        recovery:
          response.status === 401 || response.status === 403
            ? "Reconnect a current View-only key. No order was submitted."
            : response.status === 429
              ? "Wait briefly, then run a fresh View-only preflight. No order was submitted."
              : "Run a fresh View-only preflight when Coinbase is available. No order was submitted.",
      });
    }
    return {
      response: parsed,
      transport: {
        method,
        host: COINBASE_API_HOST,
        path: requestPath,
        query: query ?? {},
        sent_body_digest:
          typeof bodyText === "string" ? digestBytes(bodyText) : null,
      },
    };
  };
}

export function createCoinbaseRestAdapter(credentials, options = {}) {
  const request = createCoinbaseRequest(credentials, options);

  return Object.freeze({
    async listAccounts() {
      const accounts = [];
      const cursors = new Set();
      let cursor;
      for (let page = 0; page < 20; page += 1) {
        const query = { limit: "250" };
        if (cursor !== undefined) query.cursor = safeCursor(cursor);
        const result = await request(
          "GET",
          `${BROKERAGE_PATH}/accounts`,
          { query },
        );
        const response = result.response;
        if (!Array.isArray(response?.accounts)) {
          throw new Error("Coinbase List Accounts response is malformed");
        }
        if (typeof response.has_next !== "boolean") {
          throw new Error(
            "Coinbase List Accounts response omitted has_next",
          );
        }
        accounts.push(...response.accounts);
        if (response.has_next === false) {
          return {
            accounts,
            has_next: false,
            cursor: null,
          };
        }
        cursor = safeCursor(response.cursor);
        if (cursors.has(cursor)) {
          throw new Error("Coinbase List Accounts cursor repeated");
        }
        cursors.add(cursor);
      }
      throw new Error("Coinbase List Accounts exceeded the pagination limit");
    },
    async listProducts({ productIds } = {}) {
      const baseQuery = {
        product_type: "SPOT",
        get_tradability_status: "true",
        limit: "100",
      };
      if (productIds !== undefined) {
        if (
          !Array.isArray(productIds) ||
          productIds.length < 1 ||
          productIds.length > 100
        ) {
          throw new Error("productIds must contain 1 through 100 products");
        }
        baseQuery.product_ids = productIds.map(safeProductId);
      }
      const products = [];
      const productIdsSeen = new Set();
      const cursors = new Set();
      let cursor;
      for (let page = 0; page < 100; page += 1) {
        const query = { ...baseQuery };
        if (cursor !== undefined) query.cursor = cursor;
        const result = await request("GET", `${BROKERAGE_PATH}/products`, {
          query,
        });
        const response = result.response;
        if (
          !Array.isArray(response?.products) ||
          typeof response?.pagination?.has_next !== "boolean"
        ) {
          throw new Error("Coinbase List Products response is malformed");
        }
        for (const product of response.products) {
          const productId = safeProductId(product?.product_id);
          if (productIdsSeen.has(productId)) {
            throw new Error("Coinbase List Products repeated a product ID");
          }
          productIdsSeen.add(productId);
          products.push(product);
        }
        if (response.pagination.has_next === false) {
          return {
            products,
            num_products: products.length,
            pagination: {
              has_next: false,
              next_cursor: null,
            },
          };
        }
        cursor = safeCursor(response.pagination.next_cursor);
        if (cursors.has(cursor)) {
          throw new Error("Coinbase List Products cursor repeated");
        }
        cursors.add(cursor);
      }
      throw new Error("Coinbase List Products exceeded the pagination limit");
    },
    getProduct(productId) {
      const safeId = safeProductId(productId);
      return request("GET", `${BROKERAGE_PATH}/products/${safeId}`, {
        query: { get_tradability_status: "true" },
      }).then((result) => result.response);
    },
    getBestBidAsk(productId) {
      const safeId = safeProductId(productId);
      return request("GET", `${BROKERAGE_PATH}/best_bid_ask`, {
        query: { product_ids: safeId },
      }).then((result) => result.response);
    },
    previewOrder(requestBody) {
      return request("POST", `${BROKERAGE_PATH}/orders/preview`, {
        body: requestBody,
      });
    },
    getOrder(orderId) {
      const safeId = safeOrderId(orderId);
      return request(
        "GET",
        `${BROKERAGE_PATH}/orders/historical/${safeId}`,
      ).then((result) => result.response);
    },
    listOrders({ productId, side, startDate, endDate, cursor } = {}) {
      const query = {
        product_ids: [safeProductId(productId)],
        product_type: "SPOT",
        order_status: [
          "PENDING",
          "OPEN",
          "FILLED",
          "CANCELLED",
          "EXPIRED",
          "FAILED",
          "QUEUED",
          "CANCEL_QUEUED",
          "EDIT_QUEUED",
        ],
        time_in_forces: ["IMMEDIATE_OR_CANCEL"],
        order_types: ["LIMIT"],
        order_side: safeSide(side),
        start_date: safeTimestamp(startDate, "start_date"),
        end_date: safeTimestamp(endDate, "end_date"),
        limit: "100",
      };
      if (cursor !== undefined) query.cursor = safeCursor(cursor);
      return request(
        "GET",
        `${BROKERAGE_PATH}/orders/historical/batch`,
        { query },
      ).then((result) => result.response);
    },
    listFills(orderId) {
      const safeId = safeOrderId(orderId);
      return request("GET", `${BROKERAGE_PATH}/orders/historical/fills`, {
        query: { order_ids: safeId, limit: "100" },
      }).then((result) => result.response);
    },
  });
}

export function createCoinbaseViewOnlyPreflightAdapter(
  credentials,
  options = {},
) {
  const adapter = createCoinbaseRestAdapter(credentials, {
    ...options,
    routeAllowlist: VIEW_ONLY_PREFLIGHT_ROUTES,
  });
  return Object.freeze({
    listAccounts: adapter.listAccounts,
    getProduct: adapter.getProduct,
    getBestBidAsk: adapter.getBestBidAsk,
    previewOrder: adapter.previewOrder,
  });
}

export function createCoinbaseExecutionAdapter(
  credentials,
  executionCapability,
  options = {},
) {
  // Check the non-forgeable composition capability before validating or using
  // credentials. The checked-in public build cannot obtain this value.
  assertProductionExecutionCapability(executionCapability);
  const request = createCoinbaseRequest(credentials, options);

  return Object.freeze({
    createOrder(requestBody, serializedBody) {
      return request("POST", `${BROKERAGE_PATH}/orders`, {
        body: requestBody,
        serializedBody,
      });
    },
  });
}
