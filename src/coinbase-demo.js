import { digest } from "./evidence.js";
import { runBuiltInSimulation } from "./execution-pipeline.js";
import { runMandateAttemptLoop } from "./mandate/controller.js";
import { createExecutionPlan } from "./plan.js";

const LIVE_SAFETY_FIXTURE_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";

export const COINBASE_DEMO_INTENT =
  "Allocate up to 3,000 USDC to ETH only if ETH is at or below 3,000 USDC, estimated slippage is no more than 35 bps, fees are no more than 15 USDC, and post-trade ETH exposure stays at or below 10,000 USDC. Use one price-bounded IOC order. This mandate expires 15 minutes after authorization.";

export const COINBASE_DEMO_MANDATE = Object.freeze({
  schema_version: "delta.coinbase.conditional_allocation_mandate.v1",
  artifact_class: "SIMULATED_SHOWCASE",
  product_id: "ETH-USDC",
  side: "BUY",
  max_allocation_usdc: "3000.00",
  max_reference_price_usdc: "3000.00",
  max_slippage_bps: 35,
  max_fee_usdc: "15.00",
  max_post_trade_eth_exposure_usdc: "10000.00",
  order_type: "SOR_LIMIT_IOC",
  max_executions: 1,
  ttl_seconds: 900,
});

function decisionReceipt({
  verdict,
  disposition,
  candidate,
  failures,
  evaluatedAt,
}) {
  const payload = {
    schema_version: "delta.coinbase.simulated_decision_receipt.v1",
    artifact_class: "SIMULATED_NOT_PRODUCTION_DELTA",
    verdict,
    controller_disposition: disposition,
    mandate_digest: digest(COINBASE_DEMO_MANDATE),
    candidate_id: candidate.proposal_id,
    exact_payload_digest: candidate.exact_payload_digest,
    constraint_failure_ids: failures.map(({ id }) => id),
    evaluated_at: evaluatedAt,
  };
  return { ...payload, receipt_digest: digest(payload) };
}

export function verifyCoinbaseDemoReceipt(receipt) {
  if (
    receipt?.schema_version !==
      "delta.coinbase.simulated_decision_receipt.v1" ||
    typeof receipt.receipt_digest !== "string"
  ) {
    return false;
  }
  const {
    receipt_digest: claimedDigest,
    verified: _verificationAnnotation,
    ...payload
  } = receipt;
  return digest(payload) === claimedDigest;
}

function evaluateConditionalCandidate(candidate) {
  const checks = [
    {
      id: "allocation_cap",
      passed: Number(candidate.quote_size) <= 3000,
      reason: "proposed allocation exceeds 3,000 USDC",
    },
    {
      id: "price_threshold",
      passed: Number(candidate.reference_price) <= 3000,
      reason: "fixture market price is above the authorized 3,000 USDC threshold",
    },
    {
      id: "slippage_cap",
      passed: candidate.estimated_slippage_bps <= 35,
      reason: "estimated slippage exceeds 35 bps",
    },
    {
      id: "fee_cap",
      passed: Number(candidate.estimated_fee) <= 15,
      reason: "estimated fee exceeds 15 USDC",
    },
    {
      id: "portfolio_exposure_cap",
      passed: Number(candidate.post_trade_eth_exposure) <= 10000,
      reason: "post-trade ETH exposure exceeds 10,000 USDC",
    },
    {
      id: "expiry",
      passed:
        Date.parse(candidate.evaluated_at) <
        Date.parse(candidate.mandate_expires_at),
      reason: "mandate expired before evaluation",
    },
  ];
  return checks.filter(({ passed }) => !passed);
}

async function boundedRetryTrace() {
  const authorizationTime = "2026-07-27T18:00:00.000Z";
  const mandateExpiresAt = "2026-07-27T18:15:00.000Z";
  const result = await runMandateAttemptLoop({
    maxAttempts: 2,
    propose: async ({ attempt }) => {
      const values =
        attempt === 1
          ? {
              quote_size: "3300.00",
              reference_price: "3035.00",
              limit_price: "3045.00",
              estimated_slippage_bps: 60,
              estimated_fee: "18.00",
              post_trade_eth_exposure: "10500.00",
              evaluated_at: "2026-07-27T18:00:05.000Z",
            }
          : {
              quote_size: "2700.00",
              reference_price: "2995.00",
              limit_price: "3000.00",
              estimated_slippage_bps: 20,
              estimated_fee: "9.00",
              post_trade_eth_exposure: "9900.00",
              evaluated_at: "2026-07-27T18:00:10.000Z",
            };
      const payload = {
        product_id: "ETH-USDC",
        side: "BUY",
        order_configuration: {
          sor_limit_ioc: {
            quote_size: values.quote_size,
            limit_price: values.limit_price,
          },
        },
      };
      return {
        proposal_id: `conditional-candidate-${attempt}`,
        ...values,
        mandate_expires_at: mandateExpiresAt,
        exact_payload: payload,
        exact_payload_digest: digest(payload),
      };
    },
    evaluate: async (candidate) => {
      const failures = evaluateConditionalCandidate(candidate);
      if (failures.length > 0) {
        return {
          status: "failure",
          verified: false,
          proof: null,
          constraint_failures: failures.map((failure, index) => ({
            index,
            ...failure,
          })),
          receipt: decisionReceipt({
            verdict: "BLOCK",
            disposition: "RETRY",
            candidate,
            failures,
            evaluatedAt: candidate.evaluated_at,
          }),
        };
      }
      return {
        status: "success",
        verified: true,
        proof: {
          artifact_class: "SIMULATED_NOT_PRODUCTION_DELTA",
          proposal_digest: candidate.exact_payload_digest,
        },
        constraint_failures: [],
        receipt: decisionReceipt({
          verdict: "PASS",
          disposition: "EXECUTE",
          candidate,
          failures: [],
          evaluatedAt: candidate.evaluated_at,
        }),
      };
    },
    execute: async (candidate) => ({
      status: "SIMULATED_SINGLE_EXECUTION_ELIGIBLE",
      proposal_id: candidate.proposal_id,
      exact_payload_digest: candidate.exact_payload_digest,
      coinbase_create_invoked: false,
    }),
  });
  return {
    artifact_class: "ILLUSTRATIVE_CONTROLLER_TRACE",
    note:
      "Uses the real deterministic attempt-loop controller and labeled fixtures. No live price, portfolio, fee, or Coinbase claim is made.",
    human_mandate: COINBASE_DEMO_MANDATE,
    human_mandate_text: COINBASE_DEMO_INTENT,
    authorized_at: authorizationTime,
    mandate_expires_at: mandateExpiresAt,
    max_attempts: 2,
    terminal_status: result.status,
    attempts: result.attempts.map(
      ({ attempt, candidate, result: evaluated, disposition }) => ({
        attempt,
        proposal_id: candidate.proposal_id,
        exact_payload_digest: candidate.exact_payload_digest,
        evaluation_status: evaluated.status,
        constraint_failures: evaluated.constraint_failures,
        proof_present: Boolean(evaluated.proof),
        disposition,
        receipt: {
          ...evaluated.receipt,
          verified: verifyCoinbaseDemoReceipt(evaluated.receipt),
        },
        economics: {
          allocation_usdc: candidate.quote_size,
          reference_price_usdc: candidate.reference_price,
          limit_price_usdc: candidate.limit_price,
          estimated_slippage_bps: candidate.estimated_slippage_bps,
          estimated_fee_usdc: candidate.estimated_fee,
          post_trade_eth_exposure_usdc: candidate.post_trade_eth_exposure,
        },
      }),
    ),
    execution: result.execution,
  };
}

export async function runCoinbaseDemo() {
  const plan = await createExecutionPlan(LIVE_SAFETY_FIXTURE_INTENT);
  const simulated = await runBuiltInSimulation(plan, plan.policy_digest);
  const { record_digest: _priorDigest, ...base } = simulated;
  const record = {
    ...base,
    demo: {
      schema_version: "delta.coinbase.showcase.v1",
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
        "simulated_reconciliation",
      ],
      production_adapter_contract_present: true,
      real_delta_invoked: false,
      coinbase_contacted: false,
      coinbase_create_invoked: false,
      bounded_retry: await boundedRetryTrace(),
    },
  };
  return { ...record, record_digest: digest(record) };
}
