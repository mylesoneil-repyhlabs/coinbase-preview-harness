import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_ABSOLUTE_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_MAX_SESSIONS = 256;
const MAX_PLANS_PER_SESSION = 12;
const MAX_ACTIVITY_PER_SESSION = 40;

function validDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function sessionToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function createSession(token, now) {
  return {
    token,
    created_at: now,
    last_seen_at: now,
    plans: new Map(),
    conditionalPlans: new Map(),
    educationalPlans: new Map(),
    activity: [],
    disposers: new Set(),
  };
}

function disposeSession(session, reason) {
  if (!session) return;
  for (const dispose of session.disposers ?? []) {
    try {
      dispose(reason);
    } catch {
      // Disposal is best-effort and must never expose retained material.
    }
  }
  session.disposers?.clear();
  session.plans?.clear();
  for (const entry of session.conditionalPlans?.values?.() ?? []) {
    for (const record of entry?.revisions?.values?.() ?? []) {
      record?.inFlight?.controller?.abort?.(reason);
    }
  }
  session.conditionalPlans?.clear();
  session.educationalPlans?.clear();
  if (Array.isArray(session.activity)) session.activity.length = 0;
}

export class AdvisorSessionStore {
  #sessions = new Map();

  constructor({
    idleTtlMs,
    absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS,
    ttlMs,
    maxSessions = DEFAULT_MAX_SESSIONS,
    now = () => new Date(),
  } = {}) {
    const resolvedIdleTtlMs =
      idleTtlMs ?? ttlMs ?? DEFAULT_IDLE_TTL_MS;
    if (
      !Number.isInteger(resolvedIdleTtlMs) ||
      resolvedIdleTtlMs < 60_000
    ) {
      throw new Error(
        "Advisor session idle TTL must be at least 60 seconds",
      );
    }
    if (
      !Number.isInteger(absoluteTtlMs) ||
      absoluteTtlMs < resolvedIdleTtlMs
    ) {
      throw new Error(
        "Advisor session absolute TTL must be at least the idle TTL",
      );
    }
    if (!Number.isInteger(maxSessions) || maxSessions < 1) {
      throw new Error("Advisor session capacity must be positive");
    }
    this.idleTtlMs = resolvedIdleTtlMs;
    this.absoluteTtlMs = absoluteTtlMs;
    this.maxSessions = maxSessions;
    this.now = now;
  }

  get ttlSeconds() {
    return this.idleTtlSeconds;
  }

  get idleTtlSeconds() {
    return Math.floor(this.idleTtlMs / 1_000);
  }

  get absoluteTtlSeconds() {
    return Math.floor(this.absoluteTtlMs / 1_000);
  }

  #currentTime() {
    const current = this.now();
    if (!validDate(current)) {
      throw new Error("Advisor session clock is invalid");
    }
    return current;
  }

  #prune(current) {
    const idleCutoff = current.getTime() - this.idleTtlMs;
    const absoluteCutoff = current.getTime() - this.absoluteTtlMs;
    for (const [token, session] of this.#sessions) {
      if (
        session.last_seen_at.getTime() <= idleCutoff ||
        session.created_at.getTime() <= absoluteCutoff
      ) {
        this.#sessions.delete(token);
        disposeSession(session, "EXPIRED");
      }
    }
  }

  open(candidateToken = null) {
    const current = this.#currentTime();
    this.#prune(current);
    if (
      typeof candidateToken === "string" &&
      TOKEN_PATTERN.test(candidateToken)
    ) {
      const existing = this.#sessions.get(candidateToken);
      if (existing) {
        existing.last_seen_at = current;
        return { session: existing, created: false };
      }
    }
    while (this.#sessions.size >= this.maxSessions) {
      let oldestToken;
      let oldestLastSeen = Number.POSITIVE_INFINITY;
      let oldestCreated = Number.POSITIVE_INFINITY;
      for (const [token, session] of this.#sessions) {
        const lastSeen = session.last_seen_at.getTime();
        const created = session.created_at.getTime();
        if (
          lastSeen < oldestLastSeen ||
          (lastSeen === oldestLastSeen && created < oldestCreated)
        ) {
          oldestToken = token;
          oldestLastSeen = lastSeen;
          oldestCreated = created;
        }
      }
      if (oldestToken === undefined) break;
      this.destroy(oldestToken, "CAPACITY");
    }
    let token;
    do {
      token = sessionToken();
    } while (this.#sessions.has(token));
    const session = createSession(token, current);
    this.#sessions.set(token, session);
    return { session, created: true };
  }

  peek(candidateToken = null) {
    const current = this.#currentTime();
    this.#prune(current);
    if (
      typeof candidateToken !== "string" ||
      !TOKEN_PATTERN.test(candidateToken)
    ) {
      return null;
    }
    return this.#sessions.get(candidateToken) ?? null;
  }

  touch(candidateToken = null) {
    const current = this.#currentTime();
    this.#prune(current);
    if (
      typeof candidateToken !== "string" ||
      !TOKEN_PATTERN.test(candidateToken)
    ) {
      return null;
    }
    const existing = this.#sessions.get(candidateToken);
    if (!existing) return null;
    existing.last_seen_at = current;
    return existing;
  }

  destroy(token, reason = "DISCONNECTED") {
    if (!isSessionToken(token)) return false;
    const session = this.#sessions.get(token);
    if (!session) return false;
    this.#sessions.delete(token);
    disposeSession(session, reason);
    return true;
  }

  clear(reason = "SERVER_STOPPED") {
    for (const [token, session] of this.#sessions) {
      this.#sessions.delete(token);
      disposeSession(session, reason);
    }
  }
}

export function registerSessionDisposer(session, dispose) {
  if (!(session?.disposers instanceof Set) || typeof dispose !== "function") {
    throw new Error("Advisor session disposer is invalid");
  }
  session.disposers.add(dispose);
  return () => session.disposers.delete(dispose);
}

export function rememberPlan(session, plan) {
  if (!(session?.plans instanceof Map) || typeof plan?.plan_id !== "string") {
    throw new Error("Advisor plan session is invalid");
  }
  while (session.plans.size >= MAX_PLANS_PER_SESSION) {
    const oldest = session.plans.keys().next().value;
    if (oldest === undefined) break;
    session.plans.delete(oldest);
  }
  const stored = {
    plan,
    state:
      plan.status === "AWAITING_HUMAN_CONFIRMATION"
        ? "AWAITING_USER_CONFIRMATION"
        : "NOT_AUTHORIZABLE",
  };
  session.plans.set(plan.plan_id, stored);
  return stored;
}

export function appendActivity(session, activity) {
  if (!Array.isArray(session?.activity)) {
    throw new Error("Advisor activity session is invalid");
  }
  session.activity.unshift(Object.freeze({ ...activity }));
  if (session.activity.length > MAX_ACTIVITY_PER_SESSION) {
    session.activity.length = MAX_ACTIVITY_PER_SESSION;
  }
}

export function isSessionToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
