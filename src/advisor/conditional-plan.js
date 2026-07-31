import { randomUUID } from "node:crypto";
import {
  addDecimals,
  compareDecimals,
  isPositiveDecimal,
  parseDecimal,
  priceBoundFromBps,
  subtractDecimals,
} from "../decimal.js";
import { digest } from "../evidence.js";

export const CONDITIONAL_PLAN_SCHEMA =
  "delta.coinbase.conditional_plan.v1";
export const CONDITIONAL_AUTH_SCHEMA =
  "delta.coinbase.conditional_simulation_authorization.v1";
export const CONDITIONAL_ATTEMPT_SCHEMA =
  "delta.coinbase.conditional_simulation_attempt.v1";
export const CONDITIONAL_RECEIPT_SCHEMA =
  "delta.coinbase.conditional_simulation_receipt.v1";

export const CONDITIONAL_PLAN_STATES = Object.freeze([
  "DRAFT",
  "READY_FOR_SIM_AUTH",
  "AUTHORIZED_FOR_SIMULATION",
  "CHECKING",
  "CONDITION_NOT_MET",
  "WOULD_TRIGGER_SIMULATION",
  "BLOCKED",
  "REVIEW",
  "EXPIRED",
  "REVOKED",
  "SUPERSEDED",
]);

const PRODUCT_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;
const SOURCES = new Set(["fixture", "view_only"]);
const SCENARIOS = new Set(["not_met", "block", "pass"]);
const MAX_EVIDENCE_AGE_MS = 15_000;
const MAX_CLOCK_SKEW_MS = 1_000;
const MAX_ID_LENGTH = 128;
const RECEIPT_PROOF_CLASS =
  "LOCAL_SHA256_BINDING_NOT_PRODUCTION_DELTA";
const FIXTURE_TICK = "0.01";
const MIN_DECIMAL_UNIT = "0.000000000000000001";
const PLAN_BOUNDARY = Object.freeze({
  executable: false,
  monitoring: false,
  background_work: false,
  autonomous_execution: false,
  create_available: false,
  order_submitted: false,
  statement:
    "Simulation only · nothing is watching · orders off",
});
const AUTHORIZATION_BOUNDARY = Object.freeze({
  future_live_authorization: false,
  reusable: false,
  create_available: false,
  order_submitted: false,
  consumption_enforcement:
    "SERVER_SESSION_ATOMIC_BEFORE_EVIDENCE",
});
const RECEIPT_OUTCOMES = Object.freeze({
  EVIDENCE_UNABLE_TO_VERIFY: "REVIEW",
  ABSOLUTE_BBO_CONDITION_NOT_MET: "CONDITION_NOT_MET",
  PROPOSAL_SIZE_EXCEEDS_PLAN: "BLOCK",
  PROPOSAL_PRICE_OUTSIDE_EFFECTIVE_LIMIT: "BLOCK",
  PROPOSAL_OUTSIDE_PLAN: "BLOCK",
  LOCAL_DELTA_SIMULATION_PASS: "PASS",
});

function validDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid date`);
  }
  return date;
}

function nowDate(now) {
  if (typeof now !== "function") {
    throw new TypeError("Conditional plan clock must be a function");
  }
  return validDate(now(), "now");
}

function requiredOpaqueId(value, name) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new Error(
      `${name} must be a short opaque identifier`,
    );
  }
  return value;
}

function requiredDigest(value, name) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{64}$/.test(value)
  ) {
    throw new Error(`${name} must be a SHA-256 digest`);
  }
  return value;
}

function requiredTimezone(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 64
  ) {
    throw new Error("timezone must be a short IANA timezone label");
  }
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).format(new Date(0));
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
  return value;
}

function hasExactBoundary(boundary, expected) {
  return (
    boundary &&
    typeof boundary === "object" &&
    !Array.isArray(boundary) &&
    Object.keys(boundary).length ===
      Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, value]) => boundary[key] === value,
    )
  );
}

function splitProduct(productId) {
  if (
    typeof productId !== "string" ||
    productId.length > 64 ||
    !PRODUCT_PATTERN.test(productId)
  ) {
    throw new Error("product_id must be one uppercase Coinbase pair");
  }
  const [baseAsset, quoteAsset] = productId.split("-");
  return { baseAsset, quoteAsset };
}

function requiredPositiveDecimal(value, name) {
  if (!isPositiveDecimal(value)) {
    throw new Error(`${name} must be a positive decimal string`);
  }
  return value;
}

function planBinding(plan) {
  return {
    schema_version: plan.schema_version,
    plan_id: plan.plan_id,
    revision: plan.revision,
    state: plan.state,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    supersedes_digest: plan.supersedes_digest,
    template: plan.template,
    boundary: plan.boundary,
  };
}

function authorizationBinding(authorization) {
  return {
    schema_version: authorization.schema_version,
    authorization_id: authorization.authorization_id,
    plan_id: authorization.plan_id,
    plan_revision: authorization.plan_revision,
    plan_digest: authorization.plan_digest,
    source: authorization.source,
    authorized_at: authorization.authorized_at,
    expires_at: authorization.expires_at,
    max_uses: authorization.max_uses,
    mode: authorization.mode,
    boundary: authorization.boundary,
  };
}

function receiptBinding(receipt) {
  return {
    schema_version: receipt.schema_version,
    receipt_id: receipt.receipt_id,
    plan_id: receipt.plan_id,
    plan_revision: receipt.plan_revision,
    plan_digest: receipt.plan_digest,
    authorization_digest: receipt.authorization_digest,
    evidence_digest: receipt.evidence_digest,
    proposal_digest: receipt.proposal_digest,
    decision: receipt.decision,
    code: receipt.code,
    evaluated_at: receipt.evaluated_at,
    source: receipt.source,
    execution_state: receipt.execution_state,
    proof_class: receipt.proof_class,
  };
}

function semanticTemplate(template) {
  try {
    const normalized = templateFromInput({
      product_id: template?.product_id,
      side: template?.side,
      size_value: template?.size?.value,
      threshold_value: template?.condition?.value,
      max_slippage_bps:
        template?.limits?.max_slippage_bps,
      max_fee_value: template?.limits?.max_fee?.value,
      timezone: template?.timezone,
      expires_at: template?.expires_at,
    });
    return digest(normalized) === digest(template)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function assertPlanIntegrity(plan) {
  try {
    if (
      !plan ||
      typeof plan !== "object" ||
      Array.isArray(plan) ||
      Object.keys(plan).length !== 10 ||
      plan.schema_version !== CONDITIONAL_PLAN_SCHEMA ||
      !Number.isInteger(plan.revision) ||
      plan.revision < 1 ||
      !CONDITIONAL_PLAN_STATES.includes(plan.state) ||
      !semanticTemplate(plan.template) ||
      !hasExactBoundary(plan.boundary, PLAN_BOUNDARY)
    ) {
      throw new Error("invalid shape");
    }
    requiredOpaqueId(plan.plan_id, "plan_id");
    const createdAt = validDate(plan.created_at, "created_at");
    const updatedAt = validDate(plan.updated_at, "updated_at");
    if (updatedAt.getTime() < createdAt.getTime()) {
      throw new Error("updated_at predates created_at");
    }
    if (plan.revision === 1) {
      if (plan.supersedes_digest !== null) {
        throw new Error("revision one cannot supersede a digest");
      }
    } else {
      requiredDigest(
        plan.supersedes_digest,
        "supersedes_digest",
      );
    }
    requiredDigest(plan.plan_digest, "plan_digest");
    if (digest(planBinding(plan)) !== plan.plan_digest) {
      throw new Error("plan digest mismatch");
    }
  } catch {
    throw new Error("Conditional plan integrity is invalid");
  }
  return plan;
}

function assertAuthorizationIntegrity(authorization) {
  try {
    if (
      !authorization ||
      typeof authorization !== "object" ||
      Array.isArray(authorization) ||
      Object.keys(authorization).length !== 12 ||
      authorization.schema_version !== CONDITIONAL_AUTH_SCHEMA ||
      authorization.mode !== "ONE_CHECK_SIMULATION_ONLY" ||
      authorization.max_uses !== 1 ||
      !SOURCES.has(authorization.source) ||
      !Number.isInteger(authorization.plan_revision) ||
      authorization.plan_revision < 1 ||
      !hasExactBoundary(
        authorization.boundary,
        AUTHORIZATION_BOUNDARY,
      )
    ) {
      throw new Error("invalid shape");
    }
    requiredOpaqueId(
      authorization.authorization_id,
      "authorization_id",
    );
    requiredOpaqueId(authorization.plan_id, "plan_id");
    requiredDigest(authorization.plan_digest, "plan_digest");
    requiredDigest(
      authorization.authorization_digest,
      "authorization_digest",
    );
    const authorizedAt = validDate(
      authorization.authorized_at,
      "authorized_at",
    );
    const expiresAt = validDate(
      authorization.expires_at,
      "expires_at",
    );
    const lifetimeMs =
      expiresAt.getTime() - authorizedAt.getTime();
    if (lifetimeMs < 30_000 || lifetimeMs > 600_000) {
      throw new Error("invalid authorization lifetime");
    }
    if (
      digest(authorizationBinding(authorization)) !==
      authorization.authorization_digest
    ) {
      throw new Error("authorization digest mismatch");
    }
  } catch {
    throw new Error("Conditional simulation authorization is invalid");
  }
  return authorization;
}

function terminalState(plan, { currentRevision, now }) {
  if (plan.state === "REVOKED") return "REVOKED";
  if (now.getTime() >= Date.parse(plan.template.expires_at)) {
    return "EXPIRED";
  }
  if (
    Number.isInteger(currentRevision) &&
    currentRevision !== plan.revision
  ) {
    return "SUPERSEDED";
  }
  if (["EXPIRED", "SUPERSEDED"].includes(plan.state)) {
    return plan.state;
  }
  return null;
}

function requiredCurrentRevision(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      "currentRevision must be a positive server-owned integer",
    );
  }
  return value;
}

function templateFromInput(input, current) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Conditional plan input must be an object");
  }
  const productId = input.product_id ?? current?.product_id;
  const side = input.side ?? current?.side;
  const sizeValue = input.size_value ?? current?.size.value;
  const thresholdValue =
    input.threshold_value ?? current?.condition.value;
  const maxSlippageBps =
    input.max_slippage_bps ??
    current?.limits.max_slippage_bps;
  const maxFeeValue =
    input.max_fee_value ?? current?.limits.max_fee.value;
  const timezone = input.timezone ?? current?.timezone;
  const expiresAt = input.expires_at ?? current?.expires_at;
  const { baseAsset, quoteAsset } = splitProduct(productId);
  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("side must be BUY or SELL");
  }
  requiredPositiveDecimal(sizeValue, "size_value");
  requiredPositiveDecimal(thresholdValue, "threshold_value");
  requiredPositiveDecimal(maxFeeValue, "max_fee_value");
  if (
    !Number.isInteger(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps > 10_000
  ) {
    throw new Error(
      "max_slippage_bps must be an integer from 0 through 10000",
    );
  }
  requiredTimezone(timezone);
  const parsedExpiry = validDate(expiresAt, "expires_at");
  return Object.freeze({
    product_id: productId,
    base_asset: baseAsset,
    quote_asset: quoteAsset,
    side,
    size: Object.freeze({
      asset: side === "BUY" ? quoteAsset : baseAsset,
      value: sizeValue,
      operator: "MAX",
    }),
    condition: Object.freeze({
      reference: side === "BUY" ? "BEST_ASK" : "BEST_BID",
      operator: side === "BUY" ? "LTE" : "GTE",
      asset: quoteAsset,
      value: thresholdValue,
    }),
    limits: Object.freeze({
      max_slippage_bps: maxSlippageBps,
      max_fee: Object.freeze({
        asset: quoteAsset,
        value: maxFeeValue,
      }),
    }),
    timezone,
    expires_at: parsedExpiry.toISOString(),
    one_shot: true,
  });
}

function sealedPlan(fields) {
  const plan = {
    schema_version: CONDITIONAL_PLAN_SCHEMA,
    ...fields,
  };
  return Object.freeze({
    ...plan,
    plan_digest: digest(planBinding(plan)),
  });
}

export function createConditionalPlan(
  input,
  {
    now = () => new Date(),
    planId = randomUUID(),
  } = {},
) {
  const createdAt = nowDate(now);
  requiredOpaqueId(planId, "plan_id");
  const template = templateFromInput(input);
  if (Date.parse(template.expires_at) <= createdAt.getTime()) {
    throw new Error("expires_at must be in the future");
  }
  return sealedPlan({
    plan_id: planId,
    revision: 1,
    state: "READY_FOR_SIM_AUTH",
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString(),
    supersedes_digest: null,
    template,
    boundary: PLAN_BOUNDARY,
  });
}

export function reviseConditionalPlan(
  current,
  patch,
  { now = () => new Date() } = {},
) {
  assertPlanIntegrity(current);
  const updatedAt = nowDate(now);
  if (
    updatedAt.getTime() <
    Date.parse(current.updated_at)
  ) {
    throw new Error(
      "Server time cannot move backward across a plan revision",
    );
  }
  const state = terminalState(current, {
    currentRevision: current.revision,
    now: updatedAt,
  });
  if (state) {
    throw new Error(`Cannot edit a ${state} conditional plan`);
  }
  const template = templateFromInput(patch, current.template);
  if (Date.parse(template.expires_at) <= updatedAt.getTime()) {
    throw new Error("expires_at must be in the future");
  }
  const superseded = sealedPlan({
    ...planBinding(current),
    state: "SUPERSEDED",
    updated_at: updatedAt.toISOString(),
  });
  const revision = sealedPlan({
    plan_id: current.plan_id,
    revision: current.revision + 1,
    state: "READY_FOR_SIM_AUTH",
    created_at: current.created_at,
    updated_at: updatedAt.toISOString(),
    supersedes_digest: current.plan_digest,
    template,
    boundary: current.boundary,
  });
  return Object.freeze({ superseded, revision });
}

export function revokeConditionalPlan(
  current,
  { now = () => new Date() } = {},
) {
  assertPlanIntegrity(current);
  if (current.state === "REVOKED") return current;
  const updatedAt = nowDate(now);
  if (
    updatedAt.getTime() <
    Date.parse(current.updated_at)
  ) {
    throw new Error(
      "Server time cannot move backward across revocation",
    );
  }
  return sealedPlan({
    ...planBinding(current),
    state: "REVOKED",
    updated_at: updatedAt.toISOString(),
  });
}

export function authorizeConditionalSimulation(
  plan,
  {
    source,
    ttlSeconds,
    now = () => new Date(),
    authorizationId = randomUUID(),
    currentRevision = plan?.revision,
  } = {},
) {
  assertPlanIntegrity(plan);
  const authorizedAt = nowDate(now);
  requiredOpaqueId(authorizationId, "authorization_id");
  requiredCurrentRevision(currentRevision);
  const terminal = terminalState(plan, {
    currentRevision,
    now: authorizedAt,
  });
  if (terminal) {
    throw new Error(
      `Conditional plan is ${terminal}; create or authorize the current revision`,
    );
  }
  if (plan.state !== "READY_FOR_SIM_AUTH") {
    throw new Error(
      "Conditional plan is not ready for a simulation authorization",
    );
  }
  if (!SOURCES.has(source)) {
    throw new Error("Choose fixture or view_only evidence explicitly");
  }
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 30 ||
    ttlSeconds > 600
  ) {
    throw new Error(
      "Simulation authorization must last 30 through 600 seconds",
    );
  }
  const remainingPlanLifetimeMs =
    Date.parse(plan.template.expires_at) -
    authorizedAt.getTime();
  if (remainingPlanLifetimeMs < 30_000) {
    throw new Error(
      "Conditional plan must remain valid for at least 30 seconds",
    );
  }
  const expiresAt = new Date(
    Math.min(
      authorizedAt.getTime() + ttlSeconds * 1_000,
      Date.parse(plan.template.expires_at),
    ),
  );
  const authorization = {
    schema_version: CONDITIONAL_AUTH_SCHEMA,
    authorization_id: authorizationId,
    plan_id: plan.plan_id,
    plan_revision: plan.revision,
    plan_digest: plan.plan_digest,
    source,
    authorized_at: authorizedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    max_uses: 1,
    mode: "ONE_CHECK_SIMULATION_ONLY",
    boundary: AUTHORIZATION_BOUNDARY,
  };
  return Object.freeze({
    ...authorization,
    authorization_digest: digest(
      authorizationBinding(authorization),
    ),
  });
}

function validateEvidence(plan, authorization, evidence, evaluatedAt) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error("Simulation evidence is missing");
  }
  if (evidence.source !== authorization.source) {
    throw new Error("Simulation evidence source does not match authorization");
  }
  if (evidence.product_id !== plan.template.product_id) {
    throw new Error("Simulation evidence product does not match the plan");
  }
  requiredPositiveDecimal(evidence.best_bid, "best_bid");
  requiredPositiveDecimal(evidence.best_ask, "best_ask");
  if (compareDecimals(evidence.best_bid, evidence.best_ask) >= 0) {
    throw new Error("Simulation BBO is crossed or locked");
  }
  const observedAt = validDate(evidence.observed_at, "observed_at");
  const ageMs = evaluatedAt.getTime() - observedAt.getTime();
  if (ageMs < -MAX_CLOCK_SKEW_MS || ageMs > MAX_EVIDENCE_AGE_MS) {
    throw new Error("Simulation evidence is stale or future-dated");
  }
  return Object.freeze({
    schema_version:
      "delta.coinbase.conditional_simulation_evidence.v1",
    source: evidence.source,
    provenance:
      evidence.source === "view_only"
        ? "COINBASE_OBSERVED"
        : "SIMULATED_FIXTURE_NOT_COINBASE",
    product_id: evidence.product_id,
    best_bid: evidence.best_bid,
    best_ask: evidence.best_ask,
    observed_at: observedAt.toISOString(),
    received_at: evaluatedAt.toISOString(),
  });
}

function conditionSatisfied(plan, evidence) {
  const { condition, side } = plan.template;
  return side === "BUY"
    ? compareDecimals(evidence.best_ask, condition.value) <= 0
    : compareDecimals(evidence.best_bid, condition.value) >= 0;
}

function canonicalDecimal(value) {
  return value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
}

function observedSlippageBound(plan, evidence) {
  const side = plan.template.side;
  const referencePrice =
    side === "BUY"
      ? evidence.best_ask
      : evidence.best_bid;
  requiredPositiveDecimal(
    referencePrice,
    "slippage reference price",
  );
  const bps = plan.template.limits.max_slippage_bps;
  if (side === "SELL" && bps === 10_000) {
    const triggerPrice = plan.template.condition.value;
    return Object.freeze({
      reference_price: referencePrice,
      observed_slippage_bound: MIN_DECIMAL_UNIT,
      authorized_limit_price:
        compareDecimals(
          triggerPrice,
          MIN_DECIMAL_UNIT,
        ) >= 0
          ? triggerPrice
          : MIN_DECIMAL_UNIT,
    });
  }
  const observedBound = canonicalDecimal(
    priceBoundFromBps(
      referencePrice,
      bps,
      MIN_DECIMAL_UNIT,
      side,
    ),
  );
  requiredPositiveDecimal(
    observedBound,
    "observed slippage bound",
  );
  const triggerPrice = plan.template.condition.value;
  const authorizedLimitPrice =
    side === "BUY"
      ? compareDecimals(triggerPrice, observedBound) <= 0
        ? triggerPrice
        : observedBound
      : compareDecimals(triggerPrice, observedBound) >= 0
        ? triggerPrice
        : observedBound;
  return Object.freeze({
    reference_price: referencePrice,
    observed_slippage_bound: observedBound,
    authorized_limit_price: authorizedLimitPrice,
  });
}

function proposalBinding(proposal) {
  return {
    schema_version: proposal.schema_version,
    product_id: proposal.product_id,
    side: proposal.side,
    order_type: proposal.order_type,
    size: proposal.size,
    condition_reference: proposal.condition_reference,
    slippage_reference_price:
      proposal.slippage_reference_price,
    observed_slippage_bound:
      proposal.observed_slippage_bound,
    authorized_limit_price:
      proposal.authorized_limit_price,
    limit_price: proposal.limit_price,
    max_slippage_bps: proposal.max_slippage_bps,
    estimated_fee: proposal.estimated_fee,
    simulated_only: proposal.simulated_only,
    create_available: proposal.create_available,
  };
}

function assertProposalIntegrity(proposal) {
  try {
    if (
      !proposal ||
      typeof proposal !== "object" ||
      Array.isArray(proposal) ||
      Object.keys(proposal).length !== 15 ||
      proposal.schema_version !==
        "delta.coinbase.conditional_simulated_proposal.v1" ||
      !["BUY", "SELL"].includes(proposal.side) ||
      proposal.order_type !== "SOR_LIMIT_IOC" ||
      proposal.simulated_only !== true ||
      proposal.create_available !== false ||
      !proposal.size ||
      typeof proposal.size !== "object" ||
      Array.isArray(proposal.size) ||
      Object.keys(proposal.size).length !== 2 ||
      !proposal.estimated_fee ||
      typeof proposal.estimated_fee !== "object" ||
      Array.isArray(proposal.estimated_fee) ||
      Object.keys(proposal.estimated_fee).length !== 2 ||
      !Number.isInteger(proposal.max_slippage_bps) ||
      proposal.max_slippage_bps < 0 ||
      proposal.max_slippage_bps > 10_000
    ) {
      throw new Error("invalid proposal shape");
    }
    splitProduct(proposal.product_id);
    requiredPositiveDecimal(
      proposal.size.value,
      "proposal size",
    );
    requiredPositiveDecimal(
      proposal.slippage_reference_price,
      "proposal slippage_reference_price",
    );
    requiredPositiveDecimal(
      proposal.observed_slippage_bound,
      "proposal observed_slippage_bound",
    );
    requiredPositiveDecimal(
      proposal.authorized_limit_price,
      "proposal authorized_limit_price",
    );
    requiredPositiveDecimal(
      proposal.limit_price,
      "proposal limit_price",
    );
    const estimatedFee = parseDecimal(
      proposal.estimated_fee.value,
      "proposal estimated fee",
    );
    if (
      typeof proposal.size.asset !== "string" ||
      typeof proposal.estimated_fee.asset !== "string" ||
      typeof proposal.condition_reference !== "string" ||
      estimatedFee.coefficient < 0n
    ) {
      throw new Error("invalid proposal values");
    }
    requiredDigest(
      proposal.proposal_digest,
      "proposal_digest",
    );
    if (
      digest(proposalBinding(proposal)) !==
      proposal.proposal_digest
    ) {
      throw new Error("proposal digest mismatch");
    }
  } catch {
    throw new Error(
      "Conditional simulated proposal integrity is invalid",
    );
  }
  return proposal;
}

function proposalViolations(plan, proposal, evidence) {
  assertProposalIntegrity(proposal);
  const violations = [];
  const observedBound = observedSlippageBound(
    plan,
    evidence,
  );
  if (
    proposal.product_id !== plan.template.product_id ||
    proposal.side !== plan.template.side ||
    proposal.order_type !== "SOR_LIMIT_IOC" ||
    proposal.size.asset !== plan.template.size.asset ||
    proposal.condition_reference !==
      plan.template.condition.reference ||
    compareDecimals(
      proposal.slippage_reference_price,
      observedBound.reference_price,
    ) !== 0 ||
    compareDecimals(
      proposal.observed_slippage_bound,
      observedBound.observed_slippage_bound,
    ) !== 0 ||
    compareDecimals(
      proposal.authorized_limit_price,
      observedBound.authorized_limit_price,
    ) !== 0 ||
    proposal.estimated_fee.asset !==
      plan.template.limits.max_fee.asset ||
    proposal.max_slippage_bps !==
      plan.template.limits.max_slippage_bps ||
    proposal.simulated_only !== true ||
    proposal.create_available !== false
  ) {
    violations.push("ACTION_MISMATCH");
  }
  const priceOutsideBound =
    plan.template.side === "BUY"
      ? compareDecimals(
          proposal.limit_price,
          observedBound.authorized_limit_price,
        ) > 0
      : compareDecimals(
          proposal.limit_price,
          observedBound.authorized_limit_price,
        ) < 0;
  if (priceOutsideBound) {
    violations.push(
      "PRICE_OUTSIDE_EFFECTIVE_AUTHORIZED_LIMIT",
    );
  }
  if (
    compareDecimals(
      proposal.size.value,
      plan.template.size.value,
    ) > 0
  ) {
    violations.push("SIZE_EXCEEDS_PLAN");
  }
  if (
    proposal.max_slippage_bps >
    plan.template.limits.max_slippage_bps
  ) {
    violations.push("SLIPPAGE_EXCEEDS_PLAN");
  }
  if (
    compareDecimals(
      proposal.estimated_fee.value,
      plan.template.limits.max_fee.value,
    ) > 0
  ) {
    violations.push("FEE_EXCEEDS_PLAN");
  }
  return violations;
}

function proposalOutcome(plan, proposal, evidence) {
  const violations = proposalViolations(
    plan,
    proposal,
    evidence,
  );
  if (violations.length === 0) {
    return Object.freeze({
      decision: "PASS",
      code: "LOCAL_DELTA_SIMULATION_PASS",
      violations,
    });
  }
  return Object.freeze({
    decision: "BLOCK",
    code:
      violations.includes(
        "PRICE_OUTSIDE_EFFECTIVE_AUTHORIZED_LIMIT",
      )
        ? "PROPOSAL_PRICE_OUTSIDE_EFFECTIVE_LIMIT"
        : violations.length === 1 &&
            violations[0] === "SIZE_EXCEEDS_PLAN"
        ? "PROPOSAL_SIZE_EXCEEDS_PLAN"
        : "PROPOSAL_OUTSIDE_PLAN",
    violations,
  });
}

function createProposal(plan, scenario, evidence) {
  const requestedSize =
    scenario === "block"
      ? addDecimals(plan.template.size.value, "1")
      : plan.template.size.value;
  const observedBound = observedSlippageBound(
    plan,
    evidence,
  );
  const triggerPrice = plan.template.condition.value;
  const deliberatelyUnsafePrice =
    scenario === "block" &&
    (plan.template.side === "BUY"
      ? compareDecimals(
          triggerPrice,
          observedBound.authorized_limit_price,
        ) > 0
      : compareDecimals(
          triggerPrice,
          observedBound.authorized_limit_price,
        ) < 0);
  const limitPrice = deliberatelyUnsafePrice
    ? triggerPrice
    : observedBound.authorized_limit_price;
  const proposal = Object.freeze({
    schema_version:
      "delta.coinbase.conditional_simulated_proposal.v1",
    product_id: plan.template.product_id,
    side: plan.template.side,
    order_type: "SOR_LIMIT_IOC",
    size: Object.freeze({
      asset: plan.template.size.asset,
      value: requestedSize,
    }),
    condition_reference: plan.template.condition.reference,
    slippage_reference_price:
      observedBound.reference_price,
    observed_slippage_bound:
      observedBound.observed_slippage_bound,
    authorized_limit_price:
      observedBound.authorized_limit_price,
    limit_price: limitPrice,
    max_slippage_bps:
      plan.template.limits.max_slippage_bps,
    estimated_fee: Object.freeze({
      asset: plan.template.limits.max_fee.asset,
      value: plan.template.limits.max_fee.value,
    }),
    simulated_only: true,
    create_available: false,
  });
  return Object.freeze({
    ...proposal,
    proposal_digest: digest(proposalBinding(proposal)),
  });
}

function decisionReceipt({
  plan,
  authorization,
  evidence,
  proposal,
  decision,
  code,
  evaluatedAt,
  receiptId = randomUUID(),
}) {
  requiredOpaqueId(receiptId, "receipt_id");
  const receipt = {
    schema_version: CONDITIONAL_RECEIPT_SCHEMA,
    receipt_id: receiptId,
    plan_id: plan.plan_id,
    plan_revision: plan.revision,
    plan_digest: plan.plan_digest,
    authorization_digest:
      authorization.authorization_digest,
    evidence_digest: digest(evidence),
    proposal_digest: proposal?.proposal_digest ?? null,
    decision,
    code,
    evaluated_at: evaluatedAt.toISOString(),
    source: authorization.source,
    execution_state: "LOCKED",
    proof_class: RECEIPT_PROOF_CLASS,
  };
  return Object.freeze({
    ...receipt,
    receipt_digest: digest(receiptBinding(receipt)),
  });
}

function expectedReceiptOutcome({
  plan,
  authorization,
  evidence,
  proposal,
  evaluatedAt,
}) {
  if (
    evidence &&
    typeof evidence === "object" &&
    !Array.isArray(evidence) &&
    evidence.unavailable === true
  ) {
    if (
      Object.keys(evidence).length !== 3 ||
      evidence.source !== authorization.source ||
      evidence.product_id !== plan.template.product_id ||
      proposal !== null
    ) {
      throw new Error("Invalid unavailable evidence binding");
    }
    return Object.freeze({
      decision: "REVIEW",
      code: "EVIDENCE_UNABLE_TO_VERIFY",
    });
  }

  const renormalizedEvidence = validateEvidence(
    plan,
    authorization,
    evidence,
    evaluatedAt,
  );
  if (digest(renormalizedEvidence) !== digest(evidence)) {
    throw new Error("Evidence is not the allowlisted normalization");
  }
  if (!conditionSatisfied(plan, renormalizedEvidence)) {
    if (proposal !== null) {
      throw new Error(
        "A proposal cannot exist when the condition is not met",
      );
    }
    return Object.freeze({
      decision: "CONDITION_NOT_MET",
      code: "ABSOLUTE_BBO_CONDITION_NOT_MET",
    });
  }
  if (!proposal) {
    throw new Error(
      "Condition-met evidence must bind an exact proposal",
    );
  }
  return proposalOutcome(plan, proposal, evidence);
}

export function verifyConditionalSimulationReceipt(
  receipt,
  { plan, authorization, evidence, proposal } = {},
) {
  try {
    assertPlanIntegrity(plan);
    assertAuthorizationIntegrity(authorization);
    const allowedReceiptKeys = new Set([
      "schema_version",
      "receipt_id",
      "plan_id",
      "plan_revision",
      "plan_digest",
      "authorization_digest",
      "evidence_digest",
      "proposal_digest",
      "decision",
      "code",
      "evaluated_at",
      "source",
      "execution_state",
      "proof_class",
      "receipt_digest",
      "verified",
    ]);
    if (
      !receipt ||
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      Object.keys(receipt).length < 15 ||
      Object.keys(receipt).length > 16 ||
      !Object.keys(receipt).every((key) =>
        allowedReceiptKeys.has(key),
      ) ||
      ("verified" in receipt &&
        typeof receipt.verified !== "boolean")
    ) {
      return false;
    }
    requiredOpaqueId(receipt.receipt_id, "receipt_id");
    requiredDigest(receipt.plan_digest, "plan_digest");
    requiredDigest(
      receipt.authorization_digest,
      "authorization_digest",
    );
    requiredDigest(receipt.evidence_digest, "evidence_digest");
    requiredDigest(receipt.receipt_digest, "receipt_digest");
    if (receipt.proposal_digest !== null) {
      requiredDigest(
        receipt.proposal_digest,
        "proposal_digest",
      );
    }
    const evaluatedAt = validDate(
      receipt.evaluated_at,
      "evaluated_at",
    );
    const authorizedAt = validDate(
      authorization.authorized_at,
      "authorized_at",
    );
    const authorizationExpiresAt = validDate(
      authorization.expires_at,
      "authorization expires_at",
    );
    if (
      evaluatedAt.getTime() <
        authorizedAt.getTime() ||
      evaluatedAt.getTime() >=
        authorizationExpiresAt.getTime() ||
      evaluatedAt.getTime() >=
        Date.parse(plan.template.expires_at)
    ) {
      return false;
    }
    if (
      authorization.plan_id !== plan.plan_id ||
      authorization.plan_revision !== plan.revision ||
      authorization.plan_digest !== plan.plan_digest
    ) {
      return false;
    }
    const expected = expectedReceiptOutcome({
      plan,
      authorization,
      evidence,
      proposal,
      evaluatedAt,
    });
    return (
      receipt?.schema_version === CONDITIONAL_RECEIPT_SCHEMA &&
      receipt.plan_id === plan.plan_id &&
      receipt.plan_revision === plan.revision &&
      receipt.plan_digest === plan.plan_digest &&
      receipt.authorization_digest ===
        authorization.authorization_digest &&
      receipt.evidence_digest === digest(evidence) &&
      receipt.proposal_digest ===
        (proposal?.proposal_digest ?? null) &&
      receipt.decision === expected.decision &&
      receipt.code === expected.code &&
      RECEIPT_OUTCOMES[receipt.code] === receipt.decision &&
      receipt.source === authorization.source &&
      receipt.execution_state === "LOCKED" &&
      receipt.proof_class === RECEIPT_PROOF_CLASS &&
      receipt.receipt_digest ===
        digest(receiptBinding(receipt))
    );
  } catch {
    return false;
  }
}

/**
 * Pure, stateless evaluation only. The server session must atomically
 * consume the one-use authorization before fetching evidence or calling
 * this function; this primitive must never be used as the use counter.
 */
export function simulateConditionalPlan({
  plan,
  authorization,
  evidence,
  scenario = "pass",
  now = () => new Date(),
  currentRevision = plan?.revision,
} = {}) {
  assertPlanIntegrity(plan);
  assertAuthorizationIntegrity(authorization);
  requiredCurrentRevision(currentRevision);
  if (!SCENARIOS.has(scenario)) {
    throw new Error("Conditional simulation scenario is invalid");
  }
  const evaluatedAt = nowDate(now);
  const terminal = terminalState(plan, {
    currentRevision,
    now: evaluatedAt,
  });
  if (terminal) {
    throw new Error(`Conditional plan is ${terminal}`);
  }
  if (
    authorization.plan_id !== plan.plan_id ||
    authorization.plan_revision !== plan.revision ||
    authorization.plan_digest !== plan.plan_digest
  ) {
    throw new Error(
      "Simulation authorization does not bind the current plan revision",
    );
  }
  const authorizationStartsAt = Date.parse(
    authorization.authorized_at,
  );
  const authorizationExpiresAt = Date.parse(
    authorization.expires_at,
  );
  if (
    authorizationExpiresAt >
    Date.parse(plan.template.expires_at)
  ) {
    throw new Error(
      "Simulation authorization exceeds the plan expiry",
    );
  }
  if (
    evaluatedAt.getTime() <
    authorizationStartsAt
  ) {
    throw new Error(
      "Simulation authorization is not active yet",
    );
  }
  if (
    evaluatedAt.getTime() >=
    authorizationExpiresAt
  ) {
    throw new Error("Simulation authorization expired");
  }

  let normalizedEvidence;
  try {
    normalizedEvidence = validateEvidence(
      plan,
      authorization,
      evidence,
      evaluatedAt,
    );
  } catch (error) {
    const safeEvidence = Object.freeze({
      source: authorization.source,
      product_id: plan.template.product_id,
      unavailable: true,
    });
    const receipt = decisionReceipt({
      plan,
      authorization,
      evidence: safeEvidence,
      proposal: null,
      decision: "REVIEW",
      code: "EVIDENCE_UNABLE_TO_VERIFY",
      evaluatedAt,
    });
    return Object.freeze({
      schema_version: CONDITIONAL_ATTEMPT_SCHEMA,
      plan_id: plan.plan_id,
      plan_revision: plan.revision,
      state: "REVIEW",
      decision: "REVIEW",
      code: "EVIDENCE_UNABLE_TO_VERIFY",
      reason:
        "The selected evidence could not be verified as fresh and exact.",
      recovery:
        "Run one fresh check from the same selected source. Nothing is watching and no order was submitted.",
      evidence: safeEvidence,
      proposal: null,
      receipt: Object.freeze({
        ...receipt,
        verified: verifyConditionalSimulationReceipt(receipt, {
          plan,
          authorization,
          evidence: safeEvidence,
          proposal: null,
        }),
      }),
      timeline: proofTimeline({
        plan,
        authorization,
        evidence: safeEvidence,
        proposal: null,
        decision: "REVIEW",
        receipt,
      }),
      boundary: plan.boundary,
    });
  }

  if (!conditionSatisfied(plan, normalizedEvidence)) {
    const receipt = decisionReceipt({
      plan,
      authorization,
      evidence: normalizedEvidence,
      proposal: null,
      decision: "CONDITION_NOT_MET",
      code: "ABSOLUTE_BBO_CONDITION_NOT_MET",
      evaluatedAt,
    });
    return Object.freeze({
      schema_version: CONDITIONAL_ATTEMPT_SCHEMA,
      plan_id: plan.plan_id,
      plan_revision: plan.revision,
      state: "CONDITION_NOT_MET",
      decision: "CONDITION_NOT_MET",
      code: "ABSOLUTE_BBO_CONDITION_NOT_MET",
      reason:
        "The one checked market observation did not meet the saved absolute trigger.",
      recovery:
        "Nothing is watching. Authorize a new one-check simulation later if you want another observation.",
      evidence: normalizedEvidence,
      proposal: null,
      receipt: Object.freeze({
        ...receipt,
        verified: verifyConditionalSimulationReceipt(receipt, {
          plan,
          authorization,
          evidence: normalizedEvidence,
          proposal: null,
        }),
      }),
      timeline: proofTimeline({
        plan,
        authorization,
        evidence: normalizedEvidence,
        proposal: null,
        decision: "CONDITION_NOT_MET",
        receipt,
      }),
      boundary: plan.boundary,
    });
  }

  const proposal = createProposal(
    plan,
    scenario,
    normalizedEvidence,
  );
  const { decision, code, violations } = proposalOutcome(
    plan,
    proposal,
    normalizedEvidence,
  );
  const receipt = decisionReceipt({
    plan,
    authorization,
    evidence: normalizedEvidence,
    proposal,
    decision,
    code,
    evaluatedAt,
  });
  const verified = verifyConditionalSimulationReceipt(receipt, {
    plan,
    authorization,
    evidence: normalizedEvidence,
    proposal,
  });
  const trustedPass = decision === "PASS" && verified;
  return Object.freeze({
    schema_version: CONDITIONAL_ATTEMPT_SCHEMA,
    plan_id: plan.plan_id,
    plan_revision: plan.revision,
    state: trustedPass
      ? "WOULD_TRIGGER_SIMULATION"
      : decision === "BLOCK"
        ? "BLOCKED"
        : "REVIEW",
    decision:
      decision === "PASS" && !verified ? "REVIEW" : decision,
    code:
      decision === "PASS" && !verified
        ? "RECEIPT_UNVERIFIED"
        : code,
    reason: trustedPass
      ? "The exact simulated proposal fits the saved plan and the local Delta simulation receipt verifies."
      : decision === "BLOCK"
        ? violations.includes(
            "PRICE_OUTSIDE_EFFECTIVE_AUTHORIZED_LIMIT",
          )
          ? "The simulated proposal price is outside the effective limit that combines the absolute trigger with the observed-BBO slippage bound."
          : "The simulated agent proposal exceeds the user-authorized maximum."
        : "The simulated result could not be verified.",
    recovery:
      decision === "BLOCK"
        ? "Revise the proposal inside the saved boundary, then authorize a fresh simulation check."
        : trustedPass
          ? "Review the evidence only. This is not a live authorization and no order can be sent."
          : "Run a fresh simulation check. No order was submitted.",
    violations,
    evidence: normalizedEvidence,
    proposal,
    receipt: Object.freeze({ ...receipt, verified }),
    timeline: proofTimeline({
      plan,
      authorization,
      evidence: normalizedEvidence,
      proposal,
      decision:
        decision === "PASS" && !verified
          ? "REVIEW"
          : decision,
      receipt,
    }),
    boundary: plan.boundary,
  });
}

function proofTimeline({
  plan,
  authorization,
  evidence,
  proposal,
  decision,
  receipt,
}) {
  return Object.freeze([
    Object.freeze({
      step: "PLAN",
      detail: `Revision ${plan.revision} · ${plan.plan_digest}`,
    }),
    Object.freeze({
      step: "SIMULATION_AUTHORIZATION",
      detail: `${authorization.source} · expires ${authorization.expires_at}`,
    }),
    Object.freeze({
      step: "EVIDENCE",
      detail: `${evidence.source} · ${evidence.observed_at ?? "unavailable"}`,
    }),
    Object.freeze({
      step: "ABSOLUTE_TRIGGER",
      detail:
        `${plan.template.condition.reference} ` +
        `${plan.template.condition.operator} ` +
        plan.template.condition.value,
    }),
    Object.freeze({
      step: "OBSERVED_SLIPPAGE_BOUND",
      detail: proposal
        ? `${proposal.slippage_reference_price} → raw ${proposal.observed_slippage_bound} → effective ${proposal.authorized_limit_price} · ${proposal.max_slippage_bps} bps`
        : "not prepared",
    }),
    Object.freeze({
      step: "EXACT_PROPOSAL",
      detail: proposal?.proposal_digest ?? "not prepared",
    }),
    Object.freeze({
      step: "LOCAL_DELTA_SIMULATION",
      detail: decision,
    }),
    Object.freeze({
      step: "VERIFIED_RECEIPT",
      detail: receipt.receipt_digest,
    }),
    Object.freeze({
      step: "EXECUTION",
      detail: "LOCKED · no order submitted",
    }),
  ]);
}

export function conditionalFixtureEvidence(
  plan,
  scenario,
  { now = () => new Date() } = {},
) {
  assertPlanIntegrity(plan);
  if (!SCENARIOS.has(scenario)) {
    throw new Error("Conditional fixture scenario is invalid");
  }
  const observedAt = nowDate(now);
  const threshold = plan.template.condition.value;
  const lowerThan = (value) => {
    const decrement =
      compareDecimals(value, FIXTURE_TICK) > 0
        ? FIXTURE_TICK
        : MIN_DECIMAL_UNIT;
    if (compareDecimals(value, decrement) <= 0) {
      throw new Error(
        "Conditional fixture threshold is below supported precision",
      );
    }
    return subtractDecimals(value, decrement);
  };
  const higherThan = (value) =>
    addDecimals(value, FIXTURE_TICK);
  let bestBid;
  let bestAsk;
  if (plan.template.side === "BUY") {
    bestAsk =
      scenario === "not_met"
        ? higherThan(threshold)
        : threshold;
    bestBid =
      scenario === "not_met"
        ? threshold
        : lowerThan(threshold);
  } else {
    bestBid =
      scenario === "not_met"
        ? lowerThan(threshold)
        : threshold;
    bestAsk =
      scenario === "not_met"
        ? threshold
        : higherThan(threshold);
  }
  return Object.freeze({
    source: "fixture",
    product_id: plan.template.product_id,
    best_bid: bestBid,
    best_ask: bestAsk,
    observed_at: observedAt.toISOString(),
  });
}
