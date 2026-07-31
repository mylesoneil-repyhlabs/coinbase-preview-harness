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
import { createExecutionPlan } from "../plan.js";
import { runGuardPreflight } from "../preflight.js";
import { productionExecutionStatus } from "../integration/production-composition.js";
import {
  advisorStatusCapabilities,
  loadAdvisorCapabilities,
} from "./capabilities.js";
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
const ADVISOR_POST_ROUTES = new Set([
  "/api/advisor/plan",
  "/api/advisor/authorize",
  "/api/connection/connect",
  "/api/connection/disconnect",
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
    product_id: plan?.policy?.product_id ?? null,
    side: plan?.policy?.side ?? null,
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

      let session = existingSession;
      if (session != null) {
        session = sessionStore.open(suppliedToken).session;
      } else if (
        pathname === "/api/advisor/plan" ||
        pathname === "/api/connection/connect"
      ) {
        session = sessionStore.open(null).session;
      } else {
        session = {
          plans: new Map(),
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
        const view = advisorGuardResultView(result.record);
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
