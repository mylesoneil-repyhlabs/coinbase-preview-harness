import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/evidence.js";
import { reviewError } from "../src/guard-errors.js";
import {
  createInMemoryViewCredentialProvider,
} from "../src/advisor/view-only-credential-provider.js";

const START = Date.parse("2026-07-30T16:00:00.000Z");
const SECRET_CANARY = [
  `-----BEGIN ${["EC", "PRIVATE", "KEY"].join(" ")}-----`,
  "PRIVATE-CANARY",
  `-----END ${["EC", "PRIVATE", "KEY"].join(" ")}-----`,
].join("\n");

function material(name = "one") {
  return {
    keyId: `organizations/test/apiKeys/${name}`,
    privateKey: `${SECRET_CANARY}-${name}`,
  };
}

function verified(input, at = new Date(START)) {
  const result = {
    attestation: {
      schema: "delta.coinbase.view_permission_attestation.v2",
      verified_at: at.toISOString(),
      environment: "coinbase-read-preview",
      jwt_profile: "CDP_URIS_V1",
      can_view: true,
      can_trade: false,
      can_transfer: false,
      can_receive: false,
      can_receive_reported: true,
      key_fingerprint: digest(input.keyId),
      portfolio_fingerprint: digest(
        `portfolio:${input.keyId}`,
      ),
    },
  };
  Object.defineProperty(result, "credentials", {
    enumerable: false,
    value: Object.freeze({ ...input }),
  });
  return Object.freeze(result);
}

function fakeClock() {
  let currentMs = START;
  let nextId = 1;
  const timers = new Map();
  const clock = {
    now: () => new Date(currentMs),
    schedule(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, {
        callback,
        at: currentMs + delay,
        unref() {},
      });
      return id;
    },
    cancelSchedule(id) {
      timers.delete(id);
    },
    set(milliseconds) {
      currentMs = milliseconds;
    },
    advance(milliseconds) {
      currentMs += milliseconds;
      let ran;
      do {
        ran = false;
        for (const [id, timer] of timers) {
          if (timer.at <= currentMs) {
            timers.delete(id);
            timer.callback();
            ran = true;
            break;
          }
        }
      } while (ran);
    },
  };
  return clock;
}

function providerOptions(overrides = {}) {
  const clock = overrides.clock ?? fakeClock();
  return {
    clock,
    options: {
      fetchImpl: async () => {
        throw new Error("fake verifier must own network access");
      },
      verifyCredential: async (input) =>
        verified(input, clock.now()),
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
      idleTtlMs: 1_000,
      absoluteTtlMs: 3_000,
      ...overrides.options,
    },
  };
}

test("connection status is redacted, process-memory-only, and erasable", async () => {
  const { options } = providerOptions();
  const provider =
    createInMemoryViewCredentialProvider(options);
  const connected = await provider.connect(material());

  assert.equal(connected.connected, true);
  assert.equal(
    connected.storage,
    "server_process_memory_only",
  );
  assert.equal(connected.permissions.can_view, true);
  assert.equal(connected.permissions.can_trade, false);
  assert.equal(connected.create_available, false);
  assert.equal(Object.hasOwn(connected, "scope"), false);
  assert.doesNotMatch(
    JSON.stringify(connected),
    /PRIVATE-CANARY|organizations\/|fingerprint/i,
  );

  const disconnected = provider.disconnect();
  assert.equal(disconnected.connected, false);
  assert.equal(provider.status().connected, false);
});

test("every borrowed preflight rechecks permission and exposes a currentness assertion", async () => {
  const clock = fakeClock();
  let checks = 0;
  const provider = createInMemoryViewCredentialProvider({
    ...providerOptions({ clock }).options,
    verifyCredential: async (input) => {
      checks += 1;
      return verified(input, clock.now());
    },
  });
  await provider.connect(material());
  const value = await provider.withVerifiedCredential(
    async ({ assertCurrent, signal, connection }) => {
      assert.equal(assertCurrent(), true);
      assert.equal(signal.aborted, false);
      assert.equal(connection.connected, true);
      return "checked";
    },
  );

  assert.equal(value, "checked");
  assert.equal(checks, 2);
  assert.equal(provider.status().connected, true);
});

test("two advisor sessions cannot observe or borrow each other's credential", async () => {
  const first =
    createInMemoryViewCredentialProvider(
      providerOptions().options,
    );
  const second =
    createInMemoryViewCredentialProvider(
      providerOptions().options,
    );
  await first.connect(material("first"));

  assert.equal(first.status().connected, true);
  assert.equal(second.status().connected, false);
  await assert.rejects(
    () => second.withVerifiedCredential(async () => "no"),
    (error) =>
      error.code === "VIEW_ONLY_SESSION_NOT_CONNECTED",
  );
});

test("a later concurrent connect wins and an older verifier cannot resurrect", async () => {
  const pending = new Map();
  const { options } = providerOptions({
    options: {
      verifyCredential: (input) =>
        new Promise((resolve) => {
          pending.set(input.keyId, () =>
            resolve(verified(input)),
          );
        }),
    },
  });
  const provider =
    createInMemoryViewCredentialProvider(options);
  const older = provider.connect(material("older"));
  const newer = provider.connect(material("newer"));
  pending.get(material("newer").keyId)();
  await newer;
  pending.get(material("older").keyId)();
  await assert.rejects(
    older,
    (error) => error.code === "VIEW_ONLY_SESSION_SUPERSEDED",
  );
  assert.equal(provider.status().connected, true);
});

test("disconnect during an in-flight operation aborts the lease and prevents a result", async () => {
  const provider =
    createInMemoryViewCredentialProvider(
      providerOptions().options,
    );
  await provider.connect(material());
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const operation = provider.withVerifiedCredential(
    async ({ signal, assertCurrent }) => {
      assert.equal(assertCurrent(), true);
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      assert.equal(signal.aborted, true);
      return "must-not-escape";
    },
  );
  await started;
  provider.disconnect();
  release();
  await assert.rejects(operation, (error) =>
    [
      "VIEW_ONLY_SESSION_NOT_CONNECTED",
      "VIEW_ONLY_SESSION_SUPERSEDED",
    ].includes(error.code),
  );
  assert.equal(provider.status().connected, false);
});

test("idle and absolute timers expire without status extending the session", async () => {
  const clock = fakeClock();
  const provider =
    createInMemoryViewCredentialProvider(
      providerOptions({ clock }).options,
    );
  await provider.connect(material());
  clock.advance(999);
  assert.equal(provider.status().connected, true);
  clock.advance(1);
  assert.equal(provider.status().connected, false);

  await provider.connect(material("absolute"));
  clock.advance(900);
  await provider.withVerifiedCredential(async () => true);
  clock.advance(900);
  await provider.withVerifiedCredential(async () => true);
  clock.advance(1_200);
  assert.equal(provider.status().connected, false);
});

test("clock rollback fails closed and clears the local connection", async () => {
  const clock = fakeClock();
  const provider =
    createInMemoryViewCredentialProvider(
      providerOptions({ clock }).options,
    );
  await provider.connect(material());
  clock.set(START - 1);
  assert.throws(
    () => provider.status(),
    (error) =>
      error.code === "VIEW_ONLY_SESSION_CLOCK_INVALID",
  );
  clock.set(START + 1);
  assert.equal(provider.status().connected, false);
});

test("parallel preflights are bounded while disconnect remains immediate", async () => {
  const provider =
    createInMemoryViewCredentialProvider(
      providerOptions().options,
    );
  await provider.connect(material());
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = provider.withVerifiedCredential(async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return "first";
  });
  await started;
  await assert.rejects(
    () => provider.withVerifiedCredential(async () => "second"),
    (error) => error.code === "VIEW_ONLY_SESSION_BUSY",
  );
  provider.disconnect();
  release();
  await assert.rejects(first);
});

test("hard permission failures erase the key while transient outages retain it", async () => {
  let failure = null;
  const clock = fakeClock();
  const provider = createInMemoryViewCredentialProvider({
    ...providerOptions({ clock }).options,
    verifyCredential: async (input) => {
      if (failure) throw failure;
      return verified(input, clock.now());
    },
  });
  await provider.connect(material());
  failure = reviewError(
    "VIEW_ONLY_PERMISSION_RATE_LIMITED",
    "rate limited",
    {
      stage: "VIEW_ONLY_CREDENTIAL",
      retryable: true,
      httpStatus: 429,
    },
  );
  await assert.rejects(() =>
    provider.withVerifiedCredential(async () => true),
  );
  assert.equal(provider.status().connected, true);

  failure = reviewError(
    "VIEW_ONLY_PERMISSION_REJECTED",
    "scope changed",
    {
      stage: "VIEW_ONLY_CREDENTIAL",
      retryable: false,
    },
  );
  await assert.rejects(() =>
    provider.withVerifiedCredential(async () => true),
  );
  assert.equal(provider.status().connected, false);
});
