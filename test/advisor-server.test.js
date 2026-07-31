import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listenAdvisorServer } from "../src/advisor/server.js";
import { runGuardPreflight } from "../src/preflight.js";

const COMPLETE_INTENT =
  "Using held USDC, buy up to 3,000 USDC of ETH on ETH-USDC once with a price-bounded IOC limit order and allow partial fills. Only if Coinbase's fresh best ask is at or below 3,000 USDC. Do not pay more than 35 bps above Coinbase's fresh best ask, more than 15 USDC in fees, or more than 3,015 USDC total. The authorization expires 10 minutes after I confirm it.";

function httpRequest(
  baseUrl,
  {
    pathname = "/",
    method = "GET",
    headers = {},
    body = null,
  } = {},
) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            json: () => JSON.parse(text),
          });
        });
      },
    );
    request.on("error", reject);
    if (body != null) request.write(body);
    request.end();
  });
}

function cookieFrom(response) {
  const header = response.headers["set-cookie"];
  assert.ok(Array.isArray(header) && header.length === 1);
  return header[0].split(";", 1)[0];
}

async function openSession(baseUrl) {
  const response = await httpRequest(baseUrl, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: sameOriginHeaders(baseUrl),
    body: JSON.stringify({ intent: "Buy ETH" }),
  });
  assert.equal(response.status, 200);
  return cookieFrom(response);
}

function sameOriginHeaders(url, cookie = null) {
  const headers = {
    "Content-Type": "application/json",
    Origin: url,
    "Sec-Fetch-Site": "same-origin",
    "X-Delta-Advisor": "1",
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function temporaryHistory(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delta-advisor-test-history-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function advisor(t, options = {}) {
  const running = await listenAdvisorServer(options);
  t.after(() => running.close());
  assert.equal(running.host, "127.0.0.1");
  assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  return running;
}

function assertLockedBoundary(value) {
  assert.equal(value.create_available, false);
  assert.equal(value.order_submitted, false);
  assert.equal(value.money_moved, false);
}

test("loopback status is truthful, session-only, and protected by browser headers", async (t) => {
  const running = await advisor(t);
  const response = await httpRequest(running.url, {
    pathname: "/api/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(
    response.headers["content-security-policy"],
    /default-src 'self'/,
  );
  assert.match(
    response.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.match(response.headers["permissions-policy"], /payment=\(\)/);

  assert.equal(response.headers["set-cookie"], undefined);

  const status = response.json();
  assert.equal(status.ready, true);
  assert.equal(status.session.storage, "SERVER_MEMORY_ONLY");
  assert.equal(status.session.created, false);
  assert.equal(status.session.idle_expires_after_seconds, 900);
  assert.equal(status.session.absolute_expires_after_seconds, 3600);
  assert.equal(status.capabilities.credential_free_dry_run, true);
  assert.equal(status.capabilities.view_only_connection, true);
  assert.equal(status.capabilities.conditional_plan_simulation, false);
  assert.equal(status.capabilities.conditional_plan_monitoring, false);
  assert.equal(status.capabilities.production_delta, false);
  assert.equal(status.capabilities.live_create, false);
  assert.equal(status.execution.enabled, false);
  assert.equal(status.execution.order_submitted, false);
  assert.equal(status.execution.money_moved, false);
  assert.match(status.boundary, /No credentials/i);
  assert.match(status.boundary, /no .*Create/i);
  assert.match(status.boundary, /no .*order/i);
});

test("static UI is same-origin, non-cacheable, and HEAD-safe", async (t) => {
  const running = await advisor(t);
  const page = await httpRequest(running.url);
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /^text\/html/);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.match(page.text, /Delta Guard/);
  assert.match(page.text, /No order can be sent/i);

  const head = await httpRequest(running.url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.text, "");
  assert.ok(Number(head.headers["content-length"]) > 0);
});

test("advisor asks for missing material constraints without authorizing a plan", async (t) => {
  const running = await advisor(t);
  const cookie = await openSession(running.url);
  const response = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: sameOriginHeaders(running.url, cookie),
    body: JSON.stringify({ intent: "Buy ETH" }),
  });

  assert.equal(response.status, 200);
  const { plan } = response.json();
  assert.equal(plan.status, "NEEDS_CLARIFICATION");
  assert.equal(plan.mandate, null);
  assert.equal(plan.authorization.required, false);
  assert.equal(plan.authorization.state, "NOT_READY_FOR_CONFIRMATION");
  assert.ok(plan.clarification.length >= 2);
  assertLockedBoundary(plan.boundary);
  assert.doesNotMatch(
    response.text,
    /policy_digest|source_intent|runtime\/plans|privateKey/,
  );
});

test("one explicit authorization runs a real credential-free dry run and cannot be replayed", async (t) => {
  const directory = await temporaryHistory(t);
  const running = await advisor(t, { history: { directory } });
  const cookie = await openSession(running.url);
  const headers = sameOriginHeaders(running.url, cookie);

  const planned = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers,
    body: JSON.stringify({ intent: COMPLETE_INTENT }),
  });
  assert.equal(planned.status, 200);
  const plan = planned.json().plan;
  assert.equal(plan.status, "AWAITING_HUMAN_CONFIRMATION");
  assert.equal(plan.authorization.required, true);
  assert.equal(
    plan.authorization.state,
    "AWAITING_USER_CONFIRMATION",
  );
  assert.equal(plan.mandate.product_id, "ETH-USDC");
  assert.equal(plan.mandate.side, "BUY");
  assertLockedBoundary(plan.boundary);
  assert.doesNotMatch(planned.text, /policy_digest|source_intent|plan_path/);

  const authorized = await httpRequest(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers,
    body: JSON.stringify({ plan_id: plan.plan_id }),
  });
  assert.equal(authorized.status, 200);
  const { result } = authorized.json();
  assert.equal(result.mode, "dry_run");
  assert.equal(result.source, "SIMULATED_FIXTURE_NOT_COINBASE");
  assert.equal(result.decision.outcome, "PASS");
  assert.equal(result.proposal.product_id, "ETH-USDC");
  assert.equal(result.proposal.side, "BUY");
  assert.equal(result.receipt.verified, true);
  assert.match(result.receipt.receipt_digest, /^[a-f0-9]{64}$/);
  assert.equal(result.delta.production_delta_contacted, false);
  assertLockedBoundary(result.boundary);
  assert.match(result.boundary.statement, /Dry run only/i);
  assert.match(result.boundary.statement, /No Coinbase order/i);
  assert.doesNotMatch(
    authorized.text,
    /privateKey|Authorization|Bearer |organizations\/.+\/apiKeys\//,
  );

  const repeated = await httpRequest(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers,
    body: JSON.stringify({ plan_id: plan.plan_id }),
  });
  assert.equal(repeated.status, 409);
  assert.equal(
    repeated.json().error.code,
    "PLAN_NOT_AUTHORIZABLE",
  );
  assertLockedBoundary(repeated.json().boundary);
});

test("server view downgrades a claimed PASS when its exact receipt does not verify", async (t) => {
  const directory = await temporaryHistory(t);
  const running = await advisor(t, {
    history: { directory },
    async runPreflight(input) {
      const result = await runGuardPreflight(input);
      const record = structuredClone(result.record);
      record.guard_receipt.receipt_digest = "0".repeat(64);
      return { ...result, record };
    },
  });
  const cookie = await openSession(running.url);
  const headers = sameOriginHeaders(running.url, cookie);
  const planned = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers,
    body: JSON.stringify({ intent: COMPLETE_INTENT }),
  });
  const plan = planned.json().plan;

  const authorized = await httpRequest(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers,
    body: JSON.stringify({ plan_id: plan.plan_id }),
  });

  assert.equal(authorized.status, 200);
  const { result } = authorized.json();
  assert.equal(result.status, "REVIEW");
  assert.equal(result.decision.outcome, "REVIEW");
  assert.equal(
    result.decision.code,
    "ADVISOR_RECEIPT_UNVERIFIED",
  );
  assert.equal(result.delta.decision, "REVIEW");
  assert.equal(result.delta.verifier_confirmed, false);
  assert.equal(result.receipt.verified, false);
  assertLockedBoundary(result.boundary);
});

test("showcase and safe-review endpoints expose honest simulated outcomes", async (t) => {
  const running = await advisor(t);
  const cookie = await openSession(running.url);
  const headers = sameOriginHeaders(running.url, cookie);

  const showcaseResponse = await httpRequest(running.url, {
    pathname: "/api/demo/showcase",
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(showcaseResponse.status, 200);
  const { showcase } = showcaseResponse.json();
  assert.equal(showcase.source, "SIMULATED_FIXTURE_NOT_COINBASE");
  assert.ok(showcase.attempts.length >= 2);
  assert.equal(showcase.attempts[0].decision.outcome, "BLOCK");
  assert.equal(showcase.attempts.at(-1).decision.outcome, "PASS");
  assert.equal(showcase.authorization.live_trade_authorized, false);
  assert.equal(showcase.controller.durable_one_time_grant_issued, false);
  assert.equal(showcase.controller.external_executor_invoked, false);
  assertLockedBoundary(showcase.boundary);

  const reviewResponse = await httpRequest(running.url, {
    pathname: "/api/demo/review",
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(reviewResponse.status, 200);
  const { review } = reviewResponse.json();
  assert.equal(review.source, "SIMULATED_FIXTURE_NOT_COINBASE");
  assert.equal(review.decision.outcome, "REVIEW");
  assert.match(review.decision.reason, /cannot be verified/i);
  assert.match(review.decision.recovery, /No order was submitted/i);
  assert.equal(review.receipt.verified, true);
  assertLockedBoundary(review.boundary);
});

test("there is no Create, execution, order, credential, or generic proxy API", async (t) => {
  const running = await advisor(t);
  const cookie = await openSession(running.url);
  const headers = sameOriginHeaders(running.url, cookie);
  const forbiddenRoutes = [
    "/api/orders",
    "/api/orders/preview",
    "/api/execute",
    "/api/create",
    "/api/coinbase",
    "/api/coinbase/orders",
    "/api/proxy",
    "/api/credentials",
    "/api/connect",
  ];

  for (const pathname of forbiddenRoutes) {
    const response = await httpRequest(running.url, {
      pathname,
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(response.status, 404, pathname);
    assert.equal(response.json().error.code, "API_ROUTE_NOT_FOUND");
    assertLockedBoundary(response.json().boundary);
  }
});

test("mutations enforce loopback Host, same Origin, JSON, strict fields, and body limits", async (t) => {
  const running = await advisor(t);

  const hostileHost = await httpRequest(running.url, {
    pathname: "/api/status",
    headers: { Host: "evil.example" },
  });
  assert.equal(hostileHost.status, 400);
  assert.equal(hostileHost.json().error.code, "LOOPBACK_HOST_REQUIRED");
  assertLockedBoundary(hostileHost.json().boundary);

  const cookie = await openSession(running.url);
  const wrongOrigin = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: {
      ...sameOriginHeaders("https://evil.example", cookie),
      Host: new URL(running.url).host,
    },
    body: JSON.stringify({ intent: COMPLETE_INTENT }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.json().error.code, "SAME_ORIGIN_REQUIRED");

  const wrongType = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: {
      Origin: running.url,
      Cookie: cookie,
      "Content-Type": "text/plain",
      "X-Delta-Advisor": "1",
    },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.json().error.code, "JSON_REQUIRED");

  const unknownField = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: sameOriginHeaders(running.url, cookie),
    body: JSON.stringify({
      intent: COMPLETE_INTENT,
      endpoint: "https://evil.example",
    }),
  });
  assert.equal(unknownField.status, 400);
  assert.equal(unknownField.json().error.code, "INVALID_REQUEST");
  assert.doesNotMatch(unknownField.text, /evil\.example/);

  const oversized = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: sameOriginHeaders(running.url, cookie),
    body: JSON.stringify({ intent: "x".repeat(17 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json().error.code, "REQUEST_TOO_LARGE");
  assert.equal(oversized.headers["cache-control"], "no-store");
  assert.match(
    oversized.headers["content-security-policy"],
    /default-src 'self'/,
  );
});

test("mutation header is mandatory and fixed", async (t) => {
  const running = await advisor(t);
  const cookie = await openSession(running.url);
  const response = await httpRequest(running.url, {
    pathname: "/api/demo/review",
    method: "POST",
    headers: {
      Origin: running.url,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.equal(
    response.json().error.code,
    "ADVISOR_HEADER_REQUIRED",
  );
  assertLockedBoundary(response.json().boundary);
});

test("plans remain scoped to their in-memory browser session", async (t) => {
  const running = await advisor(t);
  const firstCookie = await openSession(running.url);
  const planned = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: sameOriginHeaders(running.url, firstCookie),
    body: JSON.stringify({ intent: COMPLETE_INTENT }),
  });
  const planId = planned.json().plan.plan_id;

  const secondCookie = await openSession(running.url);
  assert.notEqual(secondCookie, firstCookie);
  const foreignAuthorization = await httpRequest(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers: sameOriginHeaders(running.url, secondCookie),
    body: JSON.stringify({ plan_id: planId }),
  });
  assert.equal(foreignAuthorization.status, 404);
  assert.equal(
    foreignAuthorization.json().error.code,
    "PLAN_NOT_FOUND",
  );
  assertLockedBoundary(foreignAuthorization.json().boundary);
});

test("server refuses non-loopback binding before opening a listener", async () => {
  await assert.rejects(
    listenAdvisorServer({ host: "0.0.0.0" }),
    /must bind to 127\.0\.0\.1/,
  );
  await assert.rejects(
    listenAdvisorServer({ host: "::1" }),
    /must bind to 127\.0\.0\.1/,
  );
});

test("static file serving fails closed on traversal, dotfiles, and methods", async (t) => {
  const running = await advisor(t);
  const probes = [
    "/../package.json",
    "/%2e%2e/package.json",
    "/..%2fpackage.json",
    "/%2e%2e%2fpackage.json",
    "/.git/config",
    "/%2egit/config",
    "/missing.txt",
  ];
  for (const pathname of probes) {
    const response = await httpRequest(running.url, { pathname });
    assert.ok(
      [400, 404].includes(response.status),
      `${pathname} returned ${response.status}`,
    );
    assert.doesNotMatch(response.text, /"name":\s*"delta-coinbase-guard"/);
    assert.equal(response.headers["cache-control"], "no-store");
  }

  const mutation = await httpRequest(running.url, {
    method: "POST",
    headers: {
      Origin: running.url,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(mutation.status, 405);
  assert.equal(mutation.json().error.code, "METHOD_NOT_ALLOWED");
  assertLockedBoundary(mutation.json().boundary);
});

test("static serving rejects an intermediate symlink escape", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delta-advisor-static-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const webRoot = path.join(directory, "web");
  const outside = path.join(directory, "outside");
  await mkdir(webRoot);
  await mkdir(outside);
  await writeFile(path.join(webRoot, "index.html"), "safe");
  await writeFile(path.join(outside, "secret.txt"), "private-canary");
  await symlink(outside, path.join(webRoot, "assets"));

  const running = await advisor(t, { webRoot });
  const response = await httpRequest(running.url, {
    pathname: "/assets/secret.txt",
  });
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.text, /private-canary/);
});

test("malformed, compressed, cross-site, and method-confused requests stop safely", async (t) => {
  const running = await advisor(t);
  const cookie = await openSession(running.url);

  const malformed = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: sameOriginHeaders(running.url, cookie),
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json().error.code, "INVALID_JSON");
  assertLockedBoundary(malformed.json().boundary);

  const compressed = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: {
      ...sameOriginHeaders(running.url, cookie),
      "Content-Encoding": "gzip",
    },
    body: "{}",
  });
  assert.equal(compressed.status, 415);
  assert.equal(
    compressed.json().error.code,
    "UNSUPPORTED_CONTENT_ENCODING",
  );

  const crossSite = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers: {
      ...sameOriginHeaders(running.url, cookie),
      "Sec-Fetch-Site": "cross-site",
    },
    body: JSON.stringify({ intent: COMPLETE_INTENT }),
  });
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.json().error.code, "SAME_ORIGIN_REQUIRED");

  const missingOrigin = await httpRequest(running.url, {
    pathname: "/api/demo/review",
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.json().error.code, "SAME_ORIGIN_REQUIRED");

  const confused = await httpRequest(running.url, {
    pathname: "/api/advisor/authorize",
    method: "GET",
    headers: { Cookie: cookie },
  });
  assert.equal(confused.status, 404);
  assert.equal(confused.json().error.code, "API_ROUTE_NOT_FOUND");
  assertLockedBoundary(confused.json().boundary);
});

test("cross-site API traffic is rejected before opening a session", async (t) => {
  let opens = 0;
  const sessionStore = {
    idleTtlSeconds: 900,
    absoluteTtlSeconds: 3600,
    ttlSeconds: 900,
    open() {
      opens += 1;
      throw new Error("session store must not be reached");
    },
    clear() {},
  };
  const running = await advisor(t, { sessionStore });
  const response = await httpRequest(running.url, {
    pathname: "/api/status",
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.json().error.code, "SAME_ORIGIN_REQUIRED");
  assert.equal(opens, 0);
});

test("bounded concurrency fails fast without opening another session", async (t) => {
  let releaseHistory;
  let historyStarted;
  const started = new Promise((resolve) => {
    historyStarted = resolve;
  });
  const running = await advisor(t, {
    maxConcurrentRequests: 1,
    readGuardHistory: async () => {
      historyStarted();
      await new Promise((resolve) => {
        releaseHistory = resolve;
      });
      return [];
    },
  });
  const first = httpRequest(running.url, {
    pathname: "/api/activity",
  });
  await started;
  const second = await httpRequest(running.url, {
    pathname: "/api/status",
  });
  assert.equal(second.status, 503);
  assert.equal(second.json().error.code, "ADVISOR_BUSY");
  assertLockedBoundary(second.json().boundary);
  releaseHistory();
  assert.equal((await first).status, 200);
});

test("activity is redacted, local, and explicit about the locked boundary", async (t) => {
  const directory = await temporaryHistory(t);
  const running = await advisor(t, { history: { directory } });
  const cookie = await openSession(running.url);
  const headers = sameOriginHeaders(running.url, cookie);

  const planned = await httpRequest(running.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    headers,
    body: JSON.stringify({ intent: COMPLETE_INTENT }),
  });
  const planId = planned.json().plan.plan_id;
  const checked = await httpRequest(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    headers,
    body: JSON.stringify({ plan_id: planId }),
  });
  assert.equal(checked.status, 200);

  const response = await httpRequest(running.url, {
    pathname: "/api/activity",
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 200);
  const activity = response.json();
  assert.equal(activity.schema_version, "delta.coinbase.advisor_activity.v1");
  assert.ok(activity.session_activity.length >= 2);
  assert.equal(activity.session_activity[0].kind, "DRY_RUN");
  assert.equal(activity.session_activity[0].decision, "PASS");
  assert.ok(activity.guard_history.length >= 1);
  assert.equal(activity.guard_history[0].mode, "dry_run");
  assert.equal(activity.guard_history[0].outcome, "PASS");
  assertLockedBoundary(activity.boundary);
  assert.equal(activity.boundary.local_only, true);
  assert.doesNotMatch(
    response.text,
    /source_intent|account_uuid|account_id|authorization|bearer|private[_-]?key|organizations\/.+\/apiKeys\//i,
  );
});
