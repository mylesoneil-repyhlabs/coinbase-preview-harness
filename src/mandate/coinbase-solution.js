import { parseDecimal } from "../decimal.js";
import { canonicalize, digest, digestBytes } from "../evidence.js";

const PREFIX = "coinbase-advanced://order/v1/";
const ENVELOPE_FIELDS = Object.freeze([
  "schema_version",
  "create_payload",
  "create_payload_serialized",
  "create_payload_digest",
  "preview_request",
  "preview_request_digest",
  "claimed_evidence",
]);
const CREATE_PAYLOAD_FIELDS = Object.freeze([
  "client_order_id",
  "product_id",
  "side",
  "order_configuration",
  "preview_id",
]);
const PREVIEW_REQUEST_FIELDS = Object.freeze([
  "product_id",
  "side",
  "order_configuration",
]);
const ORDER_CONFIGURATION_FIELDS = Object.freeze(["sor_limit_ioc"]);
const SOR_LIMIT_IOC_FIELDS = Object.freeze(["quote_size", "limit_price"]);
const CLAIMED_EVIDENCE_FIELDS = Object.freeze([
  "market",
  "preview",
  "collected_at",
  "evidence_digest",
  "portfolio_fingerprint",
  "credential_fingerprint",
]);
const MARKET_FIELDS = Object.freeze([
  "product_id",
  "product_type",
  "base_asset",
  "quote_asset",
  "base_increment",
  "quote_increment",
  "price_increment",
  "best_bid",
  "best_ask",
  "observed_at",
  "status",
  "product_flags",
]);
const PRODUCT_FLAG_FIELDS = Object.freeze([
  "is_disabled",
  "trading_disabled",
  "cancel_only",
  "limit_only",
  "post_only",
  "auction_mode",
]);
const PREVIEW_FIELDS = Object.freeze([
  "order_total",
  "commission_total",
  "quote_size",
  "base_size",
  "est_average_filled_price",
  "best_bid",
  "best_ask",
  "preview_id",
  "errs",
  "warning",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactFields(value, fields, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(`${name} has an invalid field set`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertSha256(value, name) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`);
  }
}

function assertIsoTimestamp(value, name) {
  assertNonEmptyString(value, name);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${name} must be an ISO-8601 UTC timestamp`);
  }
}

function assertDecimal(value, name, { positive = false } = {}) {
  const parsed = parseDecimal(value, name);
  if (positive && parsed.coefficient <= 0n) {
    throw new Error(`${name} must be positive`);
  }
}

function assertSorLimitIoc(configuration, name) {
  assertExactFields(configuration, ORDER_CONFIGURATION_FIELDS, name);
  const sorLimitIoc = configuration.sor_limit_ioc;
  assertExactFields(
    sorLimitIoc,
    SOR_LIMIT_IOC_FIELDS,
    `${name}.sor_limit_ioc`,
  );
  assertDecimal(sorLimitIoc.quote_size, `${name}.sor_limit_ioc.quote_size`, {
    positive: true,
  });
  assertDecimal(sorLimitIoc.limit_price, `${name}.sor_limit_ioc.limit_price`, {
    positive: true,
  });
}

export function assertCoinbaseCreatePayload(payload) {
  assertExactFields(payload, CREATE_PAYLOAD_FIELDS, "Coinbase Create payload");
  assertNonEmptyString(
    payload.client_order_id,
    "Coinbase Create payload.client_order_id",
  );
  assertNonEmptyString(payload.product_id, "Coinbase Create payload.product_id");
  if (payload.side !== "BUY") {
    throw new Error("Coinbase Create payload.side must be BUY");
  }
  assertNonEmptyString(payload.preview_id, "Coinbase Create payload.preview_id");
  assertSorLimitIoc(
    payload.order_configuration,
    "Coinbase Create payload.order_configuration",
  );
}

function assertPreviewRequest(request) {
  assertExactFields(
    request,
    PREVIEW_REQUEST_FIELDS,
    "Coinbase Preview request",
  );
  assertNonEmptyString(
    request.product_id,
    "Coinbase Preview request.product_id",
  );
  if (request.side !== "BUY") {
    throw new Error("Coinbase Preview request.side must be BUY");
  }
  assertSorLimitIoc(
    request.order_configuration,
    "Coinbase Preview request.order_configuration",
  );
}

function assertMarket(market) {
  assertExactFields(market, MARKET_FIELDS, "Coinbase market evidence");
  for (const field of ["product_id", "base_asset", "quote_asset", "status"]) {
    assertNonEmptyString(
      market[field],
      `Coinbase market evidence.${field}`,
    );
  }
  if (market.product_type !== "SPOT") {
    throw new Error("Coinbase market evidence.product_type must be SPOT");
  }
  for (const field of [
    "base_increment",
    "quote_increment",
    "price_increment",
    "best_bid",
    "best_ask",
  ]) {
    assertDecimal(market[field], `Coinbase market evidence.${field}`, {
      positive: true,
    });
  }
  assertIsoTimestamp(
    market.observed_at,
    "Coinbase market evidence.observed_at",
  );
  assertExactFields(
    market.product_flags,
    PRODUCT_FLAG_FIELDS,
    "Coinbase market evidence.product_flags",
  );
  for (const field of PRODUCT_FLAG_FIELDS) {
    if (typeof market.product_flags[field] !== "boolean") {
      throw new Error(
        `Coinbase market evidence.product_flags.${field} must be boolean`,
      );
    }
  }
}

function assertPreview(preview) {
  assertExactFields(preview, PREVIEW_FIELDS, "Coinbase preview evidence");
  for (const field of [
    "order_total",
    "quote_size",
    "base_size",
    "est_average_filled_price",
    "best_bid",
    "best_ask",
  ]) {
    assertDecimal(preview[field], `Coinbase preview evidence.${field}`, {
      positive: true,
    });
  }
  assertDecimal(
    preview.commission_total,
    "Coinbase preview evidence.commission_total",
  );
  assertNonEmptyString(
    preview.preview_id,
    "Coinbase preview evidence.preview_id",
  );
  for (const field of ["errs", "warning"]) {
    if (!Array.isArray(preview[field]) || preview[field].length !== 0) {
      throw new Error(
        `Coinbase preview evidence.${field} must be an empty array`,
      );
    }
  }
}

function assertClaimedEvidence(claimedEvidence, payload) {
  assertExactFields(
    claimedEvidence,
    CLAIMED_EVIDENCE_FIELDS,
    "Coinbase claimed evidence",
  );
  assertMarket(claimedEvidence.market);
  assertPreview(claimedEvidence.preview);
  assertIsoTimestamp(
    claimedEvidence.collected_at,
    "Coinbase claimed evidence.collected_at",
  );
  assertSha256(
    claimedEvidence.evidence_digest,
    "Coinbase claimed evidence.evidence_digest",
  );
  assertNonEmptyString(
    claimedEvidence.portfolio_fingerprint,
    "Coinbase claimed evidence.portfolio_fingerprint",
  );
  assertNonEmptyString(
    claimedEvidence.credential_fingerprint,
    "Coinbase claimed evidence.credential_fingerprint",
  );
  if (claimedEvidence.market.product_id !== payload.product_id) {
    throw new Error(
      "Coinbase market evidence does not match the Create payload product",
    );
  }
  if (
    claimedEvidence.preview.quote_size !==
    payload.order_configuration.sor_limit_ioc.quote_size
  ) {
    throw new Error(
      "Coinbase preview evidence quote size does not match the Create payload",
    );
  }
  const expectedEvidenceDigest = digest({
    market: claimedEvidence.market,
    preview: claimedEvidence.preview,
    collected_at: claimedEvidence.collected_at,
  });
  if (claimedEvidence.evidence_digest !== expectedEvidenceDigest) {
    throw new Error("Coinbase claimed evidence digest mismatch");
  }
}

export function buildCoinbaseSolution(evaluationRequest) {
  const envelope = {
    schema_version: "delta.coinbase.solution.v1",
    create_payload: evaluationRequest.create_payload,
    create_payload_serialized: evaluationRequest.create_payload_serialized,
    create_payload_digest: evaluationRequest.create_payload_digest,
    preview_request: evaluationRequest.preview_request,
    preview_request_digest: evaluationRequest.preview_request_digest,
    claimed_evidence: {
      market: evaluationRequest.evidence.market,
      preview: evaluationRequest.evidence.preview,
      collected_at: evaluationRequest.evidence.collected_at,
      evidence_digest: evaluationRequest.evidence_digest,
      portfolio_fingerprint:
        evaluationRequest.credential_binding.portfolio_fingerprint,
      credential_fingerprint:
        evaluationRequest.credential_binding.credential_fingerprint,
    },
  };
  const encoded = Buffer.from(canonicalize(envelope)).toString("base64url");
  return `${PREFIX}${evaluationRequest.create_payload_digest}?envelope=${encoded}`;
}

export function parseCoinbaseSolution(solution) {
  if (typeof solution !== "string" || !solution.startsWith(PREFIX)) {
    throw new Error("Unsupported Coinbase proposal solution");
  }
  const remainder = solution.slice(PREFIX.length);
  const separator = remainder.indexOf("?envelope=");
  if (separator <= 0 || remainder.indexOf("?envelope=", separator + 1) !== -1) {
    throw new Error("Malformed Coinbase proposal solution");
  }
  const pathDigest = remainder.slice(0, separator);
  if (!SHA256_PATTERN.test(pathDigest)) {
    throw new Error("Malformed Coinbase proposal digest");
  }
  const encoded = remainder.slice(separator + "?envelope=".length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Malformed Coinbase proposal envelope");
  }

  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Coinbase proposal envelope is not valid JSON");
  }
  assertExactFields(envelope, ENVELOPE_FIELDS, "Coinbase proposal envelope");
  if (envelope.schema_version !== "delta.coinbase.solution.v1") {
    throw new Error("Unsupported Coinbase proposal envelope version");
  }
  if (
    typeof envelope.create_payload_serialized !== "string" ||
    digestBytes(envelope.create_payload_serialized) !== pathDigest ||
    envelope.create_payload_digest !== pathDigest
  ) {
    throw new Error("Coinbase proposal Create payload digest mismatch");
  }
  let serializedPayload;
  try {
    serializedPayload = JSON.parse(envelope.create_payload_serialized);
  } catch {
    throw new Error("Coinbase proposal Create payload bytes are not valid JSON");
  }
  if (
    canonicalize(envelope.create_payload) !== canonicalize(serializedPayload)
  ) {
    throw new Error("Coinbase proposal Create payload bytes mismatch");
  }
  assertCoinbaseCreatePayload(envelope.create_payload);
  assertPreviewRequest(envelope.preview_request);
  assertClaimedEvidence(envelope.claimed_evidence, envelope.create_payload);
  assertSha256(
    envelope.preview_request_digest,
    "Coinbase proposal Preview request digest",
  );
  if (digest(envelope.preview_request) !== envelope.preview_request_digest) {
    throw new Error("Coinbase proposal Preview request digest mismatch");
  }
  if (
    canonicalize(envelope) !==
    Buffer.from(encoded, "base64url").toString("utf8")
  ) {
    throw new Error("Coinbase proposal envelope is not canonical");
  }
  return envelope;
}
