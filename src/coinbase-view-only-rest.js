import { digestBytes } from "./evidence.js";
import { reviewError } from "./guard-errors.js";
import { createRequestJwt } from "./permissions.js";

export const COINBASE_VIEW_API_ORIGIN =
  "https://api.coinbase.com";
export const COINBASE_VIEW_API_HOST = "api.coinbase.com";
export const COINBASE_VIEW_BROKERAGE_PATH =
  "/api/v3/brokerage";

export const VIEW_ONLY_PREFLIGHT_ROUTES = Object.freeze([
  Object.freeze({
    method: "GET",
    path: `${COINBASE_VIEW_BROKERAGE_PATH}/accounts`,
  }),
  Object.freeze({
    method: "GET",
    pathPattern:
      /^\/api\/v3\/brokerage\/products\/[A-Z0-9]+-[A-Z0-9]+$/,
  }),
  Object.freeze({
    method: "GET",
    path: `${COINBASE_VIEW_BROKERAGE_PATH}/best_bid_ask`,
  }),
  Object.freeze({
    method: "POST",
    path: `${COINBASE_VIEW_BROKERAGE_PATH}/orders/preview`,
  }),
]);

function assertCredential(credentials) {
  if (
    typeof credentials?.keyId !== "string" ||
    !credentials.keyId ||
    typeof credentials?.privateKey !== "string" ||
    !credentials.privateKey
  ) {
    throw new Error(
      "Verified Coinbase View-only credentials are required",
    );
  }
}

function safeProductId(productId) {
  if (
    typeof productId !== "string" ||
    !/^[A-Z0-9]+-[A-Z0-9]+$/.test(productId)
  ) {
    throw new Error("Invalid Coinbase product_id");
  }
  return productId;
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

function requestSignal(timeoutMs, sessionSignal) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 250 ||
    timeoutMs > 30_000
  ) {
    throw new Error(
      "Coinbase View-only timeout must be 250 through 30000 milliseconds",
    );
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  if (sessionSignal == null) return timeout;
  if (
    typeof sessionSignal !== "object" ||
    typeof sessionSignal.aborted !== "boolean" ||
    typeof sessionSignal.addEventListener !== "function"
  ) {
    throw new Error(
      "Coinbase View-only session signal is invalid",
    );
  }
  return AbortSignal.any([timeout, sessionSignal]);
}

function allowedRoute(method, requestPath) {
  return VIEW_ONLY_PREFLIGHT_ROUTES.some(
    (route) =>
      route.method === method &&
      (route.path === requestPath ||
        route.pathPattern?.test(requestPath)),
  );
}

function providerFailure(status) {
  const code =
    status === 401 || status === 403
      ? "COINBASE_CREDENTIAL_REJECTED"
      : status === 429
        ? "COINBASE_RATE_LIMITED"
        : status >= 500
          ? "COINBASE_OUTAGE"
          : "COINBASE_REQUEST_REJECTED";
  return reviewError(
    code,
    `Coinbase API request failed (HTTP ${status})`,
    {
      httpStatus: status,
      retryable: status === 429 || status >= 500,
      recovery:
        status === 401 || status === 403
          ? "Reconnect a current View-only key. No order was submitted."
          : status === 429
            ? "Wait briefly, then run a fresh View-only preflight. No order was submitted."
            : "Run a fresh View-only preflight when Coinbase is available. No order was submitted.",
    },
  );
}

function createViewOnlyRequest(
  credentials,
  {
    fetchImpl = fetch,
    timeoutMs = 5_000,
    signal = null,
  } = {},
) {
  assertCredential(credentials);
  if (typeof fetchImpl !== "function") {
    throw new TypeError(
      "Coinbase View-only fetch dependency is invalid",
    );
  }

  return async function request(
    method,
    requestPath,
    { query, body } = {},
  ) {
    if (!allowedRoute(method, requestPath)) {
      throw new Error(
        "Coinbase View-only preflight denied a route outside its explicit allowlist",
      );
    }
    const url = new URL(
      requestPath,
      COINBASE_VIEW_API_ORIGIN,
    );
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const bodyText =
      body === undefined ? undefined : JSON.stringify(body);
    const jwt = createRequestJwt(
      credentials.keyId,
      credentials.privateKey,
      method,
      COINBASE_VIEW_API_HOST,
      requestPath,
    );
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
      signal: requestSignal(timeoutMs, signal),
    });
    if (
      !response ||
      typeof response.ok !== "boolean" ||
      !Number.isInteger(response.status) ||
      response.status < 100 ||
      response.status > 599 ||
      response.ok !==
        (response.status >= 200 && response.status <= 299) ||
      typeof response.text !== "function"
    ) {
      throw reviewError(
        "COINBASE_RESPONSE_MALFORMED",
        "Coinbase returned an unverifiable response",
      );
    }
    const text = await response.text();
    if (text.length > 256 * 1024) {
      throw reviewError(
        "COINBASE_RESPONSE_TOO_LARGE",
        "Coinbase response exceeded the View-only safety limit",
      );
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
    if (!response.ok) throw providerFailure(response.status);
    return {
      response: parsed,
      transport: {
        method,
        host: COINBASE_VIEW_API_HOST,
        path: requestPath,
        query: query ?? {},
        sent_body_digest:
          typeof bodyText === "string"
            ? digestBytes(bodyText)
            : null,
      },
    };
  };
}

export function createCoinbaseViewOnlyPreflightAdapter(
  credentials,
  options = {},
) {
  const request = createViewOnlyRequest(
    credentials,
    options,
  );
  return Object.freeze({
    async listAccounts() {
      const accounts = [];
      const cursors = new Set();
      let cursor;
      for (let page = 0; page < 20; page += 1) {
        const query = { limit: "250" };
        if (cursor !== undefined) {
          query.cursor = safeCursor(cursor);
        }
        const { response } = await request(
          "GET",
          `${COINBASE_VIEW_BROKERAGE_PATH}/accounts`,
          { query },
        );
        if (
          !Array.isArray(response?.accounts) ||
          typeof response.has_next !== "boolean"
        ) {
          throw new Error(
            "Coinbase List Accounts response is malformed",
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
          throw new Error(
            "Coinbase List Accounts cursor repeated",
          );
        }
        cursors.add(cursor);
      }
      throw new Error(
        "Coinbase List Accounts exceeded the pagination limit",
      );
    },
    getProduct(productId) {
      const safeId = safeProductId(productId);
      return request(
        "GET",
        `${COINBASE_VIEW_BROKERAGE_PATH}/products/${safeId}`,
        { query: { get_tradability_status: "true" } },
      ).then((result) => result.response);
    },
    getBestBidAsk(productId) {
      const safeId = safeProductId(productId);
      return request(
        "GET",
        `${COINBASE_VIEW_BROKERAGE_PATH}/best_bid_ask`,
        { query: { product_ids: safeId } },
      ).then((result) => result.response);
    },
    previewOrder(requestBody) {
      return request(
        "POST",
        `${COINBASE_VIEW_BROKERAGE_PATH}/orders/preview`,
        { body: requestBody },
      );
    },
  });
}
