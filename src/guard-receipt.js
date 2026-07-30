import { randomUUID } from "node:crypto";
import {
  buildCoinbaseCreateRequest,
  buildCoinbasePreviewRequest,
} from "./coinbase-order.js";
import { digest, digestBytes } from "./evidence.js";

export const GUARD_MODES = Object.freeze({
  DRY_RUN: "dry_run",
  VIEW_ONLY_PREFLIGHT: "view_only_preflight",
});

const PASS_STATUSES = new Set([
  "EXECUTION_ELIGIBLE",
  "PREVIEW_PROBE_PASS",
  "PASS",
]);

function decisionFromRecord(record) {
  if (record?.decision && ["PASS", "BLOCK", "REVIEW"].includes(record.decision)) {
    return record.decision;
  }
  if (PASS_STATUSES.has(record?.status)) return "PASS";
  if (record?.status === "REVIEW" || record?.status === "UNABLE_TO_VERIFY") {
    return "REVIEW";
  }
  return "BLOCK";
}

function firstIssue(record) {
  const collections = [
    record?.funding?.evidence_issues,
    record?.funding?.policy_failures,
    record?.funding?.failures,
    record?.proposal_check?.failures,
    record?.preview_check?.review_reasons,
    record?.preview_check?.failures,
    record?.delta?.constraint_failures,
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection) || collection.length === 0) continue;
    const issue = collection[0];
    return {
      code: issue.code ?? issue.id ?? "GUARD_CHECK_FAILED",
      reason:
        issue.message ??
        issue.reason ??
        "A deterministic guard check did not pass.",
    };
  }
  if (record?.failure?.message) {
    return {
      code: record.failure.code ?? "GUARD_CHECK_FAILED",
      reason: record.failure.message,
    };
  }
  return null;
}

function plainDecision(record, mode) {
  const outcome = decisionFromRecord(record);
  const issue = firstIssue(record);
  if (outcome === "PASS") {
    return {
      outcome,
      code:
        mode === GUARD_MODES.DRY_RUN
          ? "SIMULATED_EXACT_PROPOSAL_PASS"
          : "VIEW_ONLY_PREFLIGHT_PASS",
      reason:
        mode === GUARD_MODES.DRY_RUN
          ? "The exact proposal satisfied the mandate, deterministic Preview checks, and the local Delta simulation."
          : "Held funds, product availability, fresh market data, and Coinbase Preview matched the exact proposal.",
      recovery: null,
    };
  }
  if (outcome === "REVIEW") {
    return {
      outcome,
      code: issue?.code ?? "EVIDENCE_UNAVAILABLE",
      reason:
        issue?.reason ??
        "The guard could not verify fresh, complete evidence for this proposal.",
      recovery:
        record?.failure?.recovery ??
        "Refresh the View-only facts and run a new preflight against the same authorized policy. No order was submitted.",
    };
  }
  return {
    outcome,
    code: issue?.code ?? "MANDATE_NOT_SATISFIED",
    reason:
      issue?.reason ??
      "The exact proposal did not satisfy the authorized mandate.",
    recovery:
      record?.failure?.recovery ??
      "Change the proposal or authorize a new mandate. The blocked proposal cannot be released.",
  };
}

function expiresAt(record, issuedAt) {
  const candidates = [
    record?.confirmation?.policy_expires_at,
    record?.proposal?.expires_at,
    record?.preflight?.expires_at,
  ]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  if (candidates.length === 0) return issuedAt.toISOString();
  return new Date(Math.min(...candidates)).toISOString();
}

function boundDigest(value, unavailableLabel) {
  if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) {
    return value;
  }
  return digest({
    unavailable: true,
    label: unavailableLabel,
  });
}

function proposalDigest(record) {
  if (!record?.proposal || typeof record.proposal !== "object") {
    return boundDigest(null, "proposal");
  }
  const { proposal_digest: _suppliedDigest, ...proposal } =
    record.proposal;
  return digest(proposal);
}

function normalizedFunding(funding) {
  if (!funding || typeof funding !== "object") return null;
  return {
    schema_version: funding.schema_version,
    portfolio_fingerprint: funding.portfolio_fingerprint,
    funding_asset: funding.funding_asset,
    required_available: funding.required_available,
    available_balance: funding.available_balance,
    account_fingerprints: funding.account_fingerprints,
    complete: funding.complete,
    evidence_digest: funding.evidence_digest,
  };
}

function evidenceDigest(record) {
  if (
    !record?.market ||
    !record?.preview?.evidence ||
    !record?.funding ||
    typeof record.preview.collected_at !== "string"
  ) {
    return boundDigest(null, "evidence");
  }
  return digest({
    market: record.market,
    preview: record.preview.evidence,
    funding: normalizedFunding(record.funding),
    collected_at: record.preview.collected_at,
  });
}

function previewRequestDigest(record) {
  if (!record?.proposal?.action) {
    return boundDigest(null, "preview_request");
  }
  try {
    return digestBytes(
      JSON.stringify(buildCoinbasePreviewRequest(record.proposal.action)),
    );
  } catch {
    return boundDigest(null, "preview_request");
  }
}

function createPayloadDigest(record) {
  if (
    !record?.proposal?.action ||
    typeof record?.execution?.client_order_id !== "string" ||
    typeof record?.preview?.evidence?.preview_id !== "string"
  ) {
    return boundDigest(null, "prospective_create_payload");
  }
  try {
    return digestBytes(
      JSON.stringify(
        buildCoinbaseCreateRequest(
          record.proposal.action,
          record.execution.client_order_id,
          record.preview.evidence.preview_id,
        ),
      ),
    );
  } catch {
    return boundDigest(null, "prospective_create_payload");
  }
}

function preflightFingerprint(record, bindings) {
  if (
    record?.preflight?.schema_version ===
      "delta.coinbase.preflight_binding.v1" &&
    record?.proposal &&
    record?.sources?.accounts &&
    record?.sources?.product &&
    record?.sources?.best_bid_ask &&
    record?.sources?.preview
  ) {
    return digest({
      schema_version: record.preflight.schema_version,
      mode: record.guard_mode ?? record.boundary?.mode ?? null,
      nonce_digest: record.preflight.nonce_digest,
      policy_digest: bindings.policy_digest,
      action_descriptor_digest:
        record?.action_descriptor?.descriptor_digest,
      proposal_digest: bindings.proposal_digest,
      preview_request_digest: bindings.preview_request_digest,
      preview_transport_body_digest:
        record?.preview?.transport_body_digest,
      preview_response_fingerprint: digest(record.preview.evidence),
      evidence_digest: bindings.evidence_digest,
      prospective_create_payload_digest:
        bindings.create_payload_digest,
      source_times: {
        accounts_received_at: record.sources.accounts.received_at,
        product_received_at: record.sources.product.received_at,
        bbo_observed_at: record.sources.best_bid_ask.observed_at,
        preview_received_at: record.sources.preview.received_at,
      },
    });
  }
  if (
    record?.preflight?.schema_version ===
      "delta.coinbase.preflight_binding.v1" &&
    record?.failure?.code
  ) {
    return digest({
      schema_version: record.preflight.schema_version,
      mode: record.guard_mode ?? record.boundary?.mode ?? null,
      nonce_digest: record.preflight.nonce_digest,
      policy_digest: bindings.policy_digest,
      failure_code: record.failure.code,
    });
  }
  return boundDigest(null, "preflight");
}

function authorizationDigest(record, bindings) {
  return digest({
    source_intent_digest: record?.source_intent_digest ?? null,
    policy_digest: bindings.policy_digest,
    confirmation: {
      supplied_digest: record?.confirmation?.supplied_digest ?? null,
      execution_digest: record?.confirmation?.execution_digest ?? null,
      receipt_digest: record?.confirmation?.receipt_digest ?? null,
      matched: record?.confirmation?.matched === true,
    },
    credential_binding: record?.credential_binding ?? null,
  });
}

export function guardRecordBindings(record) {
  const bindings = {
    policy_digest:
      record?.policy == null
        ? boundDigest(record?.policy_digest, "policy")
        : digest(record.policy),
    proposal_digest: proposalDigest(record),
    evidence_digest: evidenceDigest(record),
    preview_request_digest: previewRequestDigest(record),
    create_payload_digest: createPayloadDigest(record),
  };
  bindings.preflight_fingerprint = preflightFingerprint(
    record,
    bindings,
  );
  bindings.authorization_digest = authorizationDigest(record, bindings);
  return bindings;
}

export function createGuardReceipt(
  record,
  {
    mode,
    nonce = randomUUID(),
    issuedAt = new Date(record?.generated_at ?? Date.now()),
    receiptId = randomUUID(),
  } = {},
) {
  if (!Object.values(GUARD_MODES).includes(mode)) {
    throw new Error("Guard receipt mode must be dry_run or view_only_preflight");
  }
  if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 256) {
    throw new Error("Guard receipt nonce must contain 8 through 256 characters");
  }
  const decision = plainDecision(record, mode);
  const bindings = guardRecordBindings(record);
  const receipt = {
    schema_version: "delta.coinbase.guard_receipt.v1",
    receipt_id: receiptId,
    mode,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt(record, issuedAt),
    nonce_digest: digest(nonce),
    bindings,
    decision: {
      ...decision,
      decision_digest: digest({
        outcome: decision.outcome,
        code: decision.code,
        reason: decision.reason,
        recovery: decision.recovery,
      }),
    },
    provenance:
      mode === GUARD_MODES.DRY_RUN
        ? {
            source:
              record?.sources?.preview?.provenance ===
              "SIMULATED_FIXTURE"
                ? "SIMULATED_FIXTURE"
                : "LOCAL_GUARD_ONLY",
            coinbase_contacted: false,
            production_delta_contacted: false,
          }
        : {
            source:
              record?.sources?.preview?.provenance ===
              "COINBASE_AUTHENTICATED_VIEW"
                ? "COINBASE_VIEW_ONLY"
                : record?.boundary?.coinbase_contacted === true
                  ? "COINBASE_PERMISSION_CHECK_ONLY"
                  : "LOCAL_GUARD_ONLY",
            coinbase_contacted:
              record?.boundary?.coinbase_contacted === true,
            production_delta_contacted: false,
          },
    execution_boundary: {
      create_available: false,
      order_submitted: false,
      money_moved: false,
      one_use_status:
        mode === GUARD_MODES.DRY_RUN && decision.outcome === "PASS"
          ? "SIMULATED_IN_MEMORY_ELIGIBILITY_CONSUMED"
          : "LOCKED",
      statement:
        mode === GUARD_MODES.DRY_RUN
          ? "Dry run only. No Coinbase order was submitted."
          : "View-only preflight only. Coinbase Preview is not an order or price guarantee; Create is unavailable.",
    },
    proof_class:
      mode === GUARD_MODES.DRY_RUN
        ? "LOCAL_SIMULATION_DIGEST"
        : "LOCAL_INTEGRITY_DIGEST_OVER_NORMALIZED_VIEW_ONLY_FACTS",
    proof_limit:
      "Local SHA-256 integrity evidence, not a production Delta signature and not independent authentication of Coinbase data.",
    binding_completeness:
      record?.proposal?.proposal_digest &&
      record?.preview?.evidence_digest &&
      record?.preview?.request_digest &&
      record?.preflight?.fingerprint
        ? "COMPLETE"
        : "PARTIAL_UNAVAILABLE_EVIDENCE",
  };
  return { ...receipt, receipt_digest: digest(receipt) };
}

export function verifyGuardReceipt(receipt, record) {
  if (
    !receipt ||
    receipt.schema_version !== "delta.coinbase.guard_receipt.v1"
  ) {
    throw new Error("Guard receipt schema is invalid");
  }
  const { receipt_digest: suppliedDigest, ...payload } = receipt;
  if (digest(payload) !== suppliedDigest) {
    throw new Error("Guard receipt integrity check failed");
  }
  if (
    receipt.mode !== record?.guard_mode ||
    receipt.mode !== record?.boundary?.mode
  ) {
    throw new Error("Guard receipt mode no longer matches the record");
  }
  const expected = guardRecordBindings(record);
  const storedBindings = {
    policy_digest: record?.policy_digest,
    proposal_digest: record?.proposal?.proposal_digest,
    evidence_digest: record?.preview?.evidence_digest,
    preview_request_digest: record?.preview?.request_digest,
    create_payload_digest:
      record?.execution?.create_payload_digest,
    preflight_fingerprint: record?.preflight?.fingerprint,
  };
  for (const [field, stored] of Object.entries(storedBindings)) {
    if (stored != null && stored !== expected[field]) {
      throw new Error(
        `Guard receipt ${field} no longer matches the record`,
      );
    }
  }
  if (
    record?.preview?.response_fingerprint != null &&
    record.preview.response_fingerprint !== digest(record.preview.evidence)
  ) {
    throw new Error(
      "Guard receipt Preview response fingerprint no longer matches the record",
    );
  }
  for (const [field, value] of Object.entries(expected)) {
    if (receipt.bindings?.[field] !== value) {
      throw new Error(`Guard receipt ${field} no longer matches the record`);
    }
  }
  const expectedDecision = plainDecision(record, receipt.mode);
  const expectedDecisionDigest = digest({
    outcome: expectedDecision.outcome,
    code: expectedDecision.code,
    reason: expectedDecision.reason,
    recovery: expectedDecision.recovery,
  });
  if (
    receipt.decision?.outcome !== expectedDecision.outcome ||
    receipt.decision?.code !== expectedDecision.code ||
    receipt.decision?.reason !== expectedDecision.reason ||
    receipt.decision?.recovery !== expectedDecision.recovery ||
    receipt.decision?.decision_digest !== expectedDecisionDigest
  ) {
    throw new Error("Guard receipt decision no longer matches the record");
  }
  if (record?.record_digest) {
    const { record_digest: recordDigest, ...recordPayload } = record;
    if (digest(recordPayload) !== recordDigest) {
      throw new Error("Guard record integrity check failed");
    }
  }
  return {
    verified: true,
    mode: receipt.mode,
    receipt_digest: suppliedDigest,
    preflight_fingerprint: receipt.bindings.preflight_fingerprint,
  };
}

export function guardDecision(record, mode) {
  return plainDecision(record, mode);
}
