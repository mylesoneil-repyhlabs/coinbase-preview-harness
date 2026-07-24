import { readFile } from "node:fs/promises";
import { sign, verify } from "node:crypto";
import { canonicalize } from "./evidence.js";

const DECISION_FIELDS = Object.freeze([
  "schema_version",
  "decision_id",
  "decision",
  "evaluated_at",
  "expires_at",
  "bindings",
  "checks",
  "reason_codes",
  "authorization",
]);

const BINDING_FIELDS = Object.freeze([
  "plan_id",
  "execution_digest",
  "execution_confirmed_at",
  "policy_expires_at",
  "policy_digest",
  "proposal_digest",
  "evidence_digest",
  "create_payload_digest",
  "portfolio_fingerprint",
  "credential_fingerprint",
  "client_order_id",
  "preview_id",
]);

const AUTHORIZATION_FIELDS = Object.freeze([
  "algorithm",
  "key_id",
  "audience",
  "jti",
  "signature",
]);
const CHECK_FIELDS = Object.freeze(["id", "result"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactFields(value, allowed, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  if (unknown.length) throw new Error(`${name} contains unknown fields: ${unknown.join(", ")}`);
  for (const field of allowed) {
    if (!Object.hasOwn(value, field)) throw new Error(`${name}.${field} is required`);
  }
}

function unsignedDecision(decision) {
  return {
    ...decision,
    authorization: {
      ...decision.authorization,
      signature: "",
    },
  };
}

export function signDeltaDecisionForTest(decision, privateKey) {
  const payload = Buffer.from(canonicalize(unsignedDecision(decision)));
  return {
    ...decision,
    authorization: {
      ...decision.authorization,
      signature: sign(null, payload, privateKey).toString("base64url"),
    },
  };
}

export function verifyDeltaDecision(
  decision,
  expectedBindings,
  publicKey,
  { now = new Date(), maxLifetimeMs = 30_000 } = {},
) {
  assertExactFields(decision, DECISION_FIELDS, "delta decision");
  if (decision.schema_version !== "delta.coinbase.decision.v1") {
    throw new Error("Unsupported delta decision schema");
  }
  if (decision.decision !== "ALLOW") {
    throw new Error(`delta decision is not ALLOW: ${decision.decision}`);
  }
  if (typeof decision.decision_id !== "string" || !decision.decision_id) {
    throw new Error("delta decision_id is required");
  }
  assertExactFields(decision.bindings, BINDING_FIELDS, "delta decision bindings");
  for (const field of BINDING_FIELDS) {
    if (decision.bindings[field] !== expectedBindings[field]) {
      throw new Error(`delta decision binding mismatch: ${field}`);
    }
  }
  if (!Array.isArray(decision.checks) || !Array.isArray(decision.reason_codes)) {
    throw new Error("delta decision checks and reason_codes must be arrays");
  }
  if (!decision.checks.length) throw new Error("delta ALLOW decision must contain checks");
  for (const check of decision.checks) {
    assertExactFields(check, CHECK_FIELDS, "delta decision check");
    if (typeof check.id !== "string" || !check.id || check.result !== "PASS") {
      throw new Error("every delta decision check must be a named PASS");
    }
  }
  if (decision.reason_codes.length) {
    throw new Error("delta ALLOW decision cannot contain reason_codes");
  }

  const evaluatedAt = Date.parse(decision.evaluated_at);
  const expiresAt = Date.parse(decision.expires_at);
  if (!Number.isFinite(evaluatedAt) || !Number.isFinite(expiresAt)) {
    throw new Error("delta decision timestamps are invalid");
  }
  if (expiresAt <= evaluatedAt) {
    throw new Error("delta decision expires_at must be after evaluated_at");
  }
  if (evaluatedAt > now.getTime() + 5_000) {
    throw new Error("delta decision evaluated_at is in the future");
  }
  if (expiresAt <= now.getTime()) throw new Error("delta decision has expired");
  if (expiresAt - evaluatedAt > maxLifetimeMs) {
    throw new Error("delta decision lifetime exceeds the executor maximum");
  }

  assertExactFields(
    decision.authorization,
    AUTHORIZATION_FIELDS,
    "delta decision authorization",
  );
  if (decision.authorization.algorithm !== "Ed25519") {
    throw new Error("delta decision must use Ed25519");
  }
  if (decision.authorization.audience !== "delta-coinbase-executor") {
    throw new Error("delta decision audience mismatch");
  }
  if (
    typeof decision.authorization.jti !== "string" ||
    !decision.authorization.jti ||
    typeof decision.authorization.key_id !== "string" ||
    !decision.authorization.key_id
  ) {
    throw new Error("delta decision jti and key_id are required");
  }
  if (
    process.env.DELTA_DECISION_KEY_ID &&
    decision.authorization.key_id !== process.env.DELTA_DECISION_KEY_ID
  ) {
    throw new Error("delta decision key_id mismatch");
  }
  const signature = Buffer.from(decision.authorization.signature, "base64url");
  const payload = Buffer.from(canonicalize(unsignedDecision(decision)));
  if (!verify(null, payload, publicKey, signature)) {
    throw new Error("delta decision signature verification failed");
  }
  return decision;
}

export async function requestDeltaDecision(
  request,
  {
    url = process.env.DELTA_GATE_URL,
    token = process.env.DELTA_GATE_TOKEN,
    fetchImpl = fetch,
  } = {},
) {
  if (!url) throw new Error("DELTA_GATE_URL is required");
  if (!token) throw new Error("DELTA_GATE_TOKEN is required");
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("DELTA_GATE_URL must use HTTPS");
  }
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (body.length > 256 * 1024) throw new Error("delta gate response exceeded limit");
  if (!response.ok) throw new Error(`delta gate failed with HTTP ${response.status}`);
  return JSON.parse(body);
}

export async function loadDeltaDecisionPublicKey(
  filePath = process.env.DELTA_DECISION_PUBLIC_KEY_FILE,
) {
  if (!filePath) throw new Error("DELTA_DECISION_PUBLIC_KEY_FILE is required");
  return readFile(filePath, "utf8");
}
