import { digest } from "./evidence.js";
import {
  addDecimals,
  compareDecimals,
  isSlippageWithinBps,
  parseDecimal,
} from "./decimal.js";
import { runBuiltInSimulation } from "./execution-pipeline.js";
import { runMandateAttemptLoop } from "./mandate/controller.js";
import { assertCoinbaseCreatePayload } from "./mandate/coinbase-solution.js";
import { createExecutionPlan } from "./plan.js";

const LIVE_SAFETY_FIXTURE_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";

export const COINBASE_DEMO_INTENT =
  "Allocate up to 3,000 USDC to ETH only if ETH is at or below 3,000 USDC, estimated slippage is no more than 35 bps, fees are no more than 15 USDC, and post-trade ETH exposure stays at or below 10,000 USDC. Use one price-bounded IOC order, make at most one action eligible in this simulated trace, and expire the mandate 15 minutes after authorization.";

export const COINBASE_DEMO_MANDATE = Object.freeze({
  schema_version: "delta.coinbase.conditional_allocation_mandate.v2",
  artifact_class: "SIMULATED_SHOWCASE",
  product_id: "ETH-USDC",
  side: "BUY",
  max_allocation_usdc: "3000.00",
  max_market_price_usdc: "3000.00",
  max_limit_price_usdc: "3000.00",
  max_slippage_bps: 35,
  max_fee_usdc: "15.00",
  max_post_trade_eth_exposure_usdc: "10000.00",
  order_type: "SOR_LIMIT_IOC",
  max_executions: 1,
  ttl_seconds: 900,
});

const RECEIPT_FIELDS = Object.freeze([
  "schema_version",
  "artifact_class",
  "verdict",
  "mandate_digest",
  "authorization_digest",
  "authorized_at",
  "mandate_expires_at",
  "candidate_id",
  "exact_payload_digest",
  "evidence_digest",
  "constraint_failures",
  "evaluator",
  "evaluated_at",
  "receipt_digest",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactFields(value, expected, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const fields = [...expected].sort();
  if (
    actual.length !== fields.length ||
    actual.some((field, index) => field !== fields[index])
  ) {
    throw new Error(`${name} has an invalid field set`);
  }
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function authorizationDigest({ authorizedAt, expiresAt }) {
  return digest({
    schema_version: "delta.coinbase.simulated_authorization_instance.v1",
    mandate_digest: digest(COINBASE_DEMO_MANDATE),
    authorized_at: authorizedAt,
    expires_at: expiresAt,
    max_executions: COINBASE_DEMO_MANDATE.max_executions,
  });
}

function assertShowcaseEvidence(evidence) {
  assertExactFields(
    evidence,
    [
      "schema_version",
      "artifact_class",
      "collected_by",
      "market",
      "preview",
      "portfolio",
    ],
    "Showcase evidence",
  );
  if (
    evidence.schema_version !== "delta.coinbase.showcase_evidence.v2" ||
    evidence.artifact_class !== "SIMULATED_FIXTURE_NOT_COINBASE" ||
    evidence.collected_by !== "EXTERNAL_CONTROLLER_FIXTURE"
  ) {
    throw new Error("Showcase evidence provenance is invalid");
  }
  assertExactFields(
    evidence.market,
    [
      "product_id",
      "best_ask",
      "status",
      "trading_disabled",
      "is_disabled",
      "observed_at",
    ],
    "Showcase market evidence",
  );
  assertExactFields(
    evidence.preview,
    [
      "preview_id",
      "request_digest",
      "est_average_filled_price",
      "commission_total",
    ],
    "Showcase Preview evidence",
  );
  assertExactFields(
    evidence.portfolio,
    ["pre_trade_eth_exposure", "observed_at"],
    "Showcase portfolio evidence",
  );
  for (const [value, label] of [
    [evidence.market.best_ask, "market best ask"],
    [evidence.preview.est_average_filled_price, "estimated fill price"],
    [evidence.preview.commission_total, "commission total"],
    [evidence.portfolio.pre_trade_eth_exposure, "portfolio exposure"],
  ]) {
    parseDecimal(value, label);
  }
  if (
    !isCanonicalIsoTimestamp(evidence.market.observed_at) ||
    !isCanonicalIsoTimestamp(evidence.portfolio.observed_at) ||
    typeof evidence.market.trading_disabled !== "boolean" ||
    typeof evidence.market.is_disabled !== "boolean"
  ) {
    throw new Error("Showcase evidence types are invalid");
  }
}

function authorizationWindowIsValid(candidate) {
  if (
    !isCanonicalIsoTimestamp(candidate?.authorized_at) ||
    !isCanonicalIsoTimestamp(candidate?.mandate_expires_at) ||
    !isCanonicalIsoTimestamp(candidate?.evaluated_at)
  ) {
    return false;
  }
  const authorizedAt = Date.parse(candidate.authorized_at);
  const expiresAt = Date.parse(candidate.mandate_expires_at);
  const evaluatedAt = Date.parse(candidate.evaluated_at);
  return (
    expiresAt ===
      authorizedAt + COINBASE_DEMO_MANDATE.ttl_seconds * 1000 &&
    evaluatedAt >= authorizedAt &&
    evaluatedAt < expiresAt
  );
}

function decisionReceipt({
  verdict,
  candidate,
  failures,
  evaluatedAt,
}) {
  const mandateDigest = digest(COINBASE_DEMO_MANDATE);
  const boundAuthorizationDigest = authorizationDigest({
    authorizedAt: candidate.authorized_at,
    expiresAt: candidate.mandate_expires_at,
  });
  const payload = {
    schema_version: "delta.coinbase.simulated_decision_receipt.v2",
    artifact_class: "SIMULATED_NOT_PRODUCTION_DELTA",
    verdict,
    mandate_digest: mandateDigest,
    authorization_digest: boundAuthorizationDigest,
    authorized_at: candidate.authorized_at,
    mandate_expires_at: candidate.mandate_expires_at,
    candidate_id: candidate.proposal_id,
    exact_payload_digest: candidate.exact_payload_digest,
    evidence_digest: candidate.evidence_digest,
    constraint_failures: failures.map(({ id, reason }) => ({ id, reason })),
    evaluator: "delta-coinbase-showcase-evaluator.v3",
    evaluated_at: evaluatedAt,
  };
  return { ...payload, receipt_digest: digest(payload) };
}

export function verifyCoinbaseDemoReceipt(receipt) {
  try {
    const {
      verified: _verificationAnnotation,
      receipt_digest: claimedDigest,
      ...payload
    } = receipt;
    assertExactFields(
      { ...payload, receipt_digest: claimedDigest },
      RECEIPT_FIELDS,
      "Showcase receipt",
    );
    if (
      receipt.schema_version !==
        "delta.coinbase.simulated_decision_receipt.v2" ||
      receipt.artifact_class !== "SIMULATED_NOT_PRODUCTION_DELTA" ||
      receipt.evaluator !== "delta-coinbase-showcase-evaluator.v3" ||
      !["BLOCK", "PASS"].includes(receipt.verdict) ||
      typeof claimedDigest !== "string" ||
      !Array.isArray(receipt.constraint_failures)
    ) {
      return false;
    }
    for (const failure of receipt.constraint_failures) {
      assertExactFields(failure, ["id", "reason"], "Receipt failure");
      if (
        typeof failure.id !== "string" ||
        typeof failure.reason !== "string"
      ) {
        return false;
      }
    }
    return digest(payload) === claimedDigest;
  } catch {
    return false;
  }
}

export function verifyCoinbaseShowcaseAttempt(attempt) {
  const receipt = attempt?.receipt;
  try {
    const mandateDigest = digest(COINBASE_DEMO_MANDATE);
    const boundAuthorizationDigest = authorizationDigest({
      authorizedAt: attempt?.authorized_at,
      expiresAt: attempt?.mandate_expires_at,
    });
    if (
      !verifyCoinbaseDemoReceipt(receipt) ||
      mandateDigest !== receipt.mandate_digest ||
      boundAuthorizationDigest !== receipt.authorization_digest ||
      attempt?.authorized_at !== receipt.authorized_at ||
      attempt?.mandate_expires_at !== receipt.mandate_expires_at ||
      !authorizationWindowIsValid(attempt) ||
      digest(attempt?.exact_payload) !== attempt?.exact_payload_digest ||
      attempt?.exact_payload_digest !== receipt.exact_payload_digest ||
      digest(attempt?.evidence) !== attempt?.evidence_digest ||
      attempt?.evidence_digest !== receipt.evidence_digest ||
      attempt?.proposal_id !== receipt.candidate_id ||
      attempt?.evaluated_at !== receipt.evaluated_at
    ) {
      return false;
    }
    const reevaluated = evaluateCoinbaseShowcaseCandidate(attempt);
    const failures = reevaluated.failures.map(({ id, reason }) => ({
      id,
      reason,
    }));
    const recordedFailures = (attempt?.constraint_failures ?? []).map(
      ({ id, reason }) => ({ id, reason }),
    );
    if (
      JSON.stringify(failures) !== JSON.stringify(recordedFailures) ||
      JSON.stringify(failures) !==
        JSON.stringify(receipt.constraint_failures)
    ) {
      return false;
    }
    return failures.length > 0
      ? receipt.verdict === "BLOCK"
      : receipt.verdict === "PASS";
  } catch {
    return false;
  }
}

function slippageBps(fillPrice, referencePrice) {
  const fill = parseDecimal(fillPrice, "fixture estimated fill");
  const reference = parseDecimal(referencePrice, "fixture reference price");
  const scale = Math.max(fill.scale, reference.scale);
  const fillScaled =
    fill.coefficient * 10n ** BigInt(scale - fill.scale);
  const referenceScaled =
    reference.coefficient * 10n ** BigInt(scale - reference.scale);
  if (referenceScaled <= 0n || fillScaled <= 0n) {
    throw new Error("fixture prices must be positive");
  }
  if (fillScaled <= referenceScaled) return 0;
  const numerator = (fillScaled - referenceScaled) * 10_000n;
  const quotient = numerator / referenceScaled;
  return Number(
    numerator % referenceScaled === 0n ? quotient : quotient + 1n,
  );
}

function candidateEconomics(candidate) {
  const configuration =
    candidate.exact_payload?.order_configuration?.sor_limit_ioc;
  const evidence = candidate.evidence;
  return {
    allocation_usdc: configuration?.quote_size,
    reference_price_usdc: evidence?.market?.best_ask,
    limit_price_usdc: configuration?.limit_price,
    estimated_fill_price_usdc:
      evidence?.preview?.est_average_filled_price,
    estimated_slippage_bps: slippageBps(
      evidence?.preview?.est_average_filled_price,
      evidence?.market?.best_ask,
    ),
    estimated_fee_usdc: evidence?.preview?.commission_total,
    pre_trade_eth_exposure_usdc:
      evidence?.portfolio?.pre_trade_eth_exposure,
    post_trade_eth_exposure_usdc: addDecimals(
      evidence?.portfolio?.pre_trade_eth_exposure,
      configuration?.quote_size,
    ),
  };
}

function evaluateCoinbaseShowcaseCandidateStrict(candidate) {
  const schemaChecks = [];
  try {
    assertCoinbaseCreatePayload(candidate?.exact_payload);
    schemaChecks.push({
      id: "closed_payload_schema",
      passed: true,
      reason: "proposal matches the exact supported Coinbase Create field set",
    });
  } catch (error) {
    schemaChecks.push({
      id: "closed_payload_schema",
      passed: false,
      reason: `unsupported Coinbase Create shape: ${error.message}`,
    });
  }
  try {
    assertShowcaseEvidence(candidate?.evidence);
    schemaChecks.push({
      id: "closed_evidence_schema",
      passed: true,
      reason: "evidence matches the controller-owned fixture schema",
    });
  } catch (error) {
    schemaChecks.push({
      id: "closed_evidence_schema",
      passed: false,
      reason: `unsupported evidence shape: ${error.message}`,
    });
  }
  const schemaFailures = schemaChecks.filter(({ passed }) => !passed);
  if (schemaFailures.length > 0) {
    return {
      checks: schemaChecks,
      economics: null,
      failures: schemaFailures,
    };
  }
  const configuration =
    candidate.exact_payload?.order_configuration?.sor_limit_ioc;
  const evidence = candidate.evidence;
  const economics = candidateEconomics(candidate);
  const checks = [
    ...schemaChecks,
    {
      id: "authorization_window",
      passed: authorizationWindowIsValid(candidate),
      reason:
        "authorization, evaluation, or exact 15-minute expiry window is invalid",
    },
    {
      id: "evidence_freshness",
      passed:
        evidence.market.observed_at === candidate.evaluated_at &&
        evidence.portfolio.observed_at === candidate.evaluated_at,
      reason:
        "market or portfolio evidence is not fresh at the evaluation time",
    },
    {
      id: "product",
      passed:
        candidate.exact_payload?.product_id ===
          COINBASE_DEMO_MANDATE.product_id &&
        evidence?.market?.product_id === COINBASE_DEMO_MANDATE.product_id,
      reason: "proposal or market evidence targets the wrong product",
    },
    {
      id: "side",
      passed: candidate.exact_payload?.side === COINBASE_DEMO_MANDATE.side,
      reason: "proposal side differs from the authorized side",
    },
    {
      id: "order_type",
      passed:
        configuration != null &&
        Object.keys(candidate.exact_payload?.order_configuration ?? {})
          .length === 1,
      reason: "proposal is not exactly one SOR limit IOC configuration",
    },
    {
      id: "preview_binding",
      passed:
        typeof candidate.exact_payload?.preview_id === "string" &&
        candidate.exact_payload.preview_id.length > 0 &&
        candidate.exact_payload.preview_id ===
          evidence?.preview?.preview_id &&
        evidence?.preview?.request_digest ===
          digest({
            product_id: candidate.exact_payload?.product_id,
            side: candidate.exact_payload?.side,
            order_configuration:
              candidate.exact_payload?.order_configuration,
          }),
      reason: "Preview evidence is not bound to the exact prospective order",
    },
    {
      id: "market_eligibility",
      passed:
        evidence?.market?.status === "online" &&
        evidence?.market?.trading_disabled === false &&
        evidence?.market?.is_disabled === false,
      reason: "fixture product status is not eligible for trading",
    },
    {
      id: "allocation_cap",
      passed:
        compareDecimals(
          economics.allocation_usdc,
          COINBASE_DEMO_MANDATE.max_allocation_usdc,
        ) <= 0,
      reason: "proposed allocation exceeds 3,000 USDC",
    },
    {
      id: "price_threshold",
      passed:
        compareDecimals(
          economics.reference_price_usdc,
          COINBASE_DEMO_MANDATE.max_market_price_usdc,
        ) <= 0,
      reason: "fixture market price is above the authorized 3,000 USDC threshold",
    },
    {
      id: "limit_price_cap",
      passed:
        compareDecimals(
          economics.limit_price_usdc,
          COINBASE_DEMO_MANDATE.max_limit_price_usdc,
        ) <= 0,
      reason: "order limit could fill above the authorized 3,000 USDC threshold",
    },
    {
      id: "slippage_cap",
      passed: isSlippageWithinBps(
        economics.estimated_fill_price_usdc,
        economics.reference_price_usdc,
        COINBASE_DEMO_MANDATE.max_slippage_bps,
        "BUY",
      ),
      reason: "estimated slippage exceeds 35 bps",
    },
    {
      id: "fee_cap",
      passed:
        compareDecimals(
          economics.estimated_fee_usdc,
          COINBASE_DEMO_MANDATE.max_fee_usdc,
        ) <= 0,
      reason: "estimated fee exceeds 15 USDC",
    },
    {
      id: "portfolio_exposure_cap",
      passed:
        compareDecimals(
          economics.post_trade_eth_exposure_usdc,
          COINBASE_DEMO_MANDATE.max_post_trade_eth_exposure_usdc,
        ) <= 0,
      reason: "post-trade ETH exposure exceeds 10,000 USDC",
    },
    {
      id: "expiry",
      passed: authorizationWindowIsValid(candidate),
      reason: "mandate expired or evaluation predates authorization",
    },
  ];
  return {
    checks,
    economics,
    failures: checks.filter(({ passed }) => !passed),
  };
}

export function evaluateCoinbaseShowcaseCandidate(candidate) {
  try {
    return evaluateCoinbaseShowcaseCandidateStrict(candidate);
  } catch {
    const malformed = {
      id: "malformed_candidate_or_evidence",
      passed: false,
      reason:
        "proposal or fixture evidence is malformed and cannot be evaluated",
    };
    return {
      checks: [malformed],
      economics: null,
      failures: [malformed],
    };
  }
}

async function boundedRetryTrace({ now = () => new Date() } = {}) {
  const startedAt = now();
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
    throw new Error("Coinbase showcase clock must return a valid Date");
  }
  const authorizationTime = startedAt.toISOString();
  const mandateExpiresAt = new Date(
    startedAt.getTime() + COINBASE_DEMO_MANDATE.ttl_seconds * 1000,
  ).toISOString();
  const attemptTimes = [
    new Date(startedAt.getTime() + 5_000).toISOString(),
    new Date(startedAt.getTime() + 10_000).toISOString(),
  ];
  const attemptFixtures = [
    {
      quote_size: "3300.00",
      reference_price: "3035.00",
      limit_price: "3060.00",
      estimated_fill_price: "3053.21",
      estimated_fee: "18.00",
      pre_trade_eth_exposure: "7200.00",
      evaluated_at: attemptTimes[0],
    },
    {
      quote_size: "2700.00",
      reference_price: "2994.00",
      limit_price: "3000.00",
      estimated_fill_price: "2999.98",
      estimated_fee: "9.00",
      pre_trade_eth_exposure: "7200.00",
      evaluated_at: attemptTimes[1],
    },
  ];
  const result = await runMandateAttemptLoop({
    maxAttempts: 2,
    propose: async ({ attempt }) => {
      const values = attemptFixtures[attempt - 1];
      const payload = {
        client_order_id: `delta-showcase-candidate-${attempt}`,
        product_id: "ETH-USDC",
        side: "BUY",
        preview_id: `fixture-preview-${attempt}`,
        order_configuration: {
          sor_limit_ioc: {
            quote_size: values.quote_size,
            limit_price: values.limit_price,
          },
        },
      };
      return {
        proposal_id: `conditional-candidate-${attempt}`,
        exact_payload: payload,
        exact_payload_digest: digest(payload),
      };
    },
    collectEvidence: async ({ attempt, proposal }) => {
      const values = attemptFixtures[attempt - 1];
      const payload = proposal.exact_payload;
      const evidence = {
        schema_version: "delta.coinbase.showcase_evidence.v2",
        artifact_class: "SIMULATED_FIXTURE_NOT_COINBASE",
        collected_by: "EXTERNAL_CONTROLLER_FIXTURE",
        market: {
          product_id: payload.product_id,
          best_ask: values.reference_price,
          status: "online",
          trading_disabled: false,
          is_disabled: false,
          observed_at: values.evaluated_at,
        },
        preview: {
          preview_id: payload.preview_id,
          request_digest: digest({
            product_id: payload.product_id,
            side: payload.side,
            order_configuration: payload.order_configuration,
          }),
          est_average_filled_price: values.estimated_fill_price,
          commission_total: values.estimated_fee,
        },
        portfolio: {
          pre_trade_eth_exposure: values.pre_trade_eth_exposure,
          observed_at: values.evaluated_at,
        },
      };
      return {
        ...proposal,
        authorized_at: authorizationTime,
        evaluated_at: values.evaluated_at,
        mandate_expires_at: mandateExpiresAt,
        evidence,
        evidence_digest: digest(evidence),
      };
    },
    evaluate: async (candidate) => {
      const evaluated = evaluateCoinbaseShowcaseCandidate(candidate);
      const { failures } = evaluated;
      if (failures.length > 0) {
        return {
          status: "failure",
          verified: false,
          proof: null,
          checks: evaluated.checks,
          economics: evaluated.economics,
          constraint_failures: failures.map((failure, index) => ({
            index,
            ...failure,
          })),
          receipt: decisionReceipt({
            verdict: "BLOCK",
            candidate,
            failures,
            evaluatedAt: candidate.evaluated_at,
          }),
        };
      }
      return {
        status: "success",
        verified: true,
        proof_verification: {
          verified: true,
          cryptographically_verified: false,
          method: "SIMULATED_BINDING_CHECK_ONLY",
          verifier_identity: "SIMULATED_LOCAL_TEST_DOUBLE",
          program_id: null,
        },
        proof: {
          artifact_class: "SIMULATED_NOT_PRODUCTION_DELTA",
          mandate_digest: digest(COINBASE_DEMO_MANDATE),
          proposal_digest: candidate.exact_payload_digest,
          evidence_digest: candidate.evidence_digest,
        },
        checks: evaluated.checks,
        economics: evaluated.economics,
        constraint_failures: [],
        receipt: decisionReceipt({
          verdict: "PASS",
          candidate,
          failures: [],
          evaluatedAt: candidate.evaluated_at,
        }),
      };
    },
    execute: async (candidate, evaluated) => {
      const candidateAttempt = {
        proposal_id: candidate.proposal_id,
        authorized_at: candidate.authorized_at,
        evaluated_at: candidate.evaluated_at,
        mandate_expires_at: candidate.mandate_expires_at,
        exact_payload: candidate.exact_payload,
        exact_payload_digest: candidate.exact_payload_digest,
        evidence: candidate.evidence,
        evidence_digest: candidate.evidence_digest,
        constraint_failures: evaluated.constraint_failures,
        receipt: evaluated.receipt,
      };
      if (
        !verifyCoinbaseShowcaseAttempt(candidateAttempt) ||
        evaluated.receipt?.verdict !== "PASS" ||
        evaluated.proof_verification?.verified !== true ||
        evaluated.proof_verification?.cryptographically_verified !== false ||
        evaluated.proof?.proposal_digest !== candidate.exact_payload_digest ||
        evaluated.proof?.evidence_digest !== candidate.evidence_digest
      ) {
        throw new Error("Simulated execution gate rejected unbound evidence");
      }
      return {
        status: "SIMULATED_SINGLE_EXECUTION_ELIGIBLE",
        proposal_id: candidate.proposal_id,
        exact_payload_digest: candidate.exact_payload_digest,
        evidence_digest: candidate.evidence_digest,
        receipt_digest: evaluated.receipt.receipt_digest,
        gate:
          "PASS + receipt verified + proposal digest match + evidence digest match",
        simulated_trace_eligibilities: 1,
        durable_one_time_grant_issued: false,
        external_executor_invoked: false,
        coinbase_create_invoked: false,
      };
    },
  });
  return {
    artifact_class: "ILLUSTRATIVE_CONTROLLER_TRACE",
    note:
      "Uses the real deterministic attempt-loop controller. Each attempt receives a new labeled market, Preview, and portfolio fixture; the agent does not author that evidence. No live Coinbase claim is made.",
    human_mandate: COINBASE_DEMO_MANDATE,
    human_mandate_text: COINBASE_DEMO_INTENT,
    authorized_at: authorizationTime,
    mandate_expires_at: mandateExpiresAt,
    max_attempts: 2,
    terminal_status: "SIMULATED_GATE_REACHED",
    controller_terminal_status: result.status,
    attempts: result.attempts.map(
      ({ attempt, candidate, result: evaluated, disposition }) => {
        const attemptRecord = {
          attempt,
          proposal_id: candidate.proposal_id,
          authorized_at: candidate.authorized_at,
          evaluated_at: candidate.evaluated_at,
          mandate_expires_at: candidate.mandate_expires_at,
          exact_payload: candidate.exact_payload,
          exact_payload_digest: candidate.exact_payload_digest,
          evidence: candidate.evidence,
          evidence_digest: candidate.evidence_digest,
          evaluation_status: evaluated.status,
          checks: evaluated.checks,
          constraint_failures: evaluated.constraint_failures,
          proof_present: Boolean(evaluated.proof),
          proof_verification: evaluated.proof_verification ?? null,
          disposition,
          receipt: evaluated.receipt,
          economics: evaluated.economics,
        };
        return {
          ...attemptRecord,
          receipt: {
            ...evaluated.receipt,
            verified: verifyCoinbaseShowcaseAttempt(attemptRecord),
          },
        };
      },
    ),
    execution: result.execution,
  };
}

export async function runCoinbaseDemo({ now } = {}) {
  const plan = await createExecutionPlan(LIVE_SAFETY_FIXTURE_INTENT);
  const simulated = await runBuiltInSimulation(plan, plan.policy_digest);
  const trace = await boundedRetryTrace({ now });
  const passedAttempt = trace.attempts.at(-1);
  const record = {
    schema_version: "delta.coinbase.conditional_showcase_record.v2",
    artifact_class: "SIMULATED_NOT_PRODUCTION_DELTA",
    status: trace.execution.status,
    generated_at: trace.authorized_at,
    mandate: trace.human_mandate,
    mandate_digest: passedAttempt.receipt.mandate_digest,
    authorization: {
      status: "USER_REQUESTED_SIMULATION_ONLY",
      live_trade_authorized: false,
      authorization_digest: passedAttempt.receipt.authorization_digest,
      authorized_at: trace.authorized_at,
      expires_at: trace.mandate_expires_at,
    },
    decision: {
      verdict: passedAttempt.receipt.verdict,
      receipt: passedAttempt.receipt,
    },
    execution: {
      ...trace.execution,
      controller_gate_invoked: true,
      coinbase_adapter_invoked: false,
      order_submitted: false,
      money_moved: false,
    },
    technical_validation: {
      schema_version: "delta.coinbase.hidden_safety_fixture_validation.v1",
      note:
        "A separate 5-USDC safety fixture exercises the production-shaped policy, intent, proposal, verifier, proof, exact-payload binding, and one-use in-memory gate. It stops at execution eligibility and does not fabricate a Coinbase fill.",
      status: simulated.status,
      delta: {
        status: simulated.delta.status,
        verifier_confirmed: simulated.delta.verifier_confirmed,
        proof_present: simulated.delta.proof_present,
      },
      execution_adapter_contract_exercised:
        simulated.execution.adapter_invoked === true,
      exact_payload_gate_exercised:
        simulated.simulation.exact_payload_verified === true,
      one_time_gate_consumed:
        simulated.execution.one_time_gate_consumed === true,
      reconciliation_check: "NOT_RUN_NO_COINBASE_ORDER",
      real_system_contacted: false,
    },
    demo: {
      schema_version: "delta.coinbase.showcase.v2",
      credential_mode: "NO_CREDENTIALS",
      authorization_note:
        "The conditional allocation is a labeled simulation. The separate future live-test profile remains capped at 5 USDC and requires new user authorization.",
      showcase_mandate: COINBASE_DEMO_MANDATE,
      showcase_mandate_text: COINBASE_DEMO_INTENT,
      lifecycle: [
        "natural_language_intent",
        "closed_policy",
        "deterministic_proposal",
        "preview_evidence",
        "delta_mandate_evaluation",
        "verified_simulated_proof",
        "exact_payload_execution_gate",
      ],
      production_adapter_contract_present: true,
      real_delta_invoked: false,
      coinbase_contacted: false,
      coinbase_create_invoked: false,
      bounded_retry: trace,
    },
  };
  return { ...record, record_digest: digest(record) };
}
