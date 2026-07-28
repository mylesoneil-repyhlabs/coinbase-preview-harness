import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createMastraVendorPaymentHandler } from "../../src/mastra-partner.js";

export const vendorPaymentInputSchema = z
  .object({
    vendor_id: z.string().min(1),
    vendor_name: z.string().min(1),
    amount_cents: z.number().int().positive().safe(),
    currency: z.literal("USD"),
    destination_account_id: z.string().min(1),
    purchase_order_id: z.string().min(1),
    invoice_id: z.string().min(1),
    cost_center: z.string().min(1),
    memo: z.string().min(1),
  })
  .strict();

const reasonSchema = z
  .object({
    id: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const receiptPayloadSchema = z
  .object({
    schema_version: z.literal("delta.vendor_payment.receipt_payload.v2"),
    receipt_id: z.string().min(1),
    artifact_class: z.literal("SIMULATED_PARTNER_DEMO"),
    issuer: z.literal("local-delta-simulation"),
    signer_key_fingerprint: z.string().length(64),
    decision: z.enum(["PASS", "BLOCK", "REVIEW"]),
    evaluated_at: z.string().datetime(),
    not_before: z.string().datetime(),
    expires_at: z.string().datetime(),
    mandate_id: z.string().min(1),
    mandate_authorization_id: z.string().min(1),
    mandate_digest: z.string().length(64),
    proposal_id: z.string().min(1),
    proposal_digest: z.string().length(64),
    evidence_digest: z.string().length(64),
    execution_payload_digest: z.string().length(64),
    execution_target: z.literal("brex-style-vendor-payment-boundary"),
    blocking_failures: z.array(reasonSchema),
    review_reasons: z.array(reasonSchema),
    execution_grant: z
      .object({
        grant_id: z.string().length(64),
        execution_payload_digest: z.string().length(64),
        expires_at: z.string().datetime(),
        max_uses: z.literal(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

const receiptSchema = z
  .object({
    schema_version: z.literal("delta.vendor_payment.signed_receipt.v2"),
    signature_algorithm: z.literal("Ed25519"),
    trust_note: z.string().min(1),
    payload: receiptPayloadSchema,
    public_key_pem: z.string().min(1),
    signature: z.string().min(1),
    receipt_digest: z.string().length(64),
  })
  .strict();

const verificationChecksSchema = z
  .object({
    closed_schema: z.boolean(),
    receipt_digest_match: z.boolean(),
    cryptographic_signature_valid: z.boolean(),
    signer_key_pinned: z.boolean(),
    signer_fingerprint_match: z.boolean(),
    time_window_active: z.boolean(),
    exact_mandate_match: z.boolean(),
    exact_proposal_match: z.boolean(),
    exact_evidence_match: z.boolean(),
    exact_execution_payload_match: z.boolean(),
    exact_decision_match: z.boolean(),
    execution_grant_consistent: z.boolean(),
    decision_is_pass: z.boolean(),
  })
  .strict();

const executionSchema = z
  .object({
    gate: z.string().min(1),
    eligibility: z.enum([
      "ELIGIBLE",
      "GRANT_CONSUMED",
      "LOCKED",
      "SUSPEND_FOR_REVIEW",
      "REPLAY_BLOCKED",
    ]),
    receipt_verified: z.boolean(),
    exact_payload_match: z.boolean(),
    grant_id: z.string().length(64).nullable(),
    grant_consumed: z.boolean(),
    replay_blocked: z.boolean(),
    submission_state: z.enum([
      "NOT_SUBMITTED",
      "SUBMISSION_IN_FLIGHT",
      "SUBMITTED_REQUIRES_RECONCILIATION",
      "UNKNOWN_REQUIRES_RECONCILIATION",
    ]),
    adapter_invoked: z.boolean(),
    money_moved: z.literal(false),
    result: z
      .object({
        execution_id: z.string().min(1),
        status: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const deltaToolResultSchema = z
  .object({
    schema_version: z.literal(
      "delta.mastra.vendor_payment_tool_result.v2",
    ),
    status: z.enum(["PASS", "BLOCK", "REVIEW"]),
    disposition: z.enum([
      "SUSPEND_WORKFLOW",
      "RETURN_VIOLATIONS",
      "ONE_USE_SUBMISSION_ATTEMPTED",
    ]),
    mandate_id: z.string().min(1),
    mandate_authorization_id: z.string().min(1),
    proposal_id: z.string().min(1),
    bound_artifacts: z
      .object({
        mandate_digest: z.string().length(64),
        proposal_digest: z.string().length(64),
        evidence_digest: z.string().length(64),
        execution_payload_digest: z.string().length(64),
      })
      .strict(),
    evidence_summary: z
      .object({
        artifact_class: z.literal("SERVER_OWNED_DEMO_FIXTURE"),
        collected_by: z.literal(
          "simulated-procurement-evidence-adapter",
        ),
        vendor_status: z.string().min(1),
        invoice_duplicate: z.boolean(),
        purchase_order_status: z.string().min(1),
        bank_details_changed: z.boolean(),
      })
      .strict(),
    blocking_failures: z.array(reasonSchema),
    review_reasons: z.array(reasonSchema),
    receipt: receiptSchema,
    receipt_verification: z
      .object({
        artifact_verified: z.boolean(),
        execution_authorized: z.boolean(),
        checks: verificationChecksSchema,
      })
      .strict(),
    execution: executionSchema,
  })
  .strict();

export type VendorPaymentInput = z.infer<typeof vendorPaymentInputSchema>;
export type DeltaToolResult = z.infer<typeof deltaToolResultSchema>;

type PaymentAdapter = (
  executionPayload: Record<string, unknown>,
  receipt: Record<string, unknown>,
) => Promise<unknown>;

export function createDeltaGatedVendorPaymentTool({
  executePayment,
}: {
  executePayment: PaymentAdapter;
}) {
  const evaluateAndGate = createMastraVendorPaymentHandler({
    executePayment,
  });

  return createTool({
    id: "delta-gated-vendor-payment",
    strict: true,
    description:
      "Propose one vendor payment for mandate evaluation. The trusted app runtime resolves evidence, binds the exact payment payload, and returns PASS, BLOCK, or REVIEW plus a signed receipt. Only PASS can consume a one-use submission grant.",
    inputSchema: vendorPaymentInputSchema,
    requestContextSchema: z
      .object({
        tenantId: z.string().min(1),
        userId: z.string().min(1),
        workflowRunId: z.string().min(1),
      })
      .strict(),
    inputExamples: [
      {
        input: {
          vendor_id: "vendor-approved-017",
          vendor_name: "Northstar Cloud Services",
          amount_cents: 240000,
          currency: "USD",
          destination_account_id: "operating-usd-001",
          purchase_order_id: "PO-2026-1042",
          invoice_id: "INV-7741",
          cost_center: "infrastructure",
          memo: "July managed infrastructure",
        },
      },
    ],
    outputSchema: deltaToolResultSchema,
    execute: async (input, context) =>
      deltaToolResultSchema.parse(
        await evaluateAndGate(input, context),
      ),
  });
}

export const simulatedDeltaGatedVendorPayment =
  createDeltaGatedVendorPaymentTool({
    executePayment: async (executionPayload) => ({
      execution_id: `simulated-${String(
        executionPayload.idempotency_key,
      ).slice(0, 16)}`,
      status: "SIMULATED_ACCEPTED",
    }),
  });
