import {
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { chmod, lstat, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalize, digest, digestBytes } from "./evidence.js";
import { HARNESS_ROOT } from "./paths.js";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DEMO_AUTHORIZATION_WINDOW_MS = 60 * 60 * 1000;

const MANDATE_FIELDS = Object.freeze([
  "schema_version",
  "mandate_id",
  "authorization_id",
  "tenant_id",
  "authorized_user_id",
  "authorized_by",
  "authorized_at",
  "expires_at",
  "payment_rail",
  "currency",
  "allowed_vendor_ids",
  "allowed_destination_account_ids",
  "allowed_bank_account_fingerprints",
  "max_payment_cents",
  "human_review_above_cents",
  "max_evidence_age_seconds",
  "required_fields",
  "allowed_cost_centers",
]);

const PROPOSAL_FIELDS = Object.freeze([
  "schema_version",
  "proposal_id",
  "proposed_by",
  "execution_target",
  "authorization_context",
  "vendor_id",
  "vendor_name",
  "amount_cents",
  "currency",
  "destination_account_id",
  "purchase_order_id",
  "invoice_id",
  "cost_center",
  "memo",
]);

const AUTHORIZATION_CONTEXT_FIELDS = Object.freeze([
  "tenant_id",
  "user_id",
  "workflow_run_id",
  "mandate_authorization_id",
]);

const EVIDENCE_FIELDS = Object.freeze([
  "schema_version",
  "artifact_class",
  "collected_by",
  "collected_at",
  "vendor_id",
  "vendor_status",
  "invoice_id",
  "invoice_duplicate",
  "purchase_order_id",
  "purchase_order_status",
  "purchase_order_remaining_cents",
  "bank_account_fingerprint",
  "bank_details_changed",
  "destination_account_id",
]);

const EXECUTION_PAYLOAD_FIELDS = Object.freeze([
  "schema_version",
  "execution_target",
  "idempotency_key",
  "source_account_id",
  "vendor_id",
  "destination_bank_fingerprint",
  "amount_cents",
  "currency",
  "purchase_order_id",
  "invoice_id",
  "memo",
]);

const SCENARIOS = Object.freeze({
  pass: {
    proposal_id: "proposal-pass-001",
    vendor_id: "vendor-approved-017",
    vendor_name: "Northstar Cloud Services",
    amount_cents: 240_000,
    currency: "USD",
    destination_account_id: "operating-usd-001",
    purchase_order_id: "PO-2026-1042",
    invoice_id: "INV-7741",
    cost_center: "infrastructure",
    memo: "July managed infrastructure",
  },
  block: {
    proposal_id: "proposal-block-001",
    vendor_id: "vendor-unapproved-909",
    vendor_name: "Unapproved Infrastructure Vendor",
    amount_cents: 1_250_000,
    currency: "USD",
    destination_account_id: "operating-usd-001",
    purchase_order_id: "PO-2026-1042",
    invoice_id: "INV-9912",
    cost_center: "infrastructure",
    memo: "Urgent annual prepayment",
  },
  review: {
    proposal_id: "proposal-review-001",
    vendor_id: "vendor-approved-017",
    vendor_name: "Northstar Cloud Services",
    amount_cents: 720_000,
    currency: "USD",
    destination_account_id: "operating-usd-001",
    purchase_order_id: "PO-2026-1042",
    invoice_id: "INV-8862",
    cost_center: "infrastructure",
    memo: "Expanded managed infrastructure",
  },
});

const EVIDENCE_FIXTURES = Object.freeze({
  "INV-7741": {
    vendor_id: "vendor-approved-017",
    vendor_status: "ACTIVE",
    invoice_id: "INV-7741",
    invoice_duplicate: false,
    purchase_order_id: "PO-2026-1042",
    purchase_order_status: "OPEN",
    purchase_order_remaining_cents: 300_000,
    bank_account_fingerprint: "sha256:demo-approved-bank-017",
    bank_details_changed: false,
    destination_account_id: "operating-usd-001",
  },
  "INV-9912": {
    vendor_id: "vendor-unapproved-909",
    vendor_status: "PENDING",
    invoice_id: "INV-9912",
    invoice_duplicate: true,
    purchase_order_id: "PO-2026-1042",
    purchase_order_status: "OPEN",
    purchase_order_remaining_cents: 900_000,
    bank_account_fingerprint: "sha256:demo-changed-bank-909",
    bank_details_changed: true,
    destination_account_id: "operating-usd-001",
  },
  "INV-8862": {
    vendor_id: "vendor-approved-017",
    vendor_status: "ACTIVE",
    invoice_id: "INV-8862",
    invoice_duplicate: false,
    purchase_order_id: "PO-2026-1042",
    purchase_order_status: "OPEN",
    purchase_order_remaining_cents: 800_000,
    bank_account_fingerprint: "sha256:demo-approved-bank-017",
    bank_details_changed: false,
    destination_account_id: "operating-usd-001",
  },
});

function clone(value) {
  return structuredClone(value);
}

function assertExactObject(label, value, expectedFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    const unknown = actual.filter((field) => !expected.includes(field));
    const missing = expected.filter((field) => !actual.includes(field));
    throw new Error(
      `${label} has a closed schema; unknown=[${unknown.join(",")}], missing=[${missing.join(",")}]`,
    );
  }
}

function assertNonEmptyString(label, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function assertMandate(mandate) {
  assertExactObject("Mandate", mandate, MANDATE_FIELDS);
  if (mandate.schema_version !== "delta.vendor_payment.mandate.v2") {
    throw new Error("Unsupported mandate schema");
  }
  for (const field of [
    "mandate_id",
    "authorization_id",
    "tenant_id",
    "authorized_user_id",
    "authorized_by",
    "payment_rail",
    "currency",
  ]) {
    assertNonEmptyString(`Mandate ${field}`, mandate[field]);
  }
  if (!isIsoDate(mandate.authorized_at) || !isIsoDate(mandate.expires_at)) {
    throw new Error("Mandate authorization window must use canonical ISO dates");
  }
  if (
    !Number.isSafeInteger(mandate.max_payment_cents) ||
    !Number.isSafeInteger(mandate.human_review_above_cents) ||
    !Number.isSafeInteger(mandate.max_evidence_age_seconds) ||
    mandate.max_payment_cents <= 0 ||
    mandate.human_review_above_cents <= 0 ||
    mandate.max_evidence_age_seconds <= 0 ||
    mandate.human_review_above_cents >= mandate.max_payment_cents
  ) {
    throw new Error("Mandate payment, review, or evidence-age threshold is invalid");
  }
  for (const field of [
    "allowed_vendor_ids",
    "allowed_destination_account_ids",
    "allowed_bank_account_fingerprints",
    "required_fields",
    "allowed_cost_centers",
  ]) {
    if (
      !Array.isArray(mandate[field]) ||
      mandate[field].length === 0 ||
      mandate[field].some(
        (value) => typeof value !== "string" || value.length === 0,
      )
    ) {
      throw new Error(`Mandate ${field} must be a non-empty string array`);
    }
  }
}

function assertProposal(proposal) {
  assertExactObject("Proposal", proposal, PROPOSAL_FIELDS);
  if (proposal.schema_version !== "delta.vendor_payment.proposal.v2") {
    throw new Error("Unsupported proposal schema");
  }
  for (const field of PROPOSAL_FIELDS.filter(
    (name) => !["authorization_context", "amount_cents"].includes(name),
  )) {
    assertNonEmptyString(`Proposal ${field}`, proposal[field]);
  }
  if (
    !Number.isSafeInteger(proposal.amount_cents) ||
    proposal.amount_cents <= 0
  ) {
    throw new Error("Proposal amount_cents must be a positive safe integer");
  }
  assertExactObject(
    "Proposal authorization context",
    proposal.authorization_context,
    AUTHORIZATION_CONTEXT_FIELDS,
  );
  for (const field of AUTHORIZATION_CONTEXT_FIELDS) {
    assertNonEmptyString(
      `Proposal authorization context ${field}`,
      proposal.authorization_context[field],
    );
  }
}

function assertEvidence(evidence) {
  assertExactObject("Evidence", evidence, EVIDENCE_FIELDS);
  if (
    evidence.schema_version !== "delta.vendor_payment.evidence.v1" ||
    evidence.artifact_class !== "SERVER_OWNED_DEMO_FIXTURE"
  ) {
    throw new Error("Unsupported or agent-authored evidence artifact");
  }
  for (const field of EVIDENCE_FIELDS.filter(
    (name) =>
      ![
        "invoice_duplicate",
        "bank_details_changed",
        "purchase_order_remaining_cents",
      ].includes(name),
  )) {
    assertNonEmptyString(`Evidence ${field}`, evidence[field]);
  }
  if (
    typeof evidence.invoice_duplicate !== "boolean" ||
    typeof evidence.bank_details_changed !== "boolean" ||
    !Number.isSafeInteger(evidence.purchase_order_remaining_cents) ||
    !isIsoDate(evidence.collected_at)
  ) {
    throw new Error("Evidence contains invalid typed fields");
  }
}

function assertExecutionPayload(executionPayload) {
  assertExactObject(
    "Execution payload",
    executionPayload,
    EXECUTION_PAYLOAD_FIELDS,
  );
  if (
    executionPayload.schema_version !==
    "delta.vendor_payment.execution_payload.v1"
  ) {
    throw new Error("Unsupported execution payload schema");
  }
}

export function createPartnerDemoMandate({
  authorizedAt = new Date(),
  expiresInMs = DEMO_AUTHORIZATION_WINDOW_MS,
  tenantId = "demo-company-001",
  authorizedUserId = "demo-procurement-owner",
} = {}) {
  if (
    !(authorizedAt instanceof Date) ||
    !Number.isFinite(authorizedAt.getTime())
  ) {
    throw new Error("authorizedAt must be a valid Date");
  }
  if (!Number.isInteger(expiresInMs) || expiresInMs <= 0) {
    throw new Error("expiresInMs must be a positive integer");
  }
  assertNonEmptyString("tenantId", tenantId);
  assertNonEmptyString("authorizedUserId", authorizedUserId);
  return {
    schema_version: "delta.vendor_payment.mandate.v2",
    mandate_id: "demo-mandate-procurement-001",
    authorization_id: `demo-authorization-${digest({
      tenant_id: tenantId,
      authorized_user_id: authorizedUserId,
      authorized_at: authorizedAt.toISOString(),
    }).slice(0, 24)}`,
    tenant_id: tenantId,
    authorized_user_id: authorizedUserId,
    authorized_by: "Demo procurement owner",
    authorized_at: authorizedAt.toISOString(),
    expires_at: new Date(
      authorizedAt.getTime() + expiresInMs,
    ).toISOString(),
    payment_rail: "vendor_payment",
    currency: "USD",
    allowed_vendor_ids: ["vendor-approved-017"],
    allowed_destination_account_ids: ["operating-usd-001"],
    allowed_bank_account_fingerprints: [
      "sha256:demo-approved-bank-017",
    ],
    max_payment_cents: 1_000_000,
    human_review_above_cents: 500_000,
    max_evidence_age_seconds: 300,
    required_fields: ["purchase_order_id", "invoice_id", "cost_center"],
    allowed_cost_centers: ["infrastructure"],
  };
}

export function partnerDemoProposal(
  scenario,
  {
    authorizationContext = {
      tenant_id: "demo-company-001",
      user_id: "demo-procurement-owner",
      workflow_run_id: "demo-mastra-run-001",
      mandate_authorization_id: "runtime-bound-by-controller",
    },
  } = {},
) {
  const proposal = SCENARIOS[scenario];
  if (!proposal) {
    throw new Error(
      "Partner demo scenario must be exactly pass, block, or review",
    );
  }
  return clone({
    schema_version: "delta.vendor_payment.proposal.v2",
    proposed_by: "simulated-procurement-agent",
    execution_target: "brex-style-vendor-payment-boundary",
    authorization_context: authorizationContext,
    ...proposal,
  });
}

export function collectPartnerDemoEvidence(
  proposal,
  { collectedAt = new Date() } = {},
) {
  const fixture = EVIDENCE_FIXTURES[proposal.invoice_id];
  if (!fixture) {
    throw new Error("No server-owned evidence fixture exists for this invoice");
  }
  return clone({
    schema_version: "delta.vendor_payment.evidence.v1",
    artifact_class: "SERVER_OWNED_DEMO_FIXTURE",
    collected_by: "simulated-procurement-evidence-adapter",
    collected_at: collectedAt.toISOString(),
    ...fixture,
  });
}

export function prepareVendorPaymentExecutionPayload(proposal, evidence) {
  assertProposal(proposal);
  assertEvidence(evidence);
  const executionPayload = {
    schema_version: "delta.vendor_payment.execution_payload.v1",
    execution_target: proposal.execution_target,
    idempotency_key: digest({
      tenant_id: proposal.authorization_context.tenant_id,
      mandate_authorization_id:
        proposal.authorization_context.mandate_authorization_id,
      proposal_id: proposal.proposal_id,
      invoice_id: proposal.invoice_id,
    }),
    source_account_id: proposal.destination_account_id,
    vendor_id: proposal.vendor_id,
    destination_bank_fingerprint: evidence.bank_account_fingerprint,
    amount_cents: proposal.amount_cents,
    currency: proposal.currency,
    purchase_order_id: proposal.purchase_order_id,
    invoice_id: proposal.invoice_id,
    memo: proposal.memo,
  };
  assertExecutionPayload(executionPayload);
  return executionPayload;
}

export function evaluateVendorPaymentMandate(
  mandate,
  proposal,
  evidence,
  executionPayload,
  { evaluatedAt = new Date() } = {},
) {
  assertMandate(mandate);
  assertProposal(proposal);
  assertEvidence(evidence);
  assertExecutionPayload(executionPayload);
  const hardConstraints = [
    {
      id: "authorization_subject",
      passed:
        proposal.authorization_context.tenant_id === mandate.tenant_id &&
        proposal.authorization_context.user_id ===
          mandate.authorized_user_id,
      reason:
        "Proposal tenant or principal differs from the authorized subject.",
    },
    {
      id: "authorization_instance",
      passed:
        proposal.authorization_context.mandate_authorization_id ===
        mandate.authorization_id,
      reason:
        "Proposal is not bound to this mandate authorization instance.",
    },
    {
      id: "authorization_window",
      passed:
        evaluatedAt.toISOString() >= mandate.authorized_at &&
        evaluatedAt.toISOString() <= mandate.expires_at,
      reason: "Mandate authorization is not active at evaluation time.",
    },
    {
      id: "evidence_freshness",
      passed:
        Date.parse(evidence.collected_at) <= evaluatedAt.getTime() &&
        evaluatedAt.getTime() - Date.parse(evidence.collected_at) <=
          mandate.max_evidence_age_seconds * 1000,
      reason: "Server-owned evidence is stale or from the future.",
    },
    {
      id: "vendor_allowlist",
      passed:
        mandate.allowed_vendor_ids.includes(proposal.vendor_id) &&
        evidence.vendor_id === proposal.vendor_id &&
        evidence.vendor_status === "ACTIVE",
      reason: "Vendor is not active and on the authorized allowlist.",
    },
    {
      id: "invoice_not_duplicate",
      passed:
        evidence.invoice_id === proposal.invoice_id &&
        evidence.invoice_duplicate === false,
      reason: "Invoice is already recorded or evidence does not match it.",
    },
    {
      id: "purchase_order_match",
      passed:
        evidence.purchase_order_id === proposal.purchase_order_id &&
        evidence.purchase_order_status === "OPEN" &&
        evidence.purchase_order_remaining_cents >= proposal.amount_cents,
      reason:
        "Purchase order is closed, mismatched, or has insufficient balance.",
    },
    {
      id: "bank_details_unchanged",
      passed:
        evidence.bank_details_changed === false &&
        mandate.allowed_bank_account_fingerprints.includes(
          evidence.bank_account_fingerprint,
        ),
      reason: "Vendor bank details changed or are outside the authorization.",
    },
    {
      id: "destination_account",
      passed:
        evidence.destination_account_id === proposal.destination_account_id &&
        mandate.allowed_destination_account_ids.includes(
          proposal.destination_account_id,
        ) &&
        executionPayload.source_account_id ===
          proposal.destination_account_id,
      reason: "Funding account is outside the authorized scope.",
    },
    {
      id: "exact_execution_payload",
      passed:
        executionPayload.vendor_id === proposal.vendor_id &&
        executionPayload.amount_cents === proposal.amount_cents &&
        executionPayload.currency === proposal.currency &&
        executionPayload.invoice_id === proposal.invoice_id &&
        executionPayload.destination_bank_fingerprint ===
          evidence.bank_account_fingerprint,
      reason:
        "Prepared payment payload differs from the evaluated proposal or evidence.",
    },
    {
      id: "payment_cap",
      passed: proposal.amount_cents <= mandate.max_payment_cents,
      reason: "Payment exceeds the authorized maximum.",
    },
    {
      id: "currency",
      passed: proposal.currency === mandate.currency,
      reason: "Payment currency differs from the authorized currency.",
    },
    {
      id: "cost_center",
      passed: mandate.allowed_cost_centers.includes(proposal.cost_center),
      reason: "Cost center is outside the authorized scope.",
    },
    ...mandate.required_fields.map((field) => ({
      id: `required_${field}`,
      passed:
        typeof proposal[field] === "string" &&
        proposal[field].trim().length > 0,
      reason: `Required field ${field} is missing.`,
    })),
  ];
  const blockingFailures = hardConstraints.filter((check) => !check.passed);
  const reviewReasons =
    blockingFailures.length === 0 &&
    proposal.amount_cents > mandate.human_review_above_cents
      ? [
          {
            id: "human_review_threshold",
            reason:
              "Payment is within the hard mandate but requires human review.",
          },
        ]
      : [];
  const decision =
    blockingFailures.length > 0
      ? "BLOCK"
      : reviewReasons.length > 0
        ? "REVIEW"
        : "PASS";

  return {
    schema_version: "delta.vendor_payment.decision.v2",
    decision,
    evaluated_at: evaluatedAt.toISOString(),
    mandate_id: mandate.mandate_id,
    mandate_authorization_id: mandate.authorization_id,
    mandate_digest: digest(mandate),
    proposal_id: proposal.proposal_id,
    proposal_digest: digest(proposal),
    evidence_digest: digest(evidence),
    execution_payload_digest: digest(executionPayload),
    constraints: hardConstraints,
    blocking_failures: blockingFailures,
    review_reasons: reviewReasons,
  };
}

export function createPartnerDemoSigner({ keyPair } = {}) {
  const keys = keyPair ?? generateKeyPairSync("ed25519");
  const publicKeyPem = keys.publicKey.export({
    type: "spki",
    format: "pem",
  });
  return Object.freeze({
    artifact_class: "EPHEMERAL_CONTROLLER_PINNED_DEMO_SIGNER",
    public_key_pem: publicKeyPem,
    key_fingerprint: digestBytes(publicKeyPem),
    sign: (payload) =>
      sign(
        null,
        Buffer.from(canonicalize(payload)),
        keys.privateKey,
      ).toString("base64"),
  });
}

function executionGrantFor(decision, proposal, expiresAt) {
  if (decision.decision !== "PASS") return null;
  return {
    grant_id: digest({
      tenant_id: proposal.authorization_context.tenant_id,
      mandate_authorization_id: decision.mandate_authorization_id,
      execution_payload_digest: decision.execution_payload_digest,
    }),
    execution_payload_digest: decision.execution_payload_digest,
    expires_at: expiresAt,
    max_uses: 1,
  };
}

export function createPartnerDemoReceipt(
  decision,
  proposal,
  {
    signer,
    uniqueId = randomUUID,
    receiptExpiresAt,
    executionTarget = "brex-style-vendor-payment-boundary",
  } = {},
) {
  if (!signer) {
    throw new Error("A controller-pinned receipt signer is required");
  }
  if (!receiptExpiresAt || !isIsoDate(receiptExpiresAt)) {
    throw new Error("A canonical receipt expiry is required");
  }
  const payload = {
    schema_version: "delta.vendor_payment.receipt_payload.v2",
    receipt_id: uniqueId(),
    artifact_class: "SIMULATED_PARTNER_DEMO",
    issuer: "local-delta-simulation",
    signer_key_fingerprint: signer.key_fingerprint,
    decision: decision.decision,
    evaluated_at: decision.evaluated_at,
    not_before: decision.evaluated_at,
    expires_at: receiptExpiresAt,
    mandate_id: decision.mandate_id,
    mandate_authorization_id: decision.mandate_authorization_id,
    mandate_digest: decision.mandate_digest,
    proposal_id: decision.proposal_id,
    proposal_digest: decision.proposal_digest,
    evidence_digest: decision.evidence_digest,
    execution_payload_digest: decision.execution_payload_digest,
    execution_target: executionTarget,
    blocking_failures: decision.blocking_failures.map(({ id, reason }) => ({
      id,
      reason,
    })),
    review_reasons: decision.review_reasons.map(({ id, reason }) => ({
      id,
      reason,
    })),
    execution_grant: executionGrantFor(
      decision,
      proposal,
      receiptExpiresAt,
    ),
  };
  const signed = {
    schema_version: "delta.vendor_payment.signed_receipt.v2",
    signature_algorithm: "Ed25519",
    trust_note:
      "Controller pins this ephemeral key for one local demo run. It is not a production delta identity.",
    payload,
    public_key_pem: signer.public_key_pem,
    signature: signer.sign(payload),
  };
  return { ...signed, receipt_digest: digest(signed) };
}

function exactReasonList(actual, expected) {
  return (
    canonicalize(actual) ===
    canonicalize(expected.map(({ id, reason }) => ({ id, reason })))
  );
}

export function inspectPartnerDemoReceipt(
  receipt,
  {
    trustedPublicKeyPem,
    mandate,
    proposal,
    evidence,
    executionPayload,
    decision,
    current = new Date(),
  } = {},
) {
  const checks = {
    closed_schema: false,
    receipt_digest_match: false,
    cryptographic_signature_valid: false,
    signer_key_pinned: false,
    signer_fingerprint_match: false,
    time_window_active: false,
    exact_mandate_match: false,
    exact_proposal_match: false,
    exact_evidence_match: false,
    exact_execution_payload_match: false,
    exact_decision_match: false,
    execution_grant_consistent: false,
    decision_is_pass: false,
  };
  try {
    assertExactObject("Signed receipt", receipt, [
      "schema_version",
      "signature_algorithm",
      "trust_note",
      "payload",
      "public_key_pem",
      "signature",
      "receipt_digest",
    ]);
    assertExactObject("Receipt payload", receipt.payload, [
      "schema_version",
      "receipt_id",
      "artifact_class",
      "issuer",
      "signer_key_fingerprint",
      "decision",
      "evaluated_at",
      "not_before",
      "expires_at",
      "mandate_id",
      "mandate_authorization_id",
      "mandate_digest",
      "proposal_id",
      "proposal_digest",
      "evidence_digest",
      "execution_payload_digest",
      "execution_target",
      "blocking_failures",
      "review_reasons",
      "execution_grant",
    ]);
    if (receipt.payload.execution_grant !== null) {
      assertExactObject(
        "Receipt execution grant",
        receipt.payload.execution_grant,
        [
          "grant_id",
          "execution_payload_digest",
          "expires_at",
          "max_uses",
        ],
      );
    }
    checks.closed_schema =
      receipt.schema_version === "delta.vendor_payment.signed_receipt.v2" &&
      receipt.payload.schema_version ===
        "delta.vendor_payment.receipt_payload.v2" &&
      receipt.signature_algorithm === "Ed25519" &&
      receipt.payload.artifact_class === "SIMULATED_PARTNER_DEMO" &&
      receipt.payload.issuer === "local-delta-simulation" &&
      receipt.payload.execution_target ===
        "brex-style-vendor-payment-boundary";
  } catch {
    return {
      artifact_verified: false,
      execution_authorized: false,
      checks,
    };
  }

  const { receipt_digest: claimedDigest, ...signed } = receipt;
  checks.receipt_digest_match = digest(signed) === claimedDigest;
  checks.signer_key_pinned =
    typeof trustedPublicKeyPem === "string" &&
    trustedPublicKeyPem.length > 0 &&
    receipt.public_key_pem === trustedPublicKeyPem;
  checks.signer_fingerprint_match =
    receipt.payload.signer_key_fingerprint ===
    digestBytes(receipt.public_key_pem);
  try {
    checks.cryptographic_signature_valid = verify(
      null,
      Buffer.from(canonicalize(receipt.payload)),
      receipt.public_key_pem,
      Buffer.from(receipt.signature, "base64"),
    );
  } catch {
    checks.cryptographic_signature_valid = false;
  }
  const currentIso = current.toISOString();
  checks.time_window_active =
    currentIso >= receipt.payload.not_before &&
    currentIso <= receipt.payload.expires_at;
  checks.exact_mandate_match =
    Boolean(mandate) &&
    receipt.payload.mandate_id === mandate.mandate_id &&
    receipt.payload.mandate_authorization_id === mandate.authorization_id &&
    receipt.payload.mandate_digest === digest(mandate) &&
    receipt.payload.not_before >= mandate.authorized_at &&
    receipt.payload.expires_at === mandate.expires_at;
  checks.exact_proposal_match =
    Boolean(proposal) &&
    receipt.payload.proposal_id === proposal.proposal_id &&
    receipt.payload.proposal_digest === digest(proposal) &&
    receipt.payload.execution_target === proposal.execution_target;
  checks.exact_evidence_match =
    Boolean(evidence) &&
    receipt.payload.evidence_digest === digest(evidence);
  checks.exact_execution_payload_match =
    Boolean(executionPayload) &&
    receipt.payload.execution_payload_digest === digest(executionPayload);
  checks.exact_decision_match =
    Boolean(decision) &&
    receipt.payload.decision === decision.decision &&
    receipt.payload.evaluated_at === decision.evaluated_at &&
    receipt.payload.not_before === decision.evaluated_at &&
    receipt.payload.mandate_id === decision.mandate_id &&
    receipt.payload.mandate_authorization_id ===
      decision.mandate_authorization_id &&
    receipt.payload.proposal_id === decision.proposal_id &&
    receipt.payload.mandate_digest === decision.mandate_digest &&
    receipt.payload.proposal_digest === decision.proposal_digest &&
    receipt.payload.evidence_digest === decision.evidence_digest &&
    receipt.payload.execution_payload_digest ===
      decision.execution_payload_digest &&
    exactReasonList(
      receipt.payload.blocking_failures,
      decision.blocking_failures,
    ) &&
    exactReasonList(receipt.payload.review_reasons, decision.review_reasons);
  checks.decision_is_pass = receipt.payload.decision === "PASS";

  const grant = receipt.payload.execution_grant;
  checks.execution_grant_consistent =
    checks.decision_is_pass
      ? Boolean(grant) &&
        grant.max_uses === 1 &&
        grant.execution_payload_digest ===
          receipt.payload.execution_payload_digest &&
        grant.expires_at === receipt.payload.expires_at &&
        grant.grant_id ===
          digest({
            tenant_id: proposal?.authorization_context?.tenant_id,
            mandate_authorization_id:
              receipt.payload.mandate_authorization_id,
            execution_payload_digest:
              receipt.payload.execution_payload_digest,
          })
      : grant === null;

  const artifactChecks = Object.entries(checks)
    .filter(
      ([name]) =>
        !["decision_is_pass", "time_window_active"].includes(name),
    )
    .map(([, passed]) => passed);
  const artifactVerified = artifactChecks.every(Boolean);
  return {
    artifact_verified: artifactVerified,
    execution_authorized:
      artifactVerified &&
      checks.time_window_active &&
      checks.decision_is_pass &&
      checks.execution_grant_consistent,
    checks,
  };
}

export function verifyPartnerDemoReceipt(receipt, options) {
  return inspectPartnerDemoReceipt(receipt, options).artifact_verified;
}

export function createInMemorySingleUseGrantStore() {
  const records = new Map();
  return Object.freeze({
    async consume(grant, action) {
      if (
        !grant ||
        typeof grant.grant_id !== "string" ||
        grant.grant_id.length === 0 ||
        typeof grant.execution_payload_digest !== "string" ||
        grant.execution_payload_digest.length !== 64 ||
        grant.max_uses !== 1 ||
        !isIsoDate(grant.expires_at)
      ) {
        throw new Error("Single-use execution grant is invalid");
      }
      const existing = records.get(grant.grant_id);
      if (existing) {
        return {
          consumed: false,
          replay_blocked: true,
          status: existing.status,
          result: null,
        };
      }
      records.set(grant.grant_id, {
        status: "SUBMISSION_IN_FLIGHT",
        execution_payload_digest: grant.execution_payload_digest,
      });
      try {
        const rawResult = await action();
        const result = {
          execution_id:
            typeof rawResult?.execution_id === "string"
              ? rawResult.execution_id
              : "redacted-or-unavailable",
          status:
            typeof rawResult?.status === "string"
              ? rawResult.status
              : "ACCEPTED_UNKNOWN_DETAIL",
        };
        records.set(grant.grant_id, {
          status: "SUBMITTED_REQUIRES_RECONCILIATION",
          execution_payload_digest: grant.execution_payload_digest,
          result,
        });
        return {
          consumed: true,
          replay_blocked: false,
          status: "SUBMITTED_REQUIRES_RECONCILIATION",
          result,
        };
      } catch {
        records.set(grant.grant_id, {
          status: "UNKNOWN_REQUIRES_RECONCILIATION",
          execution_payload_digest: grant.execution_payload_digest,
        });
        return {
          consumed: true,
          replay_blocked: false,
          status: "UNKNOWN_REQUIRES_RECONCILIATION",
          result: null,
        };
      }
    },
    inspect(grantId) {
      return clone(records.get(grantId) ?? null);
    },
  });
}

async function simulatedVendorPaymentExecutor(executionPayload) {
  return {
    execution_id: `sim-payment-${randomUUID()}`,
    status: "SIMULATED_ACCEPTED",
    ignored_secret: "this adapter-only field must never reach output",
    execution_payload_digest: digest(executionPayload),
  };
}

export async function runPartnerDemo({
  scenario = "pass",
  executePayment = simulatedVendorPaymentExecutor,
  now = () => new Date(),
} = {}) {
  const generatedAt = now();
  const mandate = createPartnerDemoMandate({
    authorizedAt: generatedAt,
  });
  const proposal = partnerDemoProposal(scenario, {
    authorizationContext: {
      tenant_id: "demo-company-001",
      user_id: "demo-procurement-owner",
      workflow_run_id: "demo-mastra-run-001",
      mandate_authorization_id: mandate.authorization_id,
    },
  });
  const evaluated = await evaluateAndGateVendorPayment({
    mandate,
    proposal,
    executePayment,
    now: () => generatedAt,
  });
  const record = {
    schema_version: "delta.partner_demo.record.v2",
    artifact_class: "SIMULATED_PARTNER_DEMO",
    generated_at: evaluated.generated_at,
    commercial_frame:
      "Brex-style vendor-payment and procurement execution boundary.",
    integration_disclaimer:
      "Local simulation only. This is not a Brex integration and no external payment system was contacted.",
    agent: {
      role: "simulated-procurement-agent",
      action: "propose_vendor_payment",
    },
    ...evaluated,
  };
  return { ...record, record_digest: digest(record) };
}

export async function evaluateAndGateVendorPayment({
  mandate,
  proposal,
  collectEvidence = collectPartnerDemoEvidence,
  prepareExecutionPayload = prepareVendorPaymentExecutionPayload,
  executePayment = simulatedVendorPaymentExecutor,
  receiptSigner,
  grantStore = createInMemorySingleUseGrantStore(),
  now = () => new Date(),
}) {
  const generatedAt = now();
  const effectiveMandate =
    mandate ?? createPartnerDemoMandate({ authorizedAt: generatedAt });
  assertMandate(effectiveMandate);
  assertProposal(proposal);
  const evidence = await collectEvidence(clone(proposal), {
    collectedAt: generatedAt,
  });
  assertEvidence(evidence);
  const executionPayload = await prepareExecutionPayload(
    clone(proposal),
    clone(evidence),
  );
  assertExecutionPayload(executionPayload);
  const decision = evaluateVendorPaymentMandate(
    effectiveMandate,
    proposal,
    evidence,
    executionPayload,
    { evaluatedAt: generatedAt },
  );
  const signer = receiptSigner ?? createPartnerDemoSigner();
  const receipt = createPartnerDemoReceipt(decision, proposal, {
    signer,
    receiptExpiresAt: effectiveMandate.expires_at,
  });
  const receiptVerification = inspectPartnerDemoReceipt(receipt, {
    trustedPublicKeyPem: signer.public_key_pem,
    mandate: effectiveMandate,
    proposal,
    evidence,
    executionPayload,
    decision,
    current: generatedAt,
  });
  const execution = {
    gate:
      "trusted receipt + exact mandate/proposal/evidence/payload + PASS + active window + one-use grant",
    eligibility: receiptVerification.execution_authorized
      ? "ELIGIBLE"
      : decision.decision === "REVIEW"
        ? "SUSPEND_FOR_REVIEW"
        : "LOCKED",
    receipt_verified: receiptVerification.artifact_verified,
    exact_payload_match:
      receipt.payload.execution_payload_digest === digest(executionPayload),
    grant_id: receipt.payload.execution_grant?.grant_id ?? null,
    grant_consumed: false,
    replay_blocked: false,
    submission_state: "NOT_SUBMITTED",
    adapter_invoked: false,
    money_moved: false,
    result: null,
  };

  if (receiptVerification.execution_authorized) {
    const consumed = await grantStore.consume(
      receipt.payload.execution_grant,
      async () => {
        execution.adapter_invoked = true;
        return executePayment(clone(executionPayload), clone(receipt));
      },
    );
    execution.grant_consumed = consumed.consumed;
    execution.replay_blocked = consumed.replay_blocked;
    execution.submission_state = consumed.status;
    execution.result = consumed.result;
    execution.eligibility = consumed.replay_blocked
      ? "REPLAY_BLOCKED"
      : "GRANT_CONSUMED";
  }

  return {
    generated_at: generatedAt.toISOString(),
    mandate: clone(effectiveMandate),
    proposal: clone(proposal),
    evidence: clone(evidence),
    execution_payload: clone(executionPayload),
    decision,
    receipt,
    receipt_verification: receiptVerification,
    execution,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUsd(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function renderPartnerDemoHtml(record) {
  const decision = record.decision.decision;
  const decisionClass =
    decision === "PASS" ? "pass" : decision === "REVIEW" ? "review" : "block";
  const executionStatement = record.execution.adapter_invoked
    ? "SIMULATED ADAPTER INVOKED ONCE"
    : decision === "REVIEW"
      ? "WORKFLOW MUST SUSPEND"
      : "ADAPTER LOCKED";
  const failures = [
    ...record.decision.blocking_failures,
    ...record.decision.review_reasons,
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>delta × Mastra partner proof — ${escapeHtml(decision)}</title>
  <style>
    :root{--ink:#151515;--muted:#696762;--line:#d8d4ca;--paper:#f3f0e8;--white:#fff;--green:#116443;--red:#a02d27;--amber:#875800;--blue:#304fca}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .banner{padding:12px 20px;background:#652414;color:#fff;text-align:center;font-weight:900;letter-spacing:.07em}
    main{max-width:1120px;margin:auto;padding:40px 28px 60px}.eyebrow{color:var(--blue);font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
    h1{margin:10px 0;font-size:44px;line-height:1.03;letter-spacing:-.04em}.lede{max-width:850px;color:var(--muted);font-size:18px}
    .status{display:flex;justify-content:space-between;gap:18px;margin:26px 0;padding:20px;border:1px solid var(--line);border-radius:15px;background:var(--white)}
    .pill{padding:8px 14px;border-radius:999px;font-weight:900}.pass{color:var(--green);background:#e6f3ec}.block{color:var(--red);background:#fae7e5}.review{color:var(--amber);background:#fff2cf}
    .flow,.grid{display:grid;gap:14px}.flow{grid-template-columns:repeat(5,1fr);margin-bottom:16px}.grid{grid-template-columns:1fr 1fr}
    .step,.card{border:1px solid var(--line);border-radius:13px;background:var(--white);padding:17px}.step b{display:block;margin-bottom:7px}.step span,dt{color:var(--muted)}
    .card h2{margin:0 0 13px;font-size:18px}dl{display:grid;grid-template-columns:1fr auto;gap:8px 14px;margin:0}dd{margin:0;font-weight:750;text-align:right}
    .wide{grid-column:1/-1}code{font-size:12px;word-break:break-all}pre{overflow:auto;padding:15px;border-radius:9px;background:#101827;color:#e7ecff;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
    footer{margin-top:20px;color:var(--muted);font-size:12px}@media(max-width:780px){h1{font-size:34px}.flow,.grid{grid-template-columns:1fr}.wide{grid-column:auto}.status{flex-direction:column}}
  </style>
</head>
<body>
  <div class="banner">LOCAL SIMULATION · NOT A LIVE MASTRA OR BREX INTEGRATION · NO MONEY MOVED</div>
  <main>
    <div class="eyebrow">delta × Mastra · mandate-gated vendor payment</div>
    <h1>A schema-valid payment is not necessarily authorized.</h1>
    <p class="lede">The agent proposes. Server-owned fixtures establish vendor, invoice, PO, bank and account facts. Delta binds the mandate, evidence and exact prepared payload into a controller-trusted receipt. Only PASS can consume the one-use grant.</p>
    <section class="status"><span class="pill ${decisionClass}">${escapeHtml(decision)}</span><strong>${escapeHtml(executionStatement)}</strong></section>
    <section class="flow">
      <div class="step"><b>1 · Authorize</b><span>Human mandate</span></div>
      <div class="step"><b>2 · Propose</b><span>Typed agent input</span></div>
      <div class="step"><b>3 · Resolve</b><span>Server-owned fixture evidence</span></div>
      <div class="step"><b>4 · Verify</b><span>Exact payload + receipt</span></div>
      <div class="step"><b>5 · Gate</b><span>One-use submission grant</span></div>
    </section>
    <section class="grid">
      <article class="card"><h2>Mandate and proposal</h2><dl>
        <dt>Vendor</dt><dd>${escapeHtml(record.proposal.vendor_name)}</dd>
        <dt>Amount</dt><dd>${formatUsd(record.proposal.amount_cents)}</dd>
        <dt>Hard cap</dt><dd>${formatUsd(record.mandate.max_payment_cents)}</dd>
        <dt>Review above</dt><dd>${formatUsd(record.mandate.human_review_above_cents)}</dd>
      </dl></article>
      <article class="card"><h2>Server-owned fixture evidence</h2><dl>
        <dt>Vendor status</dt><dd>${escapeHtml(record.evidence.vendor_status)}</dd>
        <dt>Duplicate invoice</dt><dd>${record.evidence.invoice_duplicate ? "YES" : "NO"}</dd>
        <dt>PO status</dt><dd>${escapeHtml(record.evidence.purchase_order_status)}</dd>
        <dt>Bank details changed</dt><dd>${record.evidence.bank_details_changed ? "YES" : "NO"}</dd>
      </dl></article>
      <article class="card"><h2>Decision and receipt</h2><dl>
        <dt>Failures/review reasons</dt><dd>${failures.length}</dd>
        <dt>Receipt integrity</dt><dd>${record.receipt_verification.artifact_verified ? "VERIFIED" : "FAILED"}</dd>
        <dt>Signer</dt><dd>controller-pinned demo key</dd>
        <dt>Execution authorized</dt><dd>${record.receipt_verification.execution_authorized ? "YES" : "NO"}</dd>
      </dl></article>
      <article class="card"><h2>Deterministic gate</h2><dl>
        <dt>Eligibility</dt><dd>${escapeHtml(record.execution.eligibility)}</dd>
        <dt>Exact payload</dt><dd>${record.execution.exact_payload_match ? "MATCH" : "MISMATCH"}</dd>
        <dt>Grant consumed</dt><dd>${record.execution.grant_consumed ? "YES" : "NO"}</dd>
        <dt>Submission state</dt><dd>${escapeHtml(record.execution.submission_state)}</dd>
      </dl></article>
      <article class="card wide"><h2>Bound digests</h2><dl>
        <dt>Mandate</dt><dd><code>${escapeHtml(record.decision.mandate_digest)}</code></dd>
        <dt>Proposal</dt><dd><code>${escapeHtml(record.decision.proposal_digest)}</code></dd>
        <dt>Evidence</dt><dd><code>${escapeHtml(record.decision.evidence_digest)}</code></dd>
        <dt>Execution payload</dt><dd><code>${escapeHtml(record.decision.execution_payload_digest)}</code></dd>
        <dt>Receipt</dt><dd><code>${escapeHtml(record.receipt.receipt_digest)}</code></dd>
      </dl></article>
      <article class="card wide"><h2>Machine-readable record</h2><pre>${escapeHtml(JSON.stringify(record, null, 2))}</pre></article>
    </section>
    <footer>${escapeHtml(record.integration_disclaimer)} The ephemeral signer is trusted only because the controller pins it for this run; production requires a trusted delta signer registry and durable transactional grant store.</footer>
  </main>
</body>
</html>`;
}

export function renderMastraPartnerBundleHtml(bundle) {
  const outcomeCards = bundle.records
    .map((record) => {
      const decision = record.decision.decision;
      const reasons = [
        ...record.decision.blocking_failures,
        ...record.decision.review_reasons,
      ];
      return `<article class="outcome ${decision.toLowerCase()}">
        <header><strong>${escapeHtml(decision)}</strong><span>${formatUsd(record.proposal.amount_cents)}</span></header>
        <p>${escapeHtml(record.proposal.vendor_name)} · ${escapeHtml(record.proposal.invoice_id)}</p>
        <dl>
          <dt>Receipt integrity</dt><dd>${record.receipt_verification.artifact_verified ? "VERIFIED" : "FAILED"}</dd>
          <dt>Execution eligibility</dt><dd>${escapeHtml(record.execution.eligibility)}</dd>
          <dt>Adapter invoked</dt><dd>${record.execution.adapter_invoked ? "YES — SIMULATED" : "NO"}</dd>
          <dt>Grant consumed</dt><dd>${record.execution.grant_consumed ? "YES — ONE USE" : "NO"}</dd>
        </dl>
        <div class="reason">${reasons.length > 0 ? reasons.map(({ id, reason }) => `<b>${escapeHtml(id)}</b>: ${escapeHtml(reason)}`).join("<br>") : "All hard constraints satisfied; exact payload eligible for one simulated submission."}</div>
        <code>${escapeHtml(record.receipt.receipt_digest)}</code>
      </article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mastra × delta partner proof</title>
  <style>
    :root{--ink:#151515;--muted:#66645f;--line:#d8d4ca;--paper:#f4f1e9;--white:#fff;--green:#126345;--red:#9f302b;--amber:#875900;--blue:#2f4fc7}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .banner{padding:12px 20px;background:#642414;color:white;text-align:center;font-weight:900;letter-spacing:.07em}
    main{max-width:1180px;margin:auto;padding:42px 28px 64px}.eyebrow{color:var(--blue);font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
    h1{margin:10px 0;font-size:46px;line-height:1.02;letter-spacing:-.04em}.lede{max-width:900px;color:var(--muted);font-size:18px}
    .invariant{margin:26px 0;padding:18px 20px;border-left:5px solid var(--blue);background:var(--white);font-weight:750}
    .flow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:20px 0}.flow div,.outcome{border:1px solid var(--line);border-radius:13px;background:var(--white);padding:16px}.flow b{display:block;margin-bottom:5px}.flow span{color:var(--muted);font-size:13px}
    .outcomes{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.outcome{border-top-width:6px}.outcome.pass{border-top-color:var(--green)}.outcome.block{border-top-color:var(--red)}.outcome.review{border-top-color:var(--amber)}
    .outcome header{display:flex;justify-content:space-between;font-size:20px}.outcome p{color:var(--muted);min-height:42px}.outcome dl{display:grid;grid-template-columns:1fr auto;gap:8px;margin:16px 0}.outcome dd{margin:0;font-weight:750;text-align:right}.reason{min-height:118px;padding:12px;border-radius:8px;background:#f7f6f2;font-size:13px}.outcome code{display:block;margin-top:12px;color:var(--muted);font-size:10px;word-break:break-all}
    .truth{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:14px}.truth article{padding:18px;border:1px solid var(--line);border-radius:13px;background:var(--white)}.truth h2{margin:0 0 8px;font-size:18px}.truth ul{margin:0;padding-left:19px}
    footer{margin-top:20px;color:var(--muted);font-size:12px}@media(max-width:850px){h1{font-size:34px}.flow,.outcomes,.truth{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="banner">LOCAL PARTNER PROOF · NO LIVE MASTRA SERVER, BREX API, PRODUCTION DELTA, OR MONEY MOVEMENT</div>
  <main>
    <div class="eyebrow">Mastra × delta · Brex-style vendor-payment boundary</div>
    <h1>Schema-valid is not the same as authorized.</h1>
    <p class="lede">Mastra gives the agent a typed action surface. Delta checks whether the exact vendor, invoice, amount, account, bank details and timing match what the business authorized—before the payment adapter is reachable.</p>
    <div class="invariant">Agent proposes → trusted runtime resolves fixture evidence → delta signs PASS / BLOCK / REVIEW → exact verified PASS consumes one execution grant.</div>
    <section class="flow">
      <div><b>1 · Mandate</b><span>Human-authorized scope</span></div>
      <div><b>2 · Proposal</b><span>Strict Mastra tool input</span></div>
      <div><b>3 · Evidence</b><span>Server-owned demo fixtures</span></div>
      <div><b>4 · Receipt</b><span>Bound digests + pinned signer</span></div>
      <div><b>5 · Gate</b><span>One use; reconcile ambiguity</span></div>
    </section>
    <section class="outcomes">${outcomeCards}</section>
    <section class="truth">
      <article><h2>What this runs</h2><ul>
        <li>Strict tool and handler schemas</li>
        <li>Controller-owned IDs and authorization context</li>
        <li>Fixture vendor, invoice, PO, bank and account evidence</li>
        <li>Exact prepared-payment payload binding</li>
        <li>Signed receipts, expiry, replay blocking and reconciliation state</li>
      </ul></article>
      <article><h2>What remains a partner build</h2><ul>
        <li>Authenticated Mastra server middleware and production storage</li>
        <li>Production delta signer, verifier and mandate adapter</li>
        <li>Authoritative enterprise evidence sources</li>
        <li>Reviewed Brex sandbox/payment adapter and reconciliation</li>
        <li>Not installed into Mastra product/repo and not connected to Brex</li>
      </ul></article>
    </section>
    <footer>Bundle digest: ${escapeHtml(bundle.bundle_digest)} · The separate reference package runs Mastra 1.53 createTool plus persisted REVIEW suspend/resume against in-memory LibSQL; this overview command remains a deterministic local three-outcome presentation harness.</footer>
  </main>
</body>
</html>`;
}

async function ensurePrivateDirectory(directoryPath) {
  try {
    const existing = await lstat(directoryPath);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error(`Refusing unsafe report directory: ${directoryPath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(directoryPath, {
      mode: PRIVATE_DIRECTORY_MODE,
      recursive: false,
    });
  }
  await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
}

export async function writePartnerDemoReport(
  record,
  {
    harnessRoot = HARNESS_ROOT,
    uniqueId = randomUUID,
    reportPrefix = "partner-demo",
  } = {},
) {
  const runtimeDir = path.join(harnessRoot, "runtime");
  const outputDir = path.join(runtimeDir, "artifacts");
  await ensurePrivateDirectory(runtimeDir);
  await ensurePrivateDirectory(outputDir);
  const id = String(uniqueId())
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 16);
  if (!id) throw new Error("Partner demo report ID is invalid");
  if (!["partner-demo", "mastra-demo"].includes(reportPrefix)) {
    throw new Error("Partner demo report prefix is invalid");
  }
  const stem = `${reportPrefix}-${record.decision.decision.toLowerCase()}-${id}`;
  const jsonPath = path.join(outputDir, `${stem}.json`);
  const htmlPath = path.join(outputDir, `${stem}.html`);
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
    mode: PRIVATE_FILE_MODE,
  });
  try {
    await writeFile(htmlPath, renderPartnerDemoHtml(record), {
      flag: "wx",
      mode: PRIVATE_FILE_MODE,
    });
  } catch (error) {
    await unlink(jsonPath).catch(() => {});
    throw error;
  }
  await chmod(jsonPath, PRIVATE_FILE_MODE);
  await chmod(htmlPath, PRIVATE_FILE_MODE);
  return { jsonPath, htmlPath };
}

export async function writeMastraPartnerBundleReport(
  bundle,
  {
    harnessRoot = HARNESS_ROOT,
    uniqueId = randomUUID,
  } = {},
) {
  const runtimeDir = path.join(harnessRoot, "runtime");
  const outputDir = path.join(runtimeDir, "artifacts");
  await ensurePrivateDirectory(runtimeDir);
  await ensurePrivateDirectory(outputDir);
  const id = String(uniqueId())
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 16);
  if (!id) throw new Error("Mastra bundle report ID is invalid");
  const stem = `mastra-partner-bundle-${id}`;
  const jsonPath = path.join(outputDir, `${stem}.json`);
  const htmlPath = path.join(outputDir, `${stem}.html`);
  await writeFile(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, {
    flag: "wx",
    mode: PRIVATE_FILE_MODE,
  });
  try {
    await writeFile(htmlPath, renderMastraPartnerBundleHtml(bundle), {
      flag: "wx",
      mode: PRIVATE_FILE_MODE,
    });
  } catch (error) {
    await unlink(jsonPath).catch(() => {});
    throw error;
  }
  await chmod(jsonPath, PRIVATE_FILE_MODE);
  await chmod(htmlPath, PRIVATE_FILE_MODE);
  return { jsonPath, htmlPath };
}
