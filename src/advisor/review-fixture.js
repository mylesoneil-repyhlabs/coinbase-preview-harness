import { randomUUID } from "node:crypto";
import { digest } from "../evidence.js";
import {
  createGuardReceipt,
  GUARD_MODES,
  verifyGuardReceipt,
} from "../guard-receipt.js";
import { sanitize } from "../sanitize.js";

export function createSimulatedReviewFixture({
  now = new Date(),
  nonce = randomUUID(),
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Simulated REVIEW fixture clock is invalid");
  }
  const expiresAt = new Date(now.getTime() + 60_000);
  const record = sanitize({
    schema_version: "delta.coinbase.execution_record.v3",
    artifact_class: "SIMULATED",
    guard_mode: GUARD_MODES.DRY_RUN,
    generated_at: now.toISOString(),
    status: "REVIEW",
    decision: "REVIEW",
    source_intent_digest: null,
    policy: null,
    policy_digest: null,
    action_descriptor: null,
    capability_profile: null,
    execution_safety_profile: null,
    confirmation: {
      supplied_digest: null,
      matched: false,
      policy_expires_at: null,
    },
    credential_binding: null,
    market: null,
    funding: null,
    sources: {
      accounts: null,
      product: null,
      best_bid_ask: null,
      preview: null,
    },
    proposal: null,
    proposal_check: null,
    preview: null,
    preview_check: null,
    delta: null,
    reconciliation: null,
    execution: {
      adapter_invoked: false,
      order_submitted: false,
      order_id: null,
      client_order_id: null,
      create_payload_digest: null,
      transmitted_body_digest: null,
      one_time_gate_consumed: false,
      persistence_warnings: [],
    },
    preflight: {
      schema_version: "delta.coinbase.preflight_binding.v1",
      nonce_digest: digest(nonce),
      fingerprint: null,
      expires_at: expiresAt.toISOString(),
      supersedes: null,
    },
    boundary: {
      mode: GUARD_MODES.DRY_RUN,
      view_only: false,
      dry_run: true,
      create_available: false,
      no_order_submitted: true,
      money_moved: false,
      coinbase_contacted: false,
      preview_is_not_execution_or_price_guarantee: true,
    },
    simulation: {
      source: "SIMULATED_FIXTURE_NOT_COINBASE",
      network_access: false,
      production_delta_contacted: false,
    },
    failure: {
      stage: "SIMULATED_EVIDENCE",
      code: "SIMULATED_MARKET_EVIDENCE_UNAVAILABLE",
      class: "UNABLE_TO_VERIFY",
      message:
        "The simulated market evidence is unavailable, so the exact proposal cannot be verified.",
      recovery:
        "Refresh the simulated facts and try again. No order was submitted.",
      retryable: true,
      http_status: null,
    },
  });
  const receipt = createGuardReceipt(record, {
    mode: GUARD_MODES.DRY_RUN,
    nonce,
    issuedAt: now,
  });
  const withReceipt = { ...record, guard_receipt: receipt };
  const sealed = {
    ...withReceipt,
    record_digest: digest(withReceipt),
  };
  verifyGuardReceipt(sealed.guard_receipt, sealed);
  return sealed;
}
