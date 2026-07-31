import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadAdvisorCapabilities } from "../src/advisor/capabilities.js";
import { listenAdvisorServer } from "../src/advisor/server.js";
import { AdvisorSessionStore } from "../src/advisor/session-store.js";

function request(
  baseUrl,
  {
    pathname,
    method = "GET",
    origin = baseUrl,
    capability = null,
    cookie = null,
    mode = null,
    body = null,
  },
) {
  const headers = {
    "Sec-Fetch-Site": "same-origin",
    "X-Delta-Advisor": "1",
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    headers.Origin = origin;
  }
  if (capability) {
    headers["X-Delta-Advisor-Session"] = capability;
  }
  if (mode) headers["X-Delta-Advisor-Mode"] = mode;
  if (cookie) headers.Cookie = cookie;
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      new URL(pathname, baseUrl),
      { method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            json: JSON.parse(text),
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(
      body == null ? undefined : JSON.stringify(body),
    );
  });
}

async function runningAdvisor(t, options = {}) {
  const running = await listenAdvisorServer(options);
  t.after(() => running.close());
  return running;
}

async function bootstrap(baseUrl) {
  const response = await request(baseUrl, {
    pathname: "/api/session",
    method: "POST",
    body: {},
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(
    response.json.session.storage,
    "PAGE_MEMORY_ONLY",
  );
  assert.match(
    response.json.session.capability,
    /^[A-Za-z0-9_-]{43}$/,
  );
  assert.doesNotMatch(
    response.text,
    /delta_advisor_session|HttpOnly|SameSite/i,
  );
  return response.json.session.capability;
}

test("public status is capability-free and allocates no session or credential provider", async (t) => {
  let sessionOpens = 0;
  let providers = 0;
  const sessionStore = {
    idleTtlSeconds: 900,
    absoluteTtlSeconds: 3600,
    ttlSeconds: 900,
    open() {
      sessionOpens += 1;
      throw new Error("public status must not allocate");
    },
    peek() {
      throw new Error("public status must not inspect sessions");
    },
    clear() {},
  };
  const running = await runningAdvisor(t, {
    sessionStore,
    createViewCredentialProvider() {
      providers += 1;
      throw new Error("public status must not create provider");
    },
  });

  const response = await request(running.url, {
    pathname: "/api/status",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(sessionOpens, 0);
  assert.equal(providers, 0);
});

test("session bootstrap is the only implicit allocator and returns page-memory authority without a cookie", async (t) => {
  let providers = 0;
  const running = await runningAdvisor(t, {
    createViewCredentialProvider() {
      providers += 1;
      throw new Error(
        "bootstrap must not create a credential provider",
      );
    },
  });
  const capability = await bootstrap(running.url);
  assert.ok(capability.length >= 32);
  assert.equal(providers, 0);

  const status = await request(running.url, {
    pathname: "/api/status",
    capability,
  });
  assert.equal(status.status, 200);
  assert.equal(status.headers["set-cookie"], undefined);
  assert.equal(providers, 0);
});

test("capability expiry is resolved atomically without allocating or reaching a provider", async (t) => {
  const start = Date.parse("2026-07-31T12:00:00.000Z");
  let current = start;
  const backingStore = new AdvisorSessionStore({
    idleTtlMs: 60_000,
    absoluteTtlMs: 180_000,
    now: () => new Date(current),
  });
  const openCandidates = [];
  const touches = [];
  const sessionStore = {
    get idleTtlSeconds() {
      return backingStore.idleTtlSeconds;
    },
    get absoluteTtlSeconds() {
      return backingStore.absoluteTtlSeconds;
    },
    open(candidate = null) {
      openCandidates.push(candidate);
      return backingStore.open(candidate);
    },
    peek(candidate = null) {
      const existing = backingStore.peek(candidate);
      current += 1;
      return existing;
    },
    touch(candidate = null) {
      touches.push(candidate);
      current += 1;
      return backingStore.touch(candidate);
    },
    clear(reason) {
      backingStore.clear(reason);
    },
  };
  let providers = 0;
  const running = await runningAdvisor(t, {
    sessionStore,
    createViewCredentialProvider() {
      providers += 1;
      throw new Error(
        "an expired capability must fail before provider creation",
      );
    },
  });
  const capability = await bootstrap(running.url);
  current = start + 59_999;

  const response = await request(running.url, {
    pathname: "/api/connection/connect",
    method: "POST",
    capability,
    body: {},
  });

  assert.equal(response.status, 401);
  assert.equal(
    response.json.error.code,
    "SESSION_CAPABILITY_EXPIRED",
  );
  assert.equal(response.headers["set-cookie"], undefined);
  assert.deepEqual(openCandidates, [null]);
  assert.deepEqual(touches, [capability]);
  assert.equal(providers, 0);
});

test("cookie authority and missing capability both fail before state or provider access", async (t) => {
  let providers = 0;
  const running = await runningAdvisor(t, {
    createViewCredentialProvider() {
      providers += 1;
      throw new Error(
        "unauthorized request must not create provider",
      );
    },
  });
  for (const options of [
    {},
    {
      cookie:
        "delta_advisor_session=legacy-cookie-must-not-authorize",
    },
  ]) {
    const response = await request(running.url, {
      pathname: "/api/connection",
      ...options,
    });
    assert.equal(response.status, 401);
    assert.equal(
      response.json.error.code,
      "SESSION_CAPABILITY_REQUIRED",
    );
    assert.equal(response.headers["set-cookie"], undefined);
  }
  assert.equal(providers, 0);
});

test("capability is handler-local and exact loopback origin checks reject cross-server or port reuse", async (t) => {
  const first = await runningAdvisor(t);
  const second = await runningAdvisor(t);
  const capability = await bootstrap(first.url);

  const reused = await request(second.url, {
    pathname: "/api/activity",
    capability,
  });
  assert.equal(reused.status, 401);
  assert.equal(
    reused.json.error.code,
    "SESSION_CAPABILITY_EXPIRED",
  );

  const crossPort = await request(second.url, {
    pathname: "/api/advisor/plan",
    method: "POST",
    origin: first.url,
    capability,
    body: { intent: "Buy ETH" },
  });
  assert.equal(crossPort.status, 403);
  assert.equal(
    crossPort.json.error.code,
    "SAME_ORIGIN_REQUIRED",
  );
  assert.equal(crossPort.headers["set-cookie"], undefined);
});

test("disabled Create and monitoring routes stay unavailable before session or provider resolution", async (t) => {
  let providers = 0;
  const running = await runningAdvisor(t, {
    createViewCredentialProvider() {
      providers += 1;
      throw new Error(
        "disabled route must not create provider",
      );
    },
  });
  for (const pathname of [
    "/api/orders",
    "/api/execute",
    "/api/create",
    "/api/conditional/monitor",
  ]) {
    const response = await request(running.url, {
      pathname,
      method: "POST",
      body: {},
    });
    assert.equal(response.status, 404, pathname);
    assert.equal(
      response.json.error.code,
      "API_ROUTE_NOT_FOUND",
      pathname,
    );
    assert.equal(response.headers["set-cookie"], undefined);
  }
  assert.equal(providers, 0);
});

test("disabled View-only mode fails before session or provider resolution", async (t) => {
  let providers = 0;
  const capabilityProfile = structuredClone(
    loadAdvisorCapabilities(),
  );
  capabilityProfile.modes.view_only_preflight.enabled = false;
  const running = await runningAdvisor(t, {
    capabilityProfile,
    createViewCredentialProvider() {
      providers += 1;
      throw new Error(
        "disabled mode must not create provider",
      );
    },
  });
  const response = await request(running.url, {
    pathname: "/api/advisor/authorize",
    method: "POST",
    mode: "view_only_preflight",
    body: {
      plan_id: "00000000-0000-0000-0000-000000000000",
      mode: "view_only_preflight",
    },
  });
  assert.equal(response.status, 404);
  assert.equal(
    response.json.error.code,
    "ADVISOR_FEATURE_DISABLED",
  );
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(providers, 0);
});

test("operator-disabled View-only, conditional, and education routes fail before body, session, or provider work", async (t) => {
  const cases = [
    {
      label: "View-only connection",
      disable(profile) {
        profile.modes.view_only_preflight.enabled = false;
      },
      pathname: "/api/connection/connect",
    },
    {
      label: "conditional simulation",
      disable(profile) {
        profile.features.conditional_plan_simulation = false;
      },
      pathname: "/api/conditional/plan",
    },
    {
      label: "educational research",
      disable(profile) {
        profile.features.educational_research = false;
      },
      pathname: "/api/education/plan",
    },
    {
      label: "portfolio planning",
      disable(profile) {
        profile.features.portfolio_planning = false;
      },
      pathname: "/api/education/plan",
    },
  ];
  for (const item of cases) {
    await t.test(item.label, async (child) => {
      let storeTouches = 0;
      let providers = 0;
      const capabilityProfile = structuredClone(
        loadAdvisorCapabilities(),
      );
      item.disable(capabilityProfile);
      const running = await runningAdvisor(child, {
        capabilityProfile,
        sessionStore: {
          idleTtlSeconds: 900,
          absoluteTtlSeconds: 3600,
          open() {
            storeTouches += 1;
            throw new Error(
              "disabled route must not open a session",
            );
          },
          peek() {
            storeTouches += 1;
            throw new Error(
              "disabled route must not inspect a session",
            );
          },
          clear() {},
        },
        createViewCredentialProvider() {
          providers += 1;
          throw new Error(
            "disabled route must not create a provider",
          );
        },
      });
      const response = await request(running.url, {
        pathname: item.pathname,
        method: "POST",
        body: {
          untrusted_oversized_field:
            "x".repeat(17 * 1024),
        },
      });
      assert.equal(response.status, 404);
      assert.equal(
        response.json.error.code,
        "ADVISOR_FEATURE_DISABLED",
      );
      assert.equal(
        response.headers["set-cookie"],
        undefined,
      );
      assert.equal(storeTouches, 0);
      assert.equal(providers, 0);
    });
  }
});
