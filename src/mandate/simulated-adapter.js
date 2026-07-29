import { randomUUID } from "node:crypto";
import { compareDecimals } from "../decimal.js";
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
      evidence.size_field === parameters.size_field,
      "the Coinbase size field differs from the authorized side",
    ],
    [
      evidence.size_operator === parameters.size_operator,
      "the size operator differs from the authorized bound",
    ],
    [
      evidence.size_within_limit === true &&
        (parameters.size_operator === "EXACT"
          ? compareDecimals(
              evidence.size_value,
              parameters.size_value,
            ) === 0
          : parameters.size_operator === "MAX" &&
            compareDecimals(
              evidence.size_value,
              parameters.size_value,
            ) <= 0),
      "the size is outside the authorized bound",
    ],
    [
      evidence.funding_asset === parameters.funding_asset,
      "the funding asset differs from the authorized source asset",
    ],
    [
      evidence.action_descriptor_digest ===
        parameters.action_descriptor_digest,
      "the canonical action descriptor differs from authorization",
    ],
    [
      evidence.limit_price_within_bound === true,
      "the exact Coinbase limit price exceeds the authorized side-specific bound",
    ],
    [
      evidence.slippage_within_limit === true &&
        evidence.slippage_bps <= parameters.max_slippage_bps,
      "estimated slippage exceeds the authorized cap",
    ],
    [
      evidence.commission_within_limit === true &&
        compareDecimals(
          evidence.commission_value,
          parameters.max_commission_value,
        ) <= 0,
      "estimated commission exceeds the authorized cap",
    ],
    [
      evidence.settlement_kind === parameters.settlement_kind &&
        evidence.settlement_within_limit === true &&
        (parameters.settlement_kind === "MAX_QUOTE_DEBIT"
          ? compareDecimals(
              evidence.settlement_value,
              parameters.settlement_value,
            ) <= 0
          : compareDecimals(
              evidence.settlement_value,
              parameters.settlement_value,
            ) >= 0),
      "estimated settlement value violates the authorized bound",
    ],
    [
      evidence.market_condition_reference ===
        parameters.market_condition_reference,
      "the market-price reference differs from the authorized condition",
    ],
    [
      evidence.market_condition_operator ===
        parameters.market_condition_operator,
      "the market-price operator differs from the authorized condition",
    ],
    [
      evidence.market_condition_value ===
        parameters.market_condition_value,
      "the absolute market-price threshold differs from authorization",
    ],
    [
      evidence.market_condition_met === true,
      "fresh Coinbase market and Preview evidence do not satisfy the authorized market-price condition",
    ],
    [
      evidence.funding_sufficient === true &&
        compareDecimals(
          evidence.funding_available,
          evidence.funding_required,
        ) >= 0,
      "available Coinbase funds do not cover the authorized action",
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
    [
      evidence.view_only === false,
      "the Coinbase product is view-only",
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
      throw new Error("The simulator accepts only the pinned Coinbase V3 policy");
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

  async verifyProofArtifact({ proof }) {
    if (
      proof?.sp1_proof !== "SIMULATED_NO_SP1_PROOF" ||
      proof?.signed_intent?.signature?.Simulated !==
        "NOT_A_REAL_DELTA_SIGNATURE"
    ) {
      throw new Error(
        "The simulation adapter accepts only its explicit placeholder proof",
      );
    }
    return {
      verified: true,
      cryptographically_verified: false,
      method: "SIMULATED_BINDING_CHECK_ONLY",
      verifier_identity: "SIMULATED_LOCAL_TEST_DOUBLE",
      program_id: null,
      proof_digest: digest(proof),
    };
  }
}

export function createSimulatedMandateAdapter(options) {
  return new SimulatedMandateAdapter(options);
}
