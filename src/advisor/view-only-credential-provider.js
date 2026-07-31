import { reviewError } from "../guard-errors.js";
import { verifyViewCredentialMaterial } from "../permissions.js";

export const VIEW_ONLY_SESSION_DEFAULTS = Object.freeze({
  idleTtlMs: 15 * 60 * 1_000,
  absoluteTtlMs: 60 * 60 * 1_000,
});

const SESSION_SCHEMA =
  "delta.coinbase.advisor_view_only_connection.v1";

function readNow(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("View-only session clock must return a valid Date");
  }
  return value;
}

function assertTtl(name, value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_000 ||
    value > 24 * 60 * 60 * 1_000
  ) {
    throw new TypeError(`${name} must be 1 second through 24 hours`);
  }
}

function disconnectedError(code = "VIEW_ONLY_SESSION_NOT_CONNECTED") {
  const expired = code === "VIEW_ONLY_SESSION_EXPIRED";
  return reviewError(
    code,
    expired
      ? "The local View-only connection expired"
      : "No local View-only Coinbase connection is active",
    {
      stage: "VIEW_ONLY_CREDENTIAL",
      retryable: false,
      recovery:
        "Reconnect a View-only Coinbase key in this local session. No order was submitted.",
    },
  );
}

function supersededError() {
  return reviewError(
    "VIEW_ONLY_SESSION_SUPERSEDED",
    "The local View-only connection changed during verification",
    {
      stage: "VIEW_ONLY_CREDENTIAL",
      retryable: false,
      recovery:
        "Use the current local connection or reconnect. No order was submitted.",
    },
  );
}

function scopeChangedError() {
  return reviewError(
    "VIEW_ONLY_SESSION_SCOPE_CHANGED",
    "The verified Coinbase credential scope changed",
    {
      stage: "VIEW_ONLY_CREDENTIAL",
      retryable: false,
      recovery:
        "Reconnect and review the current View-only scope before a new preflight. No order was submitted.",
    },
  );
}

function busyError() {
  return reviewError(
    "VIEW_ONLY_SESSION_BUSY",
    "Another View-only preflight is already using this local connection",
    {
      stage: "VIEW_ONLY_CREDENTIAL",
      retryable: true,
      recovery:
        "Wait for the active check to finish, then retry. No order was submitted.",
    },
  );
}

function clockError() {
  return reviewError(
    "VIEW_ONLY_SESSION_CLOCK_INVALID",
    "The local clock moved backwards during the View-only session",
    {
      stage: "VIEW_ONLY_CREDENTIAL",
      retryable: false,
      recovery:
        "Reconnect after correcting the local clock. No order was submitted.",
    },
  );
}

function shouldDisconnectAfterVerificationFailure(error) {
  const code =
    typeof error?.code === "string" ? error.code : "";
  if (
    [
      "VIEW_ONLY_CREDENTIAL_MALFORMED",
      "VIEW_ONLY_CREDENTIAL_REJECTED",
      "VIEW_ONLY_PERMISSION_REJECTED",
      "VIEW_ONLY_PERMISSION_RESPONSE_MALFORMED",
    ].includes(code)
  ) {
    return true;
  }
  return (
    error?.retryable === false &&
    ![
      "VIEW_ONLY_PERMISSION_RATE_LIMITED",
      "VIEW_ONLY_PERMISSION_OUTAGE",
    ].includes(code)
  );
}

function statusView(connection, nowDate) {
  if (!connection) {
    return Object.freeze({
      schema_version: SESSION_SCHEMA,
      connected: false,
      mode: "view_only_preflight",
      storage: "server_process_memory_only",
      create_available: false,
      no_order_submitted: true,
    });
  }
  return Object.freeze({
    schema_version: SESSION_SCHEMA,
    connected: true,
    mode: "view_only_preflight",
    storage: "server_process_memory_only",
    permissions: Object.freeze({
      can_view: true,
      can_trade: false,
      can_transfer: false,
      can_receive: connection.attestation.can_receive,
      can_receive_reported:
        connection.attestation.can_receive_reported,
    }),
    verified_at: connection.attestation.verified_at,
    last_used_at: new Date(connection.lastUsedAtMs).toISOString(),
    idle_expires_at: new Date(
      connection.lastUsedAtMs + connection.idleTtlMs,
    ).toISOString(),
    absolute_expires_at: new Date(
      connection.absoluteExpiresAtMs,
    ).toISOString(),
    evidence_age_ms: Math.max(
      0,
      nowDate.getTime() -
        Date.parse(connection.attestation.verified_at),
    ),
    create_available: false,
    no_order_submitted: true,
  });
}

/**
 * Server-process-only holder for one Coinbase View-only key.
 *
 * The provider has no persistence method and never exposes credential material
 * through `status`, `connect`, or `disconnect`. A trusted backend consumer can
 * borrow the credentials only inside `withVerifiedCredential`; permissions
 * are fetched again immediately before that callback runs.
 */
export function createInMemoryViewCredentialProvider({
  fetchImpl = fetch,
  verifyCredential = verifyViewCredentialMaterial,
  now = () => new Date(),
  idleTtlMs = VIEW_ONLY_SESSION_DEFAULTS.idleTtlMs,
  absoluteTtlMs =
    VIEW_ONLY_SESSION_DEFAULTS.absoluteTtlMs,
  maxConcurrentPreflights = 1,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
} = {}) {
  if (
    typeof fetchImpl !== "function" ||
    typeof verifyCredential !== "function" ||
    typeof now !== "function" ||
    typeof schedule !== "function" ||
    typeof cancelSchedule !== "function"
  ) {
    throw new TypeError(
      "View-only provider dependencies are invalid",
    );
  }
  assertTtl("idleTtlMs", idleTtlMs);
  assertTtl("absoluteTtlMs", absoluteTtlMs);
  if (idleTtlMs > absoluteTtlMs) {
    throw new TypeError(
      "idleTtlMs must not exceed absoluteTtlMs",
    );
  }
  if (
    !Number.isSafeInteger(maxConcurrentPreflights) ||
    maxConcurrentPreflights < 1 ||
    maxConcurrentPreflights > 8
  ) {
    throw new TypeError(
      "maxConcurrentPreflights must be 1 through 8",
    );
  }

  let connection = null;
  let generation = 0;
  let lastDisconnectReason = null;
  let expiryTimer = null;
  let lastObservedAtMs = null;
  let activePreflights = 0;

  function currentTime() {
    const value = readNow(now);
    const currentMs = value.getTime();
    if (
      lastObservedAtMs != null &&
      currentMs < lastObservedAtMs
    ) {
      clear("CLOCK_INVALID");
      throw clockError();
    }
    lastObservedAtMs = currentMs;
    return value;
  }

  function cancelExpiry() {
    if (expiryTimer == null) return;
    cancelSchedule(expiryTimer);
    expiryTimer = null;
  }

  function scheduleExpiry() {
    cancelExpiry();
    if (!connection) return;
    const currentMs = lastObservedAtMs ?? Date.now();
    const expiresAtMs = Math.min(
      connection.absoluteExpiresAtMs,
      connection.lastUsedAtMs + connection.idleTtlMs,
    );
    const delay = Math.max(
      1,
      Math.min(2_147_483_647, expiresAtMs - currentMs),
    );
    expiryTimer = schedule(() => {
      expiryTimer = null;
      if (!connection) return;
      let nowDate;
      try {
        nowDate = currentTime();
      } catch {
        return;
      }
      if (!expireIfNecessary(nowDate)) scheduleExpiry();
    }, delay);
    expiryTimer?.unref?.();
  }

  function clear(reason = "DISCONNECTED") {
    cancelExpiry();
    generation += 1;
    const prior = connection;
    connection = null;
    lastDisconnectReason = reason;
    if (prior) {
      for (const controller of prior.leases) {
        controller.abort();
      }
      prior.leases.clear();
      prior.credentials = null;
      prior.attestation = null;
    }
  }

  function expireIfNecessary(nowDate) {
    if (!connection) return false;
    const currentMs = nowDate.getTime();
    if (
      currentMs >= connection.absoluteExpiresAtMs ||
      currentMs >= connection.lastUsedAtMs + connection.idleTtlMs
    ) {
      clear("EXPIRED");
      return true;
    }
    return false;
  }

  function requireConnection(nowDate) {
    const expired = expireIfNecessary(nowDate);
    if (!connection) {
      throw disconnectedError(
        expired || lastDisconnectReason === "EXPIRED"
          ? "VIEW_ONLY_SESSION_EXPIRED"
          : "VIEW_ONLY_SESSION_NOT_CONNECTED",
      );
    }
    return connection;
  }

  async function connect(material) {
    // A reconnect attempt immediately invalidates and erases the prior local
    // reference. A late response from either attempt can never resurrect it.
    clear("RECONNECTING");
    const connectGeneration = generation;
    const verified = await verifyCredential(
      material,
      fetchImpl,
      { now: currentTime },
    );
    if (generation !== connectGeneration) {
      throw supersededError();
    }
    const connectedAt = currentTime();
    connection = {
      credentials: verified.credentials,
      attestation: verified.attestation,
      connectedAtMs: connectedAt.getTime(),
      lastUsedAtMs: connectedAt.getTime(),
      idleTtlMs,
      absoluteExpiresAtMs:
        connectedAt.getTime() + absoluteTtlMs,
      leases: new Set(),
    };
    lastDisconnectReason = null;
    scheduleExpiry();
    return statusView(connection, connectedAt);
  }

  function status() {
    const nowDate = currentTime();
    expireIfNecessary(nowDate);
    return statusView(connection, nowDate);
  }

  function disconnect() {
    clear("DISCONNECTED");
    return statusView(null, currentTime());
  }

  async function withVerifiedCredential(operation) {
    if (typeof operation !== "function") {
      throw new TypeError(
        "withVerifiedCredential requires a callback",
      );
    }
    if (activePreflights >= maxConcurrentPreflights) {
      throw busyError();
    }
    activePreflights += 1;
    try {
      const beforeVerification = currentTime();
      const current = requireConnection(beforeVerification);
      const expectedGeneration = generation;
      const expectedKeyFingerprint =
        current.attestation.key_fingerprint;
      const expectedPortfolioFingerprint =
        current.attestation.portfolio_fingerprint;
      let verified;
      try {
        verified = await verifyCredential(
          current.credentials,
          fetchImpl,
          { now: currentTime },
        );
      } catch (error) {
        if (
          generation === expectedGeneration &&
          connection === current &&
          shouldDisconnectAfterVerificationFailure(error)
        ) {
          clear("PERMISSION_INVALID");
        }
        throw error;
      }
      if (
        generation !== expectedGeneration ||
        connection !== current
      ) {
        throw supersededError();
      }
      if (
        verified.attestation.key_fingerprint !==
          expectedKeyFingerprint ||
        verified.attestation.portfolio_fingerprint !==
          expectedPortfolioFingerprint
      ) {
        clear("SCOPE_CHANGED");
        throw scopeChangedError();
      }

      const leaseStartedAt = currentTime();
      requireConnection(leaseStartedAt);
      current.attestation = verified.attestation;
      current.lastUsedAtMs = leaseStartedAt.getTime();
      scheduleExpiry();
      const controller = new AbortController();
      current.leases.add(controller);

      function assertCurrent() {
        const checkedAt = currentTime();
        requireConnection(checkedAt);
        if (
          controller.signal.aborted ||
          generation !== expectedGeneration ||
          connection !== current
        ) {
          throw supersededError();
        }
        if (
          current.attestation.key_fingerprint !==
            expectedKeyFingerprint ||
          current.attestation.portfolio_fingerprint !==
            expectedPortfolioFingerprint
        ) {
          clear("SCOPE_CHANGED");
          throw scopeChangedError();
        }
        return true;
      }

      try {
        assertCurrent();
        const result = await operation(
          Object.freeze({
            credentials: verified.credentials,
            attestation: verified.attestation,
            signal: controller.signal,
            assertCurrent,
            connection: statusView(
              current,
              leaseStartedAt,
            ),
          }),
        );
        assertCurrent();
        return result;
      } finally {
        current.leases.delete(controller);
      }
    } finally {
      activePreflights -= 1;
    }
  }

  return Object.freeze({
    connect,
    status,
    disconnect,
    withVerifiedCredential,
  });
}
