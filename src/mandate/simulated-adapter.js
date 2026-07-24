import { randomUUID } from "node:crypto";
import { digest } from "../evidence.js";
import { extractSimulatedCoinbaseEvidence } from "./coinbase-evidence.js";
import {
  COINBASE_POLICY_CONSTRAINTS,
  COINBASE_SPOT_POLICY_SOURCE,
  toDeltaWireAttributes,
} from "./coinbase-policy.js";
import { buildCoinbaseSolution } from "./coinbase-solution.js";

function clone(value) {
  return structuredClone(value);
}

function constraintFailure(index, reason) {
  return {
    index,
    pretty_expr: COINBASE_POLICY_CONSTRAINTS[index],
    reason,
  };
}

export function evaluateSimulatedCoinbasePolicy(parameters, evidence) {
  const checks = [
    [
      evidence.category === "COINBASE_ADVANCED_SPOT_ORDER",
      "the proposal is not a Coinbase Advanced spot order",
    ],
    [
      evidence.environment === "production",
      "the proposal targets the wrong environment",
    ],
    [
      evidence.execution_domain === "coinbase_custodial_ledger",
      "the proposal targets the wrong execution domain",
    ],
    [
      evidence.product_id === parameters.product_id,
      "the product differs from the authorized product",
    ],
    [
      evidence.base_asset === parameters.base_asset,
      "the base asset differs from the authorized asset",
    ],
    [
      evidence.quote_asset === parameters.quote_asset,
      "the quote asset differs from the authorized asset",
    ],
    [
      evidence.side === parameters.side,
      "the trade side differs from the authorized side",
    ],
    [
      evidence.order_type === "sor_limit_ioc",
      "the order is not the required bounded SOR limit order",
    ],
    [
      evidence.time_in_force === "ioc",
      "the order is not immediate-or-cancel",
    ],
    [
      evidence.quote_size_microunits ===
        parameters.exact_quote_size_microunits,
      "the quote size differs from the exact authorized amount",
    ],
    [
      evidence.slippage_bps <= parameters.max_slippage_bps,
      "estimated slippage exceeds the authorized cap",
    ],
    [
      evidence.commission_microunits <=
        parameters.max_commission_microunits,
      "estimated commission exceeds the authorized cap",
    ],
    [
      evidence.all_in_debit_microunits <=
        parameters.max_all_in_debit_microunits,
      "estimated all-in debit exceeds the authorized cap",
    ],
    [
      evidence.portfolio_fingerprint ===
        parameters.portfolio_fingerprint,
      "the Coinbase portfolio differs from the authorized portfolio",
    ],
    [
      evidence.credential_fingerprint ===
        parameters.credential_fingerprint,
      "the Coinbase credential differs from the authorized credential",
    ],
    [
      evidence.evaluated_at_epoch_ms <= parameters.expires_at_epoch_ms,
      "the human authorization expired before evaluation",
    ],
    [
      evidence.preview_present === true,
      "Coinbase preview evidence is missing",
    ],
    [
      evidence.preview_request_matches_create === true,
      "the Coinbase Preview request does not match the Create payload",
    ],
    [
      evidence.preview_id === evidence.create_preview_id,
      "the Coinbase preview ID does not match the Create payload",
    ],
    [
      evidence.create_payload_digest ===
        evidence.claimed_create_payload_digest,
      "the exact Coinbase Create payload digest does not match the proposal",
    ],
    [
      evidence.preview_request_digest ===
        evidence.claimed_preview_request_digest,
      "the Coinbase Preview request digest does not match the proposal",
    ],
    [
      evidence.market_status === "online",
      "the Coinbase market is not online",
    ],
    [
      evidence.trading_disabled === false,
      "Coinbase has disabled trading for the product",
    ],
    [
      evidence.product_disabled === false,
      "the Coinbase product is disabled",
    ],
  ];

  return checks.flatMap(([passed, reason], index) =>
    passed ? [] : [constraintFailure(index, reason)],
  );
}

export class SimulatedMandateAdapter {
  constructor({
    now = () => new Date(),
    extractEvidence = extractSimulatedCoinbaseEvidence,
  } = {}) {
    this.name = "simulated-delta-mandate";
    this.securityClass = "simulation-only";
    this.now = now;
    this.extractEvidence = extractEvidence;
    this.policies = new Map();
    this.intents = new Map();
  }

  async submitPolicy(source) {
    if (source !== COINBASE_SPOT_POLICY_SOURCE) {
      throw new Error("The simulator accepts only the pinned Coinbase V1 policy");
    }
    const policyId = `sim-policy-${digest(source)}`;
    this.policies.set(policyId, source);
    return { policyId };
  }

  async authorizeIntent({ policyId, parameters, authorization }) {
    if (!this.policies.has(policyId)) {
      throw new Error("Policy not found");
    }
    const intentId = randomUUID();
    const intent = {
      id: intentId,
      policy_id: policyId,
      attrs: toDeltaWireAttributes(parameters),
    };
    this.intents.set(intentId, {
      intent,
      parameters: clone(parameters),
      authorization: clone(authorization ?? null),
      status: { status: "open" },
      verification: null,
      proof: null,
    });
    return { intentId };
  }

  async prepareProposal({ actionRecord }) {
    return { solution: buildCoinbaseSolution(actionRecord) };
  }

  async submitProposal({ intentId, solution }) {
    const stored = this.intents.get(intentId);
    if (!stored) throw new Error("Intent not found");
    if (stored.status.status !== "open") {
      throw new Error("Intent already has a proposal");
    }
    const proposal = { solution };
    stored.status = { status: "processing", proposal };

    let evidence;
    try {
      evidence = this.extractEvidence(solution, this.now());
    } catch {
      stored.status = { status: "open" };
      return;
    }
    const failures = evaluateSimulatedCoinbasePolicy(
      stored.parameters,
      evidence,
    );
    if (failures.length > 0) {
      const reason = failures.map((failure) => failure.reason).join("; ");
      stored.status = {
        status: "failure",
        intent_id: intentId,
        reason,
        proposal,
        evidence,
        constraint_failures: failures,
      };
      stored.verification = {
        outcome: "failure",
        reason,
        proposal,
      };
      return;
    }

    stored.status = {
      status: "success",
      intent_id: intentId,
      proposal,
      evidence,
    };
    stored.verification = {
      outcome: "success",
      intent: clone(stored.intent),
      proposal,
    };
    stored.proof = {
      sp1_proof: "SIMULATED_NO_SP1_PROOF",
      evidence: toDeltaWireAttributes(evidence),
      signed_intent: {
        intent: clone(stored.intent),
        signature: { Simulated: "NOT_A_REAL_DELTA_SIGNATURE" },
      },
      proposal,
    };
  }

  async getStatus({ intentId }) {
    const stored = this.intents.get(intentId);
    if (!stored) throw new Error("Intent not found");
    return clone(stored.status);
  }

  async getVerificationOutcome({ intentId }) {
    const stored = this.intents.get(intentId);
    if (!stored) throw new Error("Intent not found");
    return clone(stored.verification);
  }

  async getProof({ intentId }) {
    const stored = this.intents.get(intentId);
    if (!stored) throw new Error("Intent not found");
    return clone(stored.proof);
  }
}

export function createSimulatedMandateAdapter(options) {
  return new SimulatedMandateAdapter(options);
}
