import { digest } from "./evidence.js";
import { runBuiltInSimulation } from "./execution-pipeline.js";
import { runMandateAttemptLoop } from "./mandate/controller.js";
import { createExecutionPlan } from "./plan.js";

export const COINBASE_DEMO_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";

async function boundedRetryTrace() {
  const result = await runMandateAttemptLoop({
    maxAttempts: 2,
    propose: async ({ attempt }) => ({
      proposal_id: `demo-candidate-${attempt}`,
      quote_size: "5.00",
      estimated_commission: attempt === 1 ? "0.75" : "0.25",
      exact_payload_digest: digest({
        product_id: "ETH-USDC",
        quote_size: "5.00",
        estimated_commission: attempt === 1 ? "0.75" : "0.25",
      }),
    }),
    evaluate: async (candidate, attempt) =>
      attempt === 1
        ? {
            status: "failure",
            verified: false,
            proof: null,
            constraint_failures: [
              {
                index: 11,
                reason: "estimated commission exceeds the authorized cap",
              },
            ],
          }
        : {
            status: "success",
            verified: true,
            proof: {
              artifact_class: "SIMULATED",
              proposal_digest: candidate.exact_payload_digest,
            },
            constraint_failures: [],
          },
    execute: async (candidate) => ({
      status: "SIMULATED_EXECUTION_BOUNDARY_REACHED",
      proposal_id: candidate.proposal_id,
      exact_payload_digest: candidate.exact_payload_digest,
      coinbase_create_invoked: false,
    }),
  });
  return {
    artifact_class: "ILLUSTRATIVE_CONTROLLER_TRACE",
    note:
      "Uses the real deterministic attempt-loop controller with synthetic candidates; the full Coinbase simulation remains a single-candidate run.",
    max_attempts: 2,
    terminal_status: result.status,
    attempts: result.attempts.map(({ attempt, candidate, result: evaluated, disposition }) => ({
      attempt,
      proposal_id: candidate.proposal_id,
      exact_payload_digest: candidate.exact_payload_digest,
      evaluation_status: evaluated.status,
      constraint_failures: evaluated.constraint_failures,
      proof_present: Boolean(evaluated.proof),
      disposition,
    })),
    execution: result.execution,
  };
}

export async function runCoinbaseDemo() {
  const plan = await createExecutionPlan(COINBASE_DEMO_INTENT);
  const simulated = await runBuiltInSimulation(plan, plan.policy_digest);
  const { record_digest: _priorDigest, ...base } = simulated;
  const record = {
    ...base,
    demo: {
      schema_version: "delta.coinbase.showcase.v1",
      credential_mode: "NO_CREDENTIALS",
      authorization_note:
        "The pinned demo fixture supplies its displayed policy digest automatically. Live and Preview paths still require a separate user-authored authorization.",
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
