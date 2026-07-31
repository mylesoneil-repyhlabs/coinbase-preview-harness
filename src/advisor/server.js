import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCoinbaseDemo } from "../coinbase-demo.js";
import {
  createCoinbaseViewOnlyPreflightAdapter,
} from "../coinbase-view-only-rest.js";
import { readHistory } from "../dry-run-history.js";
import { GuardDecisionError } from "../guard-errors.js";
import { normalizeCoinbaseMarketData } from "../market.js";
import { createExecutionPlan } from "../plan.js";
import { runGuardPreflight } from "../preflight.js";
import { productionExecutionStatus } from "../integration/production-composition.js";
import {
  advisorStatusCapabilities,
  loadAdvisorCapabilities,
} from "./capabilities.js";
import {
  conditionalFixtureEvidence,
  createConditionalPlan,
  simulateConditionalPlan,
} from "./conditional-plan.js";
import {
  ConditionalSessionError,
  authorizeConditionalSessionPlan,
  beginConditionalSessionAttempt,
  cancelConditionalSessionAttempt,
  conditionalPlanView,
  failConditionalSessionAttempt,
  finishConditionalSessionAttempt,
  rememberConditionalPlan,
  reviseConditionalSessionPlan,
  revokeConditionalSessionPlan,
} from "./conditional-session.js";
import {
  createEducationalViewOnlyAuthority,
  createGeneratedEducationalMarketSnapshot,
} from "./educational-planning.js";
import {
  EducationalSessionError,
  createEducationalSessionHandoff,
  createEducationalSessionPlan,
  educationalSessionPlanView,
  reviseEducationalSessionPlan,
} from "./educational-session.js";
import {
  AdvisorSessionStore,
  appendActivity,
  isSessionToken,
  registerSessionDisposer,
  rememberPlan,
} from "./session-store.js";
import { createSimulatedReviewFixture } from "./review-fixture.js";
import {
  createInMemoryViewCredentialProvider,
} from "./view-only-credential-provider.js";
import {
  advisorActivityView,
  advisorGuardResultView,
  advisorHistoryView,
  advisorPlanView,
  advisorShowcaseView,
} from "./view-model.js";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WEB_ROOT = path.resolve(SOURCE_DIR, "../../web");
export const DEFAULT_ADVISOR_HOST = "127.0.0.1";
const SESSION_COOKIE = "delta_advisor_session";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_STATIC_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 32;
const EDUCATIONAL_MARKET_MAX_AGE_SECONDS = 60;
const EDUCATIONAL_SOURCE_MAX_AGE_SECONDS = 31_536_000;
const EDUCATIONAL_PRODUCT_FIXTURES = Object.freeze({
  "BTC-USDC": Object.freeze({
    product_id: "BTC-USDC",
    base_asset: "BTC",
    quote_asset: "USDC",
    product_type: "SPOT",
    available: true,
    best_bid: "118500.20",
    best_ask: "118500.30",
  }),
  "ETH-USDC": Object.freeze({
    product_id: "ETH-USDC",
    base_asset: "ETH",
    quote_asset: "USDC",
    product_type: "SPOT",
    available: true,
    best_bid: "3820.05",
    best_ask: "3820.15",
  }),
  "SOL-USDC": Object.freeze({
    product_id: "SOL-USDC",
    base_asset: "SOL",
    quote_asset: "USDC",
    product_type: "SPOT",
    available: true,
    best_bid: "185.10",
    best_ask: "185.20",
  }),
});
const ADVISOR_POST_ROUTES = new Set([
  "/api/advisor/plan",
  "/api/advisor/authorize",
  "/api/connection/connect",
  "/api/connection/disconnect",
  "/api/conditional/plan",
  "/api/conditional/revise",
  "/api/conditional/authorize",
  "/api/conditional/cancel",
  "/api/conditional/simulate",
  "/api/conditional/revoke",
  "/api/education/plan",
  "/api/education/revise",
  "/api/education/handoff",
  "/api/demo/showcase",
  "/api/demo/review",
]);
const LOOPBACK_HOST_PATTERN =
  /^(?:127\.0\.0\.1|localhost)(?::(0|[1-9]\d{0,4}))?$/;

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function safeJson(response, status, value, headers = {}) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function safeError(response, error, headers = {}) {
  const known = error instanceof HttpError;
  safeJson(
    response,
    known ? error.status : 500,
    {
      error: {
        code: known ? error.code : "ADVISOR_INTERNAL_ERROR",
        message: known
          ? error.message
          : "The advisor stopped safely. No order was submitted.",
      },
      boundary: {
        create_available: false,
        order_submitted: false,
        money_moved: false,
      },
    },
    headers,
  );
}

function strictFields(value, allowed, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_REQUEST", `${name} must be an object.`);
  }
  const unknown = Object.keys(value).filter(
    (field) => !allowed.includes(field),
  );
  if (unknown.length) {
    throw new HttpError(
      400,
      "INVALID_REQUEST",
      `${name} contains unsupported fields.`,
    );
  }
  return value;
}

function connectionHttpError(error) {
  const code =
    error instanceof GuardDecisionError &&
    typeof error.code === "string"
      ? error.code
      : "VIEW_ONLY_CONNECTION_UNAVAILABLE";
  if (code === "VIEW_ONLY_CREDENTIAL_MALFORMED") {
    return new HttpError(
      400,
      code,
      "Use one Coinbase CDP ECDSA P-256 key name and private key.",
    );
  }
  if (
    [
      "VIEW_ONLY_CREDENTIAL_REJECTED",
      "VIEW_ONLY_PERMISSION_REJECTED",
      "VIEW_ONLY_PERMISSION_RESPONSE_MALFORMED",
    ].includes(code)
  ) {
    return new HttpError(
      422,
      code,
      "Coinbase did not confirm a safe View-only scope. Trade and Transfer must be off.",
    );
  }
  if (
    [
      "VIEW_ONLY_PERMISSION_RATE_LIMITED",
      "VIEW_ONLY_PERMISSION_OUTAGE",
      "VIEW_ONLY_PERMISSION_TIMEOUT",
    ].includes(code)
  ) {
    return new HttpError(
      503,
      code,
      "Coinbase could not verify the View-only key right now. Nothing was stored; try again.",
    );
  }
  return new HttpError(
    422,
    code,
    "The local View-only connection stopped safely. Nothing was stored and no order was submitted.",
  );
}

function conditionalHttpError(error) {
  if (error instanceof HttpError) return error;
  const code =
    error instanceof ConditionalSessionError &&
    typeof error.code === "string"
      ? error.code
      : "CONDITIONAL_PLAN_INVALID";
  const notFound = [
    "CONDITIONAL_PLAN_NOT_FOUND",
    "CONDITIONAL_REVISION_NOT_FOUND",
  ].includes(code);
  const conflict =
    code.includes("CONSUMED") ||
    code.includes("CONFLICT") ||
    code.includes("SUPERSEDED") ||
    code.includes("REVOKED") ||
    code.includes("EXPIRED") ||
    code.includes("NOT_AUTHORIZABLE") ||
    code.includes("MISMATCH");
  return new HttpError(
    notFound ? 404 : conflict ? 409 : 422,
    code,
    error instanceof Error
      ? error.message
      : "The saved-plan check stopped safely. No order was submitted.",
  );
}

function requireConditionalIdentity(input) {
  if (
    typeof input.plan_id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(input.plan_id) ||
    !Number.isInteger(input.revision) ||
    input.revision < 1
  ) {
    throw new HttpError(
      400,
      "CONDITIONAL_ID_INVALID",
      "Choose the current saved-plan revision.",
    );
  }
}

function educationalHttpError(error) {
  if (error instanceof HttpError) return error;
  const code =
    error instanceof EducationalSessionError &&
    typeof error.code === "string"
      ? error.code
      : "EDUCATIONAL_PLANNING_INVALID";
  const notFound =
    code === "EDUCATIONAL_PLAN_NOT_FOUND" ||
    code === "EDUCATIONAL_LEG_NOT_FOUND";
  const conflict =
    code.includes("REVISION") ||
    code.includes("HANDOFF_ALREADY");
  return new HttpError(
    notFound ? 404 : conflict ? 409 : 422,
    code,
    error instanceof Error
      ? error.message
      : "Educational planning stopped safely. No trade was authorized.",
  );
}

function educationalPlanningInput(input, { sourceRequired }) {
  const allowed = [
    "planning_amount_value",
    "quote_asset",
    "scenario_acknowledged",
    "allocations",
  ];
  if (sourceRequired) allowed.push("source");
  strictFields(input, allowed, "Educational plan request");
  if (
    (sourceRequired &&
      !["fixture", "view_only"].includes(input.source)) ||
    typeof input.planning_amount_value !== "string" ||
    input.planning_amount_value.length < 1 ||
    input.planning_amount_value.length > 64 ||
    input.quote_asset !== "USDC" ||
    input.scenario_acknowledged !== true ||
    !Array.isArray(input.allocations) ||
    input.allocations.length < 1 ||
    input.allocations.length > 3
  ) {
    throw new HttpError(
      400,
      "EDUCATIONAL_INPUT_INVALID",
      "Choose a source, a positive USDC planning amount, one to three explicit allocation rows, and confirm the scenario assumptions.",
    );
  }
  const seen = new Set();
  const allocations = input.allocations.map(
    (candidate, index) => {
      const allocation = strictFields(
        candidate,
        [
          "product_id",
          "weight_bps",
          "scenario_change_bps",
        ],
        `Educational allocation ${index + 1}`,
      );
      const fixture =
        EDUCATIONAL_PRODUCT_FIXTURES[
          allocation.product_id
        ];
      if (
        !fixture ||
        seen.has(allocation.product_id) ||
        !Number.isInteger(allocation.weight_bps) ||
        allocation.weight_bps < 1 ||
        allocation.weight_bps > 10_000 ||
        !Number.isInteger(
          allocation.scenario_change_bps,
        ) ||
        allocation.scenario_change_bps < -10_000 ||
        allocation.scenario_change_bps > 10_000
      ) {
        throw new HttpError(
          400,
          "EDUCATIONAL_ALLOCATION_INVALID",
          "Each allocation must use one unique supported pair, a positive basis-point weight, and one scenario change from -10000 to 10000 bps.",
        );
      }
      seen.add(allocation.product_id);
      return {
        asset: fixture.base_asset,
        product_id: fixture.product_id,
        weight_bps: allocation.weight_bps,
        scenario_change_bps:
          allocation.scenario_change_bps,
      };
    },
  );
  return {
    source: sourceRequired ? input.source : null,
    requestedProductIds: allocations.map(
      ({ product_id }) => product_id,
    ),
    planningAmount: {
      asset: input.quote_asset,
      value: input.planning_amount_value,
    },
    scenarioAcknowledged:
      input.scenario_acknowledged === true,
    allocations: allocations.map(
      ({ asset, product_id, weight_bps }) => ({
        asset,
        product_id,
        weight_bps,
      }),
    ),
    scenarios: [
      {
        name: "User-supplied stress scenario",
        changes: allocations.map(
          ({ asset, scenario_change_bps }) => ({
            asset,
            change_bps: scenario_change_bps,
          }),
        ),
      },
    ],
  };
}

function requireEducationalIdentity(input, { leg = false } = {}) {
  const identifier =
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  if (
    typeof input?.plan_id !== "string" ||
    !identifier.test(input.plan_id) ||
    !Number.isInteger(input.revision) ||
    input.revision < 1 ||
    (leg &&
      (typeof input.leg_id !== "string" ||
        !identifier.test(input.leg_id) ||
        !["BUY", "SELL"].includes(input.side)))
  ) {
    throw new HttpError(
      400,
      "EDUCATIONAL_IDENTITY_INVALID",
      leg
        ? "Choose one current plan revision, one displayed allocation leg, and an explicit BUY or SELL side."
        : "Choose the current educational plan revision.",
    );
  }
}

function generatedEducationalProducts(productIds, observedAt) {
  return productIds.flatMap((productId) => {
    const fixture = EDUCATIONAL_PRODUCT_FIXTURES[productId];
    return fixture
      ? [{ ...fixture, observed_at: observedAt }]
      : [];
  });
}

function verifiedCredentialEnvelope({
  attestation,
  credentials,
}) {
  const result = { attestation };
  Object.defineProperty(result, "credentials", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: credentials,
  });
  return Object.freeze(result);
}

function disconnectedConnectionStatus() {
  return Object.freeze({
    schema_version:
      "delta.coinbase.advisor_view_only_connection.v1",
    connected: false,
    mode: "view_only_preflight",
    storage: "server_process_memory_only",
    create_available: false,
    no_order_submitted: true,
  });
}

function connectionResponse(connection) {
  return {
    schema_version:
      "delta.coinbase.advisor_connection_response.v1",
    connection,
    boundary: {
      mode: "view_only_preflight",
      local_session_only: true,
      browser_storage: false,
      persistent_storage: false,
      create_available: false,
      order_submitted: false,
      money_moved: false,
      statement:
        "View only can read permissions, held balances, one product, BBO, and one exact Preview. Preview is not an order or price guarantee.",
    },
  };
}

async function readJson(request, { allowEmpty = false } = {}) {
  const encoding = request.headers["content-encoding"];
  if (encoding && encoding !== "identity") {
    throw new HttpError(
      415,
      "UNSUPPORTED_CONTENT_ENCODING",
      "Compressed request bodies are not accepted.",
    );
  }
  const declaredLength = Number(request.headers["content-length"]);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_BODY_BYTES
  ) {
    throw new HttpError(
      413,
      "REQUEST_TOO_LARGE",
      "The request is too large.",
    );
  }
  const chunks = [];
  let total = 0;
  let exceeded = false;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      exceeded = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (exceeded) {
    throw new HttpError(
      413,
      "REQUEST_TOO_LARGE",
      "The request is too large.",
    );
  }
  if (total === 0 && allowEmpty) return {};
  const contentType = request.headers["content-type"] ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(
      415,
      "JSON_REQUIRED",
      "Send this request as application/json.",
    );
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "INVALID_JSON",
      "The request body is not valid JSON.",
    );
  }
}

function parseSessionCookie(header) {
  if (typeof header !== "string" || header.length > 8_192) return null;
  for (const segment of header.split(";")) {
    const [name, ...rest] = segment.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const value = rest.join("=");
    return isSessionToken(value) ? value : null;
  }
  return null;
}

function sessionCookie(session, store, secureCookies) {
  const parts = [
    `${SESSION_COOKIE}=${session.token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${store.ttlSeconds}`,
  ];
  if (secureCookies) parts.push("Secure");
  return parts.join("; ");
}

function assertLoopbackRequest(request) {
  const host = request.headers.host;
  const match =
    typeof host === "string" ? host.match(LOOPBACK_HOST_PATTERN) : null;
  const port = match?.[1] == null ? null : Number(match[1]);
  if (!match || (port != null && port > 65_535)) {
    throw new HttpError(
      400,
      "LOOPBACK_HOST_REQUIRED",
      "The advisor accepts loopback browser requests only.",
    );
  }
  return host;
}

function assertSameOriginMutation(request, host, secureCookies) {
  const origin = request.headers.origin;
  const expectedOrigin = `${secureCookies ? "https" : "http"}://${host}`;
  if (origin !== expectedOrigin) {
    throw new HttpError(
      403,
      "SAME_ORIGIN_REQUIRED",
      "Reload the local advisor and try again.",
    );
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (
    typeof fetchSite === "string" &&
    !["same-origin", "none"].includes(fetchSite)
  ) {
    throw new HttpError(
      403,
      "SAME_ORIGIN_REQUIRED",
      "Reload the local advisor and try again.",
    );
  }
  if (request.headers["x-delta-advisor"] !== "1") {
    throw new HttpError(
      403,
      "ADVISOR_HEADER_REQUIRED",
      "Reload the local advisor and try again.",
    );
  }
}

function assertApiRequestContext(request) {
  const fetchSite = request.headers["sec-fetch-site"];
  if (
    typeof fetchSite === "string" &&
    !["same-origin", "none"].includes(fetchSite)
  ) {
    throw new HttpError(
      403,
      "SAME_ORIGIN_REQUIRED",
      "Reload the local advisor and try again.",
    );
  }
}

function activityEntry(kind, status, {
  now,
  plan = null,
  decision = null,
  receiptDigest = null,
} = {}) {
  return {
    activity_id: randomUUID(),
    occurred_at: now().toISOString(),
    kind,
    status,
    product_id:
      plan?.policy?.product_id ??
      plan?.template?.product_id ??
      null,
    side:
      plan?.policy?.side ??
      plan?.template?.side ??
      null,
    decision,
    receipt_digest: receiptDigest,
  };
}

async function staticFile(webRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "INVALID_PATH", "The requested path is invalid.");
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (
    !relative ||
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === ".." || part.startsWith("."))
  ) {
    throw new HttpError(404, "NOT_FOUND", "The requested page was not found.");
  }
  const root = await realpath(webRoot).catch(() => null);
  if (!root) {
    throw new HttpError(
      503,
      "FRONTEND_UNAVAILABLE",
      "The advisor frontend is not installed.",
    );
  }
  const target = path.resolve(root, relative);
  const containment = path.relative(root, target);
  if (
    containment === "" ||
    containment === ".." ||
    containment.startsWith(`..${path.sep}`) ||
    path.isAbsolute(containment)
  ) {
    throw new HttpError(404, "NOT_FOUND", "The requested page was not found.");
  }
  const originalMetadata = await lstat(target).catch(() => null);
  if (
    !originalMetadata ||
    originalMetadata.isSymbolicLink() ||
    !originalMetadata.isFile() ||
    originalMetadata.size > MAX_STATIC_BYTES
  ) {
    throw new HttpError(404, "NOT_FOUND", "The requested page was not found.");
  }
  const canonicalTarget = await realpath(target).catch(() => null);
  const canonicalContainment =
    canonicalTarget == null ? null : path.relative(root, canonicalTarget);
  if (
    !canonicalTarget ||
    canonicalContainment === "" ||
    canonicalContainment === ".." ||
    canonicalContainment.startsWith(`..${path.sep}`) ||
    path.isAbsolute(canonicalContainment)
  ) {
    throw new HttpError(404, "NOT_FOUND", "The requested page was not found.");
  }
  const metadata = await lstat(canonicalTarget).catch(() => null);
  if (
    !metadata ||
    !metadata.isFile() ||
    metadata.size > MAX_STATIC_BYTES
  ) {
    throw new HttpError(404, "NOT_FOUND", "The requested page was not found.");
  }
  const extension = path.extname(target).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    throw new HttpError(404, "NOT_FOUND", "The requested page was not found.");
  }
  return { body: await readFile(canonicalTarget), contentType };
}

export function createAdvisorRequestHandler({
  webRoot = DEFAULT_WEB_ROOT,
  sessionStore = new AdvisorSessionStore(),
  history = {},
  secureCookies = false,
  now = () => new Date(),
  createPlan = createExecutionPlan,
  runPreflight = runGuardPreflight,
  runShowcase = runCoinbaseDemo,
  createReview = createSimulatedReviewFixture,
  readGuardHistory = readHistory,
  createViewCredentialProvider = () =>
    createInMemoryViewCredentialProvider(),
  createViewOnlyAdapter =
    createCoinbaseViewOnlyPreflightAdapter,
  capabilityProfile = loadAdvisorCapabilities(),
  maxConcurrentRequests = DEFAULT_MAX_CONCURRENT_REQUESTS,
} = {}) {
  if (
    !Number.isInteger(maxConcurrentRequests) ||
    maxConcurrentRequests < 1 ||
    maxConcurrentRequests > 256
  ) {
    throw new Error(
      "Advisor concurrent request limit must be between 1 and 256",
    );
  }
  const statusCapabilities = advisorStatusCapabilities(
    capabilityProfile,
  );
  if (typeof createViewCredentialProvider !== "function") {
    throw new Error(
      "Advisor View-only provider factory must be a function",
    );
  }
  if (typeof createViewOnlyAdapter !== "function") {
    throw new Error(
      "Advisor View-only adapter factory must be a function",
    );
  }
  // This authority is handler-private. Browser input can never obtain its
  // WeakSet membership or turn structural normalization into provenance.
  const educationalViewOnlyAuthority =
    createEducationalViewOnlyAuthority();
  const credentialProviders = new WeakMap();
  function credentialProviderFor(session, { create = true } = {}) {
    let provider = credentialProviders.get(session);
    if (provider) return provider;
    if (!create) return null;
    provider = createViewCredentialProvider();
    if (
      !provider ||
      typeof provider.connect !== "function" ||
      typeof provider.status !== "function" ||
      typeof provider.disconnect !== "function" ||
      typeof provider.withVerifiedCredential !== "function"
    ) {
      throw new Error(
        "Advisor View-only provider contract is invalid",
      );
    }
    credentialProviders.set(session, provider);
    registerSessionDisposer(session, () => {
      try {
        provider.disconnect();
      } finally {
        credentialProviders.delete(session);
      }
    });
    return provider;
  }

  async function educationalSnapshotFor(
    session,
    planning,
    evaluatedAt,
  ) {
    const evaluatedAtIso = evaluatedAt.toISOString();
    let products = [];
    if (planning.source === "fixture") {
      products = generatedEducationalProducts(
        planning.requestedProductIds,
        evaluatedAtIso,
      );
    } else {
      try {
        const provider = credentialProviderFor(session, {
          create: false,
        });
        if (
          provider == null ||
          provider.status().connected !== true
        ) {
          throw new Error(
            "View-only connection unavailable",
          );
        }
        products = await provider.withVerifiedCredential(
          async ({
            credentials,
            signal,
            assertCurrent,
          }) => {
            const adapter = createViewOnlyAdapter(
              credentials,
              {
                timeoutMs: 5_000,
                signal,
              },
            );
            const observations = await Promise.all(
              planning.requestedProductIds.map(
                async (productId) => {
                  const [product, bestBidAsk] =
                    await Promise.all([
                      adapter.getProduct(productId),
                      adapter.getBestBidAsk(productId),
                    ]);
                  return educationalViewOnlyAuthority
                    .normalizeAdapterResult(
                      product,
                      bestBidAsk,
                      productId,
                    );
                },
              ),
            );
            assertCurrent();
            return observations;
          },
        );
      } catch {
        products = [];
      }
    }
    const snapshotInput = {
      snapshot_id: randomUUID(),
      evaluated_at: evaluatedAtIso,
      market_max_age_seconds:
        EDUCATIONAL_MARKET_MAX_AGE_SECONDS,
      education_max_age_seconds:
        EDUCATIONAL_SOURCE_MAX_AGE_SECONDS,
      requested_product_ids:
        planning.requestedProductIds,
      products,
    };
    return planning.source === "fixture"
      ? createGeneratedEducationalMarketSnapshot(
          snapshotInput,
        )
      : educationalViewOnlyAuthority.createSnapshot(
          snapshotInput,
        );
  }

  let activeRequests = 0;
  return async function advisorRequestHandler(request, response) {
    let cookieHeader = {};
    if (activeRequests >= maxConcurrentRequests) {
      safeError(
        response,
        new HttpError(
          503,
          "ADVISOR_BUSY",
          "The local advisor is busy. Nothing was submitted; try again.",
        ),
      );
      return;
    }
    activeRequests += 1;
    try {
      const host = assertLoopbackRequest(request);
      const url = new URL(request.url ?? "/", `http://${host}`);
      const pathname = url.pathname;
      const isApi = pathname.startsWith("/api/");

      if (!isApi) {
        if (!["GET", "HEAD"].includes(request.method ?? "")) {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
        }
        const asset = await staticFile(webRoot, pathname);
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          "Content-Type": asset.contentType,
          "Content-Length": asset.body.length,
        });
        response.end(request.method === "HEAD" ? undefined : asset.body);
        return;
      }

      assertApiRequestContext(request);
      if ((request.method ?? "") === "POST") {
        assertSameOriginMutation(request, host, secureCookies);
      }

      if (request.method === "GET" && pathname === "/api/status") {
        const execution = productionExecutionStatus();
        safeJson(response, 200, {
          schema_version: "delta.coinbase.advisor_status.v1",
          service: "Delta Guard Advisor",
          ready: true,
          session: {
            storage: "SERVER_MEMORY_ONLY",
            created: false,
            idle_expires_after_seconds:
              sessionStore.idleTtlSeconds,
            absolute_expires_after_seconds:
              sessionStore.absoluteTtlSeconds,
          },
          capabilities: statusCapabilities,
          execution: {
            ...execution,
            order_submitted: false,
            money_moved: false,
          },
          boundary:
            "Dry run: No credentials are needed. An optional local View-only session can read Coinbase facts and Preview; Create, orders, and money movement remain unavailable.",
        });
        return;
      }

      if (
        request.method === "GET" &&
        pathname === "/api/connection"
      ) {
        const token = parseSessionCookie(
          request.headers.cookie,
        );
        const session =
          typeof sessionStore.peek === "function"
            ? sessionStore.peek(token)
            : null;
        const provider =
          session == null
            ? null
            : credentialProviderFor(session, {
                create: false,
              });
        safeJson(
          response,
          200,
          connectionResponse(
            provider?.status() ??
              disconnectedConnectionStatus(),
          ),
        );
        return;
      }

      if (
        request.method === "GET" &&
        pathname === "/api/activity"
      ) {
        const token = parseSessionCookie(
          request.headers.cookie,
        );
        const session =
          typeof sessionStore.peek === "function"
            ? sessionStore.peek(token)
            : null;
        let entries;
        try {
          entries = await readGuardHistory({
            limit: 20,
            ...history,
          });
        } catch {
          throw new HttpError(
            503,
            "HISTORY_UNAVAILABLE",
            "Local Guard history is temporarily unavailable.",
          );
        }
        safeJson(response, 200, {
          schema_version:
            "delta.coinbase.advisor_activity.v1",
          session_activity: advisorActivityView(
            session?.activity ?? [],
          ),
          guard_history: advisorHistoryView(entries),
          boundary: {
            local_only: true,
            create_available: false,
            order_submitted: false,
            money_moved: false,
          },
        });
        return;
      }

      if (
        request.method !== "POST" ||
        !ADVISOR_POST_ROUTES.has(pathname)
      ) {
        if (
          request.method === "POST" ||
          request.method === "GET"
        ) {
          throw new HttpError(
            404,
            "API_ROUTE_NOT_FOUND",
            "That advisor action is not available.",
          );
        }
        throw new HttpError(
          405,
          "METHOD_NOT_ALLOWED",
          "Method not allowed.",
        );
      }

      const suppliedToken = parseSessionCookie(
        request.headers.cookie,
      );
      const existingSession =
        typeof sessionStore.peek === "function"
          ? sessionStore.peek(suppliedToken)
          : null;
      if (
        pathname === "/api/connection/disconnect" &&
        existingSession == null
      ) {
        strictFields(
          await readJson(request, { allowEmpty: true }),
          [],
          "View-only disconnect request",
        );
        safeJson(
          response,
          200,
          connectionResponse(
            disconnectedConnectionStatus(),
          ),
        );
        return;
      }
      if (
        pathname === "/api/advisor/authorize" &&
        existingSession == null
      ) {
        throw new HttpError(
          404,
          "PLAN_NOT_FOUND",
          "This mandate is not available in the current local session.",
        );
      }
      if (
        pathname.startsWith("/api/conditional/") &&
        pathname !== "/api/conditional/plan" &&
        existingSession == null
      ) {
        throw new HttpError(
          404,
          "CONDITIONAL_PLAN_NOT_FOUND",
          "This saved plan is not available in the current local session.",
        );
      }
      if (
        pathname.startsWith("/api/education/") &&
        pathname !== "/api/education/plan" &&
        existingSession == null
      ) {
        throw new HttpError(
          404,
          "EDUCATIONAL_PLAN_NOT_FOUND",
          "This educational plan is not available in the current local session.",
        );
      }

      let session = existingSession;
      if (session != null) {
        session = sessionStore.open(suppliedToken).session;
      } else if (
        pathname === "/api/advisor/plan" ||
        pathname === "/api/conditional/plan" ||
        pathname === "/api/education/plan" ||
        pathname === "/api/connection/connect"
      ) {
        session = sessionStore.open(null).session;
      } else {
        session = {
          plans: new Map(),
          conditionalPlans: new Map(),
          educationalPlans: new Map(),
          activity: [],
        };
      }
      if (isSessionToken(session.token)) {
        cookieHeader = {
          "Set-Cookie": sessionCookie(
            session,
            sessionStore,
            secureCookies,
          ),
        };
      }

      if (
        request.method === "POST" &&
        pathname === "/api/connection/connect"
      ) {
        const input = strictFields(
          await readJson(request),
          ["name", "privateKey"],
          "View-only connection request",
        );
        if (
          typeof input.name !== "string" ||
          input.name.length < 1 ||
          input.name.length > 512 ||
          typeof input.privateKey !== "string" ||
          input.privateKey.length < 1 ||
          input.privateKey.length > 8 * 1024
        ) {
          throw new HttpError(
            400,
            "VIEW_ONLY_CREDENTIAL_MALFORMED",
            "Use one Coinbase CDP ECDSA P-256 key name and private key.",
          );
        }
        const provider = credentialProviderFor(session);
        let connection;
        try {
          connection = await provider.connect({
            name: input.name,
            privateKey: input.privateKey,
          });
        } catch (error) {
          throw connectionHttpError(error);
        }
        appendActivity(
          session,
          activityEntry("VIEW_ONLY_CONNECTION", "CONNECTED", {
            now,
          }),
        );
        safeJson(
          response,
          200,
          connectionResponse(connection),
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/connection/disconnect"
      ) {
        strictFields(
          await readJson(request, { allowEmpty: true }),
          [],
          "View-only disconnect request",
        );
        const provider = credentialProviderFor(session, {
          create: false,
        });
        const connection =
          provider?.disconnect() ??
          disconnectedConnectionStatus();
        if (provider) {
          appendActivity(
            session,
            activityEntry(
              "VIEW_ONLY_CONNECTION",
              "DISCONNECTED",
              { now },
            ),
          );
        }
        safeJson(
          response,
          200,
          connectionResponse(connection),
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/conditional/plan"
      ) {
        const input = strictFields(
          await readJson(request),
          [
            "product_id",
            "side",
            "size_value",
            "threshold_value",
            "max_slippage_bps",
            "max_fee_value",
            "timezone",
            "expires_at",
          ],
          "Conditional plan request",
        );
        let plan;
        try {
          plan = createConditionalPlan(input, { now });
        } catch (error) {
          throw conditionalHttpError(error);
        }
        const saved = rememberConditionalPlan(session, plan);
        appendActivity(
          session,
          activityEntry(
            "CONDITIONAL_PLAN",
            saved.session_state,
            { now, plan },
          ),
        );
        safeJson(
          response,
          200,
          { saved_plan: saved },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/conditional/revise"
      ) {
        const input = strictFields(
          await readJson(request),
          ["plan_id", "revision", "patch"],
          "Conditional plan revision request",
        );
        requireConditionalIdentity(input);
        const patch = strictFields(
          input.patch,
          [
            "product_id",
            "side",
            "size_value",
            "threshold_value",
            "max_slippage_bps",
            "max_fee_value",
            "timezone",
            "expires_at",
          ],
          "Conditional plan revision",
        );
        let revised;
        try {
          revised = reviseConditionalSessionPlan(session, {
            planId: input.plan_id,
            revision: input.revision,
            patch,
            now,
          });
        } catch (error) {
          throw conditionalHttpError(error);
        }
        appendActivity(
          session,
          activityEntry(
            "CONDITIONAL_PLAN_REVISION",
            revised.current.session_state,
            { now, plan: revised.current.plan },
          ),
        );
        safeJson(
          response,
          200,
          { saved_plan: revised.current },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/conditional/authorize"
      ) {
        const input = strictFields(
          await readJson(request),
          [
            "plan_id",
            "revision",
            "source",
            "ttl_seconds",
          ],
          "Conditional simulation authorization request",
        );
        requireConditionalIdentity(input);
        let authorized;
        try {
          authorized = authorizeConditionalSessionPlan(
            session,
            {
              planId: input.plan_id,
              revision: input.revision,
              source: input.source,
              ttlSeconds: input.ttl_seconds,
              now,
            },
          );
        } catch (error) {
          throw conditionalHttpError(error);
        }
        appendActivity(
          session,
          activityEntry(
            "CONDITIONAL_SIMULATION_AUTHORIZATION",
            authorized.session_state,
            { now, plan: authorized.plan },
          ),
        );
        safeJson(
          response,
          200,
          { saved_plan: authorized },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/conditional/revoke"
      ) {
        const input = strictFields(
          await readJson(request),
          ["plan_id", "revision"],
          "Conditional plan revoke request",
        );
        requireConditionalIdentity(input);
        let revoked;
        try {
          revoked = revokeConditionalSessionPlan(session, {
            planId: input.plan_id,
            revision: input.revision,
            now,
          });
        } catch (error) {
          throw conditionalHttpError(error);
        }
        appendActivity(
          session,
          activityEntry(
            "CONDITIONAL_PLAN",
            "REVOKED",
            { now, plan: revoked.plan },
          ),
        );
        safeJson(
          response,
          200,
          { saved_plan: revoked },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/conditional/cancel"
      ) {
        const input = strictFields(
          await readJson(request),
          [
            "plan_id",
            "revision",
            "authorization_id",
          ],
          "Conditional simulation cancellation request",
        );
        requireConditionalIdentity(input);
        if (
          typeof input.authorization_id !== "string" ||
          !input.authorization_id
        ) {
          throw new HttpError(
            400,
            "CONDITIONAL_AUTHORIZATION_INVALID",
            "Identify the current one-check authorization before cancelling it.",
          );
        }
        let cancellation;
        try {
          cancellation = cancelConditionalSessionAttempt(
            session,
            {
              planId: input.plan_id,
              revision: input.revision,
              authorizationId: input.authorization_id,
              now,
            },
          );
        } catch (error) {
          throw conditionalHttpError(error);
        }
        if (
          cancellation.cancelled &&
          cancellation.already_cancelled !== true
        ) {
          appendActivity(
            session,
            activityEntry(
              "CONDITIONAL_SIMULATION_CANCELLED",
              "REVIEW",
              {
                now,
                plan: cancellation.saved_plan.plan,
                decision: "REVIEW",
              },
            ),
          );
        }
        safeJson(
          response,
          200,
          cancellation,
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/conditional/simulate"
      ) {
        const input = strictFields(
          await readJson(request),
          [
            "plan_id",
            "revision",
            "authorization_id",
            "scenario",
          ],
          "Conditional simulation request",
        );
        requireConditionalIdentity(input);
        if (
          typeof input.authorization_id !== "string" ||
          !input.authorization_id
        ) {
          throw new HttpError(
            400,
            "CONDITIONAL_AUTHORIZATION_INVALID",
            "Authorize this saved-plan revision for one fresh simulation check.",
          );
        }
        if (
          input.scenario != null &&
          !["not_met", "block", "pass"].includes(
            input.scenario,
          )
        ) {
          throw new HttpError(
            400,
            "CONDITIONAL_SCENARIO_INVALID",
            "Choose one labeled fixture scenario.",
          );
        }
        let pendingPlan;
        try {
          pendingPlan = conditionalPlanView(
            session,
            input.plan_id,
            input.revision,
          );
        } catch (error) {
          throw conditionalHttpError(error);
        }
        if (
          pendingPlan.authorization?.authorization_id !==
          input.authorization_id
        ) {
          throw new HttpError(
            409,
            "CONDITIONAL_AUTHORIZATION_MISMATCH",
            "Authorize the current saved-plan revision for one fresh check.",
          );
        }
        if (
          pendingPlan.authorization.source === "view_only" &&
          input.scenario != null &&
          input.scenario !== "pass"
        ) {
          throw new HttpError(
            400,
            "CONDITIONAL_VIEW_ONLY_SCENARIO_INVALID",
            "A View-only check uses the observed BBO; fixture scenario controls do not apply.",
          );
        }

        let attempt;
        try {
          attempt = beginConditionalSessionAttempt(session, {
            planId: input.plan_id,
            revision: input.revision,
            authorizationId: input.authorization_id,
            now,
          });
        } catch (error) {
          throw conditionalHttpError(error);
        }

        let result;
        let completed;
        try {
          const selectedScenario =
            attempt.authorization.source === "fixture"
              ? input.scenario ?? "pass"
              : "pass";
          let evidence;
          if (attempt.authorization.source === "fixture") {
            evidence = conditionalFixtureEvidence(
              attempt.plan,
              selectedScenario,
              { now },
            );
          } else {
            try {
              const provider = credentialProviderFor(session, {
                create: false,
              });
              if (
                provider == null ||
                provider.status().connected !== true
              ) {
                throw new Error(
                  "View-only connection unavailable",
                );
              }
              evidence =
                await provider.withVerifiedCredential(
                  async ({
                    credentials,
                    signal,
                    assertCurrent,
                  }) => {
                    const adapter = createViewOnlyAdapter(
                      credentials,
                      {
                        timeoutMs: 5_000,
                        signal: AbortSignal.any([
                          signal,
                          attempt.signal,
                        ]),
                      },
                    );
                    const [product, bestBidAsk] =
                      await Promise.all([
                        adapter.getProduct(
                          attempt.plan.template.product_id,
                        ),
                        adapter.getBestBidAsk(
                          attempt.plan.template.product_id,
                        ),
                      ]);
                    assertCurrent();
                    const market =
                      normalizeCoinbaseMarketData(
                        product,
                        bestBidAsk,
                        attempt.plan.template.product_id,
                      );
                    return Object.freeze({
                      source: "view_only",
                      product_id: market.product_id,
                      best_bid: market.best_bid,
                      best_ask: market.best_ask,
                      observed_at: market.observed_at,
                    });
                  },
                );
            } catch {
              evidence = Object.freeze({
                source: "view_only",
                product_id:
                  attempt.plan.template.product_id,
                unavailable: true,
              });
            }
          }

          result = simulateConditionalPlan({
            plan: attempt.plan,
            authorization: attempt.authorization,
            evidence,
            scenario: selectedScenario,
            now,
            currentRevision: input.revision,
          });
          completed = finishConditionalSessionAttempt(
            session,
            {
              planId: input.plan_id,
              revision: input.revision,
              attemptId: attempt.attempt_id,
              result,
              now,
            },
          );
        } catch (error) {
          try {
            failConditionalSessionAttempt(session, {
              planId: input.plan_id,
              revision: input.revision,
              attemptId: attempt.attempt_id,
            });
          } catch {
            // A newer terminal state owns the revision; never revive it.
          }
          if (
            error instanceof ConditionalSessionError ||
            error instanceof HttpError
          ) {
            throw conditionalHttpError(error);
          }
          throw new HttpError(
            500,
            "CONDITIONAL_SIMULATION_STOPPED_SAFE",
            "The one-check simulation stopped safely. Authorize a fresh check; nothing is watching and no order was submitted.",
          );
        }
        appendActivity(
          session,
          activityEntry(
            "CONDITIONAL_SIMULATION",
            completed.session_state,
            {
              now,
              plan: completed.plan,
              decision: result.decision,
              receiptDigest:
                result.receipt?.receipt_digest ?? null,
            },
          ),
        );
        safeJson(
          response,
          200,
          { saved_plan: completed, result },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/education/plan"
      ) {
        const planning = educationalPlanningInput(
          await readJson(request),
          { sourceRequired: true },
        );
        const evaluatedAt = now();
        if (
          !(evaluatedAt instanceof Date) ||
          !Number.isFinite(evaluatedAt.getTime())
        ) {
          throw new HttpError(
            500,
            "EDUCATIONAL_CLOCK_INVALID",
            "Educational planning stopped safely because the local clock is unavailable.",
          );
        }
        const snapshot = await educationalSnapshotFor(
          session,
          planning,
          evaluatedAt,
        );
        let savedPlan;
        try {
          savedPlan = createEducationalSessionPlan(
            session,
            {
              snapshot,
              planning_amount:
                planning.planningAmount,
              allocations: planning.allocations,
              scenarios: planning.scenarios,
              scenario_acknowledged:
                planning.scenarioAcknowledged,
            },
            { now: () => new Date(evaluatedAt) },
          );
        } catch (error) {
          throw educationalHttpError(error);
        }
        appendActivity(
          session,
          activityEntry(
            "EDUCATIONAL_PLAN",
            savedPlan.session_state,
            {
              now: () => new Date(evaluatedAt),
              decision: savedPlan.plan.decision.outcome,
            },
          ),
        );
        safeJson(
          response,
          200,
          { saved_plan: savedPlan },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/education/revise"
      ) {
        const input = strictFields(
          await readJson(request),
          [
            "plan_id",
            "revision",
            "planning_amount_value",
            "quote_asset",
            "scenario_acknowledged",
            "allocations",
          ],
          "Educational revision request",
        );
        requireEducationalIdentity(input);
        const planning = educationalPlanningInput(
          {
            planning_amount_value:
              input.planning_amount_value,
            quote_asset: input.quote_asset,
            scenario_acknowledged:
              input.scenario_acknowledged,
            allocations: input.allocations,
          },
          { sourceRequired: false },
        );
        let current;
        try {
          current = educationalSessionPlanView(session, {
            planId: input.plan_id,
            revision: input.revision,
          });
        } catch (error) {
          throw educationalHttpError(error);
        }
        const source =
          current.plan?.market_snapshot?.market_source;
        if (!["fixture", "view_only"].includes(source)) {
          throw new HttpError(
            409,
            "EDUCATIONAL_SOURCE_STALE",
            "The educational source is unavailable. Create a fresh plan and choose its source again.",
          );
        }
        const evaluatedAt = now();
        if (
          !(evaluatedAt instanceof Date) ||
          !Number.isFinite(evaluatedAt.getTime())
        ) {
          throw new HttpError(
            500,
            "EDUCATIONAL_CLOCK_INVALID",
            "Educational planning stopped safely because the local clock is unavailable.",
          );
        }
        const snapshot = await educationalSnapshotFor(
          session,
          {
            ...planning,
            source,
          },
          evaluatedAt,
        );
        let revised;
        try {
          revised = reviseEducationalSessionPlan(
            session,
            {
              planId: input.plan_id,
              revision: input.revision,
              planning_amount:
                planning.planningAmount,
              allocations: planning.allocations,
              scenarios: planning.scenarios,
              scenario_acknowledged:
                planning.scenarioAcknowledged,
              snapshot,
            },
            { now: () => new Date(evaluatedAt) },
          );
        } catch (error) {
          throw educationalHttpError(error);
        }
        appendActivity(
          session,
          activityEntry(
            "EDUCATIONAL_PLAN_REVISION",
            revised.current.session_state,
            {
              now: () => new Date(evaluatedAt),
              decision:
                revised.current.plan.decision.outcome,
            },
          ),
        );
        safeJson(
          response,
          200,
          { saved_plan: revised.current },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/education/handoff"
      ) {
        const input = strictFields(
          await readJson(request),
          ["plan_id", "revision", "leg_id", "side"],
          "Educational handoff request",
        );
        requireEducationalIdentity(input, { leg: true });
        let handoff;
        try {
          handoff = createEducationalSessionHandoff(
            session,
            {
              planId: input.plan_id,
              revision: input.revision,
              legId: input.leg_id,
              side: input.side,
            },
            { now },
          );
        } catch (error) {
          throw educationalHttpError(error);
        }
        appendActivity(
          session,
          activityEntry(
            "EDUCATIONAL_HANDOFF",
            handoff.saved_plan.session_state,
            {
              now,
              decision:
                handoff.result.decision.outcome,
            },
          ),
        );
        safeJson(
          response,
          200,
          handoff,
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/advisor/plan"
      ) {
        const input = strictFields(await readJson(request), ["intent"], "Plan request");
        if (
          typeof input.intent !== "string" ||
          !input.intent.trim() ||
          input.intent.length > 8_192
        ) {
          throw new HttpError(
            400,
            "INVALID_INTENT",
            "Describe one Coinbase spot trade in plain English.",
          );
        }
        let plan;
        try {
          plan = await createPlan(input.intent, {
            compiler: "deterministic",
          });
        } catch {
          throw new HttpError(
            422,
            "INTENT_NOT_SAFE_TO_COMPILE",
            "The advisor could not safely turn that request into a closed mandate.",
          );
        }
        rememberPlan(session, plan);
        appendActivity(
          session,
          activityEntry("PLAN", plan.status, { now, plan }),
        );
        safeJson(
          response,
          200,
          { plan: advisorPlanView(plan) },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/advisor/authorize"
      ) {
        const input = strictFields(
          await readJson(request),
          ["plan_id", "mode"],
          "Authorization request",
        );
        if (
          typeof input.plan_id !== "string" ||
          !/^[a-f0-9-]{36}$/.test(input.plan_id)
        ) {
          throw new HttpError(
            400,
            "INVALID_PLAN_ID",
            "Choose the currently displayed mandate.",
          );
        }
        const requestedMode = input.mode ?? "dry_run";
        if (
          !["dry_run", "view_only_preflight"].includes(
            requestedMode,
          )
        ) {
          throw new HttpError(
            400,
            "INVALID_PREFLIGHT_MODE",
            "Choose either a protected dry run or View-only preflight.",
          );
        }
        const stored = session.plans.get(input.plan_id);
        if (!stored) {
          throw new HttpError(
            404,
            "PLAN_NOT_FOUND",
            "This mandate is not available in the current local session.",
          );
        }
        if (
          stored.state !== "AWAITING_USER_CONFIRMATION" ||
          stored.plan.status !== "AWAITING_HUMAN_CONFIRMATION"
        ) {
          throw new HttpError(
            409,
            "PLAN_NOT_AUTHORIZABLE",
            "This mandate is not awaiting confirmation. Create a fresh plan.",
          );
        }
        stored.state =
          requestedMode === "view_only_preflight"
            ? "RUNNING_VIEW_ONLY_PREFLIGHT"
            : "RUNNING_DRY_RUN";
        let result;
        try {
          const common = {
            plan: stored.plan,
            confirmPolicyDigest: stored.plan.policy_digest,
            nonce: randomUUID(),
          };
          if (requestedMode === "dry_run") {
            result = await runPreflight({
              ...common,
              history,
            });
          } else {
            const viewOnlyCommon = {
              ...common,
              // Keep a real Coinbase result inside the active server session.
              // It is appended to redacted session activity only after the
              // provider lease has revalidated, so disconnect/expiry cannot
              // race a durable PASS write.
              history: { enabled: false },
            };
            const provider = credentialProviderFor(session);
            if (provider.status().connected !== true) {
              result = await runPreflight({
                ...viewOnlyCommon,
                viewOnlyRequested: true,
              });
            } else {
              try {
                result =
                  await provider.withVerifiedCredential(
                    async ({
                      attestation,
                      credentials,
                      signal,
                      assertCurrent,
                    }) =>
                      runPreflight({
                        ...viewOnlyCommon,
                        viewOnlyRequested: true,
                        verifiedViewCredential:
                          verifiedCredentialEnvelope({
                            attestation,
                            credentials,
                          }),
                        assertViewCredentialCurrent:
                          assertCurrent,
                        viewAdapterSignal: signal,
                        createViewAdapter:
                          createViewOnlyAdapter,
                      }),
                  );
              } catch (error) {
                result = await runPreflight({
                  ...viewOnlyCommon,
                  viewOnlyRequested: true,
                  viewCredentialError: error,
                });
              }
            }
          }
        } catch {
          stored.state = "STOPPED_SAFE";
          throw new HttpError(
            500,
            "PREFLIGHT_STOPPED_SAFE",
            "The protected check stopped safely. No order was submitted.",
          );
        }
        stored.state = "COMPLETED";
        if (result?.replayed || !result?.record) {
          throw new HttpError(
            500,
            "DRY_RUN_RESULT_UNAVAILABLE",
            "The protected dry-run result is unavailable. No order was submitted.",
          );
        }
        const view = advisorGuardResultView(result.record, {
          liveReadinessEnabled:
            capabilityProfile.features.live_readiness_preview,
          now: now(),
        });
        appendActivity(
          session,
          activityEntry(
            requestedMode === "view_only_preflight"
              ? "VIEW_ONLY_PREFLIGHT"
              : "DRY_RUN",
            "COMPLETED",
            {
            now,
            plan: stored.plan,
            decision: view.decision.outcome,
            receiptDigest: view.receipt?.receipt_digest ?? null,
            },
          ),
        );
        safeJson(
          response,
          200,
          { result: view },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/demo/showcase"
      ) {
        strictFields(
          await readJson(request, { allowEmpty: true }),
          [],
          "Showcase request",
        );
        const showcase = advisorShowcaseView(await runShowcase());
        appendActivity(
          session,
          activityEntry("SHOWCASE", showcase.status, {
            now,
            decision: showcase.attempts.at(-1)?.decision?.outcome ?? null,
            receiptDigest:
              showcase.attempts.at(-1)?.receipt?.receipt_digest ?? null,
          }),
        );
        safeJson(
          response,
          200,
          { showcase },
          cookieHeader,
        );
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/api/demo/review"
      ) {
        strictFields(
          await readJson(request, { allowEmpty: true }),
          [],
          "Review request",
        );
        const review = advisorGuardResultView(
          createReview({ now: now() }),
        );
        appendActivity(
          session,
          activityEntry("REVIEW_FIXTURE", "REVIEW", {
            now,
            decision: review.decision.outcome,
            receiptDigest: review.receipt?.receipt_digest ?? null,
          }),
        );
        safeJson(
          response,
          200,
          { review },
          cookieHeader,
        );
        return;
      }

      if (
        (request.method === "GET" || request.method === "POST") &&
        pathname.startsWith("/api/")
      ) {
        throw new HttpError(
          404,
          "API_ROUTE_NOT_FOUND",
          "That advisor action is not available.",
        );
      }
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    } catch (error) {
      if (!response.headersSent) {
        safeError(response, error, cookieHeader);
      } else {
        response.end();
      }
    } finally {
      activeRequests -= 1;
    }
  };
}

export function createAdvisorServer(options = {}) {
  const sessionStore =
    options.sessionStore ?? new AdvisorSessionStore();
  const server = createServer(
    createAdvisorRequestHandler({ ...options, sessionStore }),
  );
  server.once("close", () => {
    sessionStore.clear("SERVER_STOPPED");
  });
  return server;
}

export async function listenAdvisorServer({
  host = DEFAULT_ADVISOR_HOST,
  port = 0,
  sessionStore = new AdvisorSessionStore(),
  ...options
} = {}) {
  if (host !== DEFAULT_ADVISOR_HOST) {
    throw new Error("Delta Coinbase Advisor must bind to 127.0.0.1");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Advisor port must be an integer from 0 through 65535");
  }
  const server = createAdvisorServer({ ...options, sessionStore });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("Advisor server did not bind a TCP loopback address");
  }
  return {
    server,
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
