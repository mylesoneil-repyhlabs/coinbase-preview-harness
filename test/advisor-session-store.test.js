import test from "node:test";
import assert from "node:assert/strict";
import {
  AdvisorSessionStore,
  registerSessionDisposer,
} from "../src/advisor/session-store.js";

function clock(start = "2026-07-30T12:00:00.000Z") {
  let value = new Date(start);
  return {
    now: () => new Date(value),
    advance(milliseconds) {
      value = new Date(value.getTime() + milliseconds);
    },
  };
}

test("sessions enforce independent idle and absolute expiries", () => {
  const time = clock();
  const store = new AdvisorSessionStore({
    idleTtlMs: 60_000,
    absoluteTtlMs: 180_000,
    now: time.now,
  });
  const first = store.open().session;

  time.advance(50_000);
  assert.equal(store.open(first.token).session.token, first.token);
  time.advance(50_000);
  assert.equal(store.open(first.token).session.token, first.token);
  time.advance(50_000);
  assert.equal(store.open(first.token).session.token, first.token);
  time.advance(30_000);

  const replacement = store.open(first.token).session;
  assert.notEqual(replacement.token, first.token);
});

test("idle expiry destroys retained state and invokes cleanup once", () => {
  const time = clock();
  const reasons = [];
  const store = new AdvisorSessionStore({
    idleTtlMs: 60_000,
    absoluteTtlMs: 180_000,
    now: time.now,
  });
  const session = store.open().session;
  session.plans.set("plan", { secret: "must-clear" });
  session.activity.push({ value: "must-clear" });
  registerSessionDisposer(session, (reason) => reasons.push(reason));

  time.advance(60_000);
  store.open();
  assert.deepEqual(reasons, ["EXPIRED"]);
  assert.equal(session.plans.size, 0);
  assert.equal(session.activity.length, 0);
  assert.equal(session.disposers.size, 0);
});

test("disconnect, capacity eviction, and server cleanup dispose sessions", () => {
  const reasons = [];
  const store = new AdvisorSessionStore({
    maxSessions: 1,
  });
  const first = store.open().session;
  registerSessionDisposer(first, (reason) => reasons.push(reason));
  const second = store.open().session;
  assert.deepEqual(reasons, ["CAPACITY"]);
  registerSessionDisposer(second, (reason) => reasons.push(reason));
  assert.equal(store.destroy(second.token), true);
  assert.deepEqual(reasons, ["CAPACITY", "DISCONNECTED"]);

  const third = store.open().session;
  registerSessionDisposer(third, (reason) => reasons.push(reason));
  store.clear();
  assert.deepEqual(reasons, [
    "CAPACITY",
    "DISCONNECTED",
    "SERVER_STOPPED",
  ]);
});

test("capacity eviction removes the least recently used session", () => {
  const time = clock();
  const evicted = [];
  const store = new AdvisorSessionStore({
    maxSessions: 2,
    now: time.now,
  });
  const first = store.open().session;
  registerSessionDisposer(first, () => evicted.push("first"));
  time.advance(1_000);
  const second = store.open().session;
  registerSessionDisposer(second, () => evicted.push("second"));
  time.advance(1_000);
  assert.equal(store.open(first.token).session.token, first.token);
  time.advance(1_000);
  store.open();
  assert.deepEqual(evicted, ["second"]);
});

test("peek never allocates or extends a session", () => {
  const time = clock();
  const store = new AdvisorSessionStore({
    idleTtlMs: 60_000,
    absoluteTtlMs: 180_000,
    now: time.now,
  });

  assert.equal(store.peek(), null);
  assert.equal(store.peek("invalid"), null);
  const session = store.open().session;
  time.advance(59_999);
  assert.equal(store.peek(session.token), session);
  time.advance(1);
  assert.equal(store.peek(session.token), null);
  const replacement = store.open().session;
  assert.notEqual(replacement.token, session.token);
});

test("touch resolves and extends only an existing unexpired capability", () => {
  const time = clock();
  const store = new AdvisorSessionStore({
    idleTtlMs: 60_000,
    absoluteTtlMs: 180_000,
    now: time.now,
  });
  const session = store.open().session;

  time.advance(59_999);
  assert.equal(store.touch(session.token), session);
  time.advance(59_999);
  assert.equal(store.touch(session.token), session);
  time.advance(60_000);
  assert.equal(store.touch(session.token), null);
  assert.equal(store.peek(session.token), null);

  const replacement = store.open().session;
  assert.notEqual(replacement.token, session.token);
});
