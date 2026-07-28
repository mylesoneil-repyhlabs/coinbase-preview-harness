import { digest } from "./evidence.js";
import {
  collectPartnerDemoEvidence,
  createInMemorySingleUseGrantStore,
  createPartnerDemoMandate,
  createPartnerDemoSigner,
  evaluateAndGateVendorPayment,
  partnerDemoProposal,
  prepareVendorPaymentExecutionPayload,
} from "./partner-demo.js";

const TOOL_INPUT_FIELDS = Object.freeze([
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

function clone(value) {
  return structuredClone(value);
}

function assertToolInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Vendor-payment tool input must be an object");
  }
  const actual = Object.keys(input).sort();
  const expected = [...TOOL_INPUT_FIELDS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(
      "Vendor-payment tool input has a closed schema and cannot override controller-owned fields",
    );
  }
  for (const field of TOOL_INPUT_FIELDS.filter(
    (name) => name !== "amount_cents",
  )) {
    if (typeof input[field] !== "string" || input[field].trim().length === 0) {
      throw new Error(`Vendor-payment tool input ${field} is invalid`);
    }
  }
  if (!Number.isSafeInteger(input.amount_cents) || input.amount_cents <= 0) {
    throw new Error(
      "Vendor-payment tool input amount_cents must be a positive safe integer",
    );
  }
  if (input.currency !== "USD") {
    throw new Error("Vendor-payment tool input currency must be USD");
  }
}

function controllerProposalId(input, authorizationContext) {
  return `proposal-${digest({
    tenant_id: authorizationContext.tenant_id,
    mandate_authorization_id:
      authorizationContext.mandate_authorization_id,
    vendor_id: input.vendor_id,
    invoice_id: input.invoice_id,
    amount_cents: input.amount_cents,
    currency: input.currency,
  }).slice(0, 24)}`;
}

function defaultDemoContextResolver(context) {
  const requestContext = context.requestContext;
  return {
    tenant_id: requestContext?.get?.("tenantId") ?? null,
    user_id: requestContext?.get?.("userId") ?? null,
    workflow_run_id:
      context.workflow?.runId ??
      requestContext?.get?.("workflowRunId") ??
      null,
  };
}

function assertAuthenticatedContext(context) {
  for (const field of ["tenant_id", "user_id", "workflow_run_id"]) {
    if (typeof context[field] !== "string" || context[field].length === 0) {
      throw new Error(
        "Authenticated tenant, user, and workflow run context are required",
      );
    }
  }
}

function conciseToolResult(evaluated) {
  return {
    schema_version: "delta.mastra.vendor_payment_tool_result.v2",
    status: evaluated.decision.decision,
    disposition:
      evaluated.decision.decision === "REVIEW"
        ? "SUSPEND_WORKFLOW"
        : evaluated.decision.decision === "BLOCK"
          ? "RETURN_VIOLATIONS"
          : "ONE_USE_SUBMISSION_ATTEMPTED",
    mandate_id: evaluated.decision.mandate_id,
    mandate_authorization_id:
      evaluated.decision.mandate_authorization_id,
    proposal_id: evaluated.decision.proposal_id,
    bound_artifacts: {
      mandate_digest: evaluated.decision.mandate_digest,
      proposal_digest: evaluated.decision.proposal_digest,
      evidence_digest: evaluated.decision.evidence_digest,
      execution_payload_digest:
        evaluated.decision.execution_payload_digest,
    },
    evidence_summary: {
      artifact_class: evaluated.evidence.artifact_class,
      collected_by: evaluated.evidence.collected_by,
      vendor_status: evaluated.evidence.vendor_status,
      invoice_duplicate: evaluated.evidence.invoice_duplicate,
      purchase_order_status:
        evaluated.evidence.purchase_order_status,
      bank_details_changed: evaluated.evidence.bank_details_changed,
    },
    blocking_failures: evaluated.decision.blocking_failures.map(
      ({ id, reason }) => ({ id, reason }),
    ),
    review_reasons: evaluated.decision.review_reasons.map(
      ({ id, reason }) => ({ id, reason }),
    ),
    receipt: evaluated.receipt,
    receipt_verification: evaluated.receipt_verification,
    execution: evaluated.execution,
  };
}

/**
 * Creates the trusted payment boundary that a Mastra `createTool` should call.
 *
 * `resolveAuthenticatedContext` must derive identity from trusted server
 * middleware in production. `requestContextSchema` validates shape; it does
 * not authenticate the values.
 *
 * @param {{
 *   mandate?: ReturnType<typeof createPartnerDemoMandate>,
 *   executePayment?: (executionPayload: Record<string, unknown>, receipt: Record<string, unknown>) => Promise<unknown>,
 *   collectEvidence?: typeof collectPartnerDemoEvidence,
 *   prepareExecutionPayload?: typeof prepareVendorPaymentExecutionPayload,
 *   resolveAuthenticatedContext?: (context: Record<string, any>) => {tenant_id: string, user_id: string, workflow_run_id: string},
 *   receiptSigner?: ReturnType<typeof createPartnerDemoSigner>,
 *   grantStore?: ReturnType<typeof createInMemorySingleUseGrantStore>,
 *   now?: () => Date
 * }} [options]
 */
export function createMastraVendorPaymentHandler({
  mandate,
  executePayment,
  collectEvidence = collectPartnerDemoEvidence,
  prepareExecutionPayload = prepareVendorPaymentExecutionPayload,
  resolveAuthenticatedContext = defaultDemoContextResolver,
  receiptSigner = createPartnerDemoSigner(),
  grantStore = createInMemorySingleUseGrantStore(),
  now = () => new Date(),
} = {}) {
  const defaultAuthorizedAt = now();
  let effectiveMandate = mandate ?? null;

  return async function deltaGatedVendorPayment(input, context = {}) {
    assertToolInput(input);
    const authenticated = resolveAuthenticatedContext(context);
    assertAuthenticatedContext(authenticated);
    effectiveMandate ??= createPartnerDemoMandate({
      authorizedAt: defaultAuthorizedAt,
      tenantId: authenticated.tenant_id,
      authorizedUserId: authenticated.user_id,
    });
    const authorizationContext = {
      tenant_id: authenticated.tenant_id,
      user_id: authenticated.user_id,
      workflow_run_id: authenticated.workflow_run_id,
      mandate_authorization_id: effectiveMandate.authorization_id,
    };
    const proposal = {
      ...clone(input),
      schema_version: "delta.vendor_payment.proposal.v2",
      proposal_id: controllerProposalId(input, authorizationContext),
      proposed_by: "mastra-procurement-agent",
      execution_target: "brex-style-vendor-payment-boundary",
      authorization_context: authorizationContext,
    };
    const evaluated = await evaluateAndGateVendorPayment({
      mandate: effectiveMandate,
      proposal,
      collectEvidence,
      prepareExecutionPayload,
      executePayment,
      receiptSigner,
      grantStore,
      now,
    });
    return conciseToolResult(evaluated);
  };
}

function toolInputForScenario(scenario) {
  const fixture = partnerDemoProposal(scenario);
  return Object.fromEntries(
    TOOL_INPUT_FIELDS.map((field) => [field, clone(fixture[field])]),
  );
}

export async function runMastraPartnerDemo({
  scenario = "pass",
  executePayment,
  now = () => new Date(),
} = {}) {
  const generatedAt = now();
  const mandate = createPartnerDemoMandate({
    authorizedAt: generatedAt,
  });
  const signer = createPartnerDemoSigner();
  const grantStore = createInMemorySingleUseGrantStore();
  const handler = createMastraVendorPaymentHandler({
    mandate,
    executePayment,
    now: () => generatedAt,
    receiptSigner: signer,
    grantStore,
  });
  const contextValues = {
    tenantId: "demo-company-001",
    userId: "demo-procurement-owner",
    workflowRunId: "demo-mastra-run-001",
  };
  const toolInput = toolInputForScenario(scenario);
  const toolResult = await handler(toolInput, {
    requestContext: {
      get: (name) => contextValues[name],
    },
  });
  const authorizationContext = {
    tenant_id: contextValues.tenantId,
    user_id: contextValues.userId,
    workflow_run_id: contextValues.workflowRunId,
    mandate_authorization_id: mandate.authorization_id,
  };
  const proposal = {
    ...clone(toolInput),
    schema_version: "delta.vendor_payment.proposal.v2",
    proposal_id: controllerProposalId(toolInput, authorizationContext),
    proposed_by: "mastra-procurement-agent",
    execution_target: "brex-style-vendor-payment-boundary",
    authorization_context: authorizationContext,
  };
  const evidence = collectPartnerDemoEvidence(proposal, {
    collectedAt: generatedAt,
  });
  const executionPayload = prepareVendorPaymentExecutionPayload(
    proposal,
    evidence,
  );
  const record = {
    schema_version: "delta.partner_demo.record.v2",
    artifact_class: "SIMULATED_PARTNER_DEMO",
    generated_at: toolResult.receipt.payload.evaluated_at,
    commercial_frame:
      "Mastra agent to Brex-style vendor-payment and procurement boundary.",
    integration_disclaimer:
      "Local Mastra-shaped simulation only. No Mastra runtime, Studio, Brex API, or production delta service was contacted.",
    agent: {
      framework: "Mastra integration shape",
      role: "simulated-procurement-agent",
      action: "call_delta_gated_vendor_payment_tool",
      model_controls_execution: false,
    },
    mastra: {
      proposed_tool_id: "delta-gated-vendor-payment",
      integration_pattern:
        "Deploy createTool in the trusted Mastra app/server runtime; keep the only executor reference inside the gated closure.",
      runtime_exercised: false,
      trace_artifact_class: "HANDCRAFTED_LOCAL_DEMO_TRACE",
      trace: [
        { step: "agent_proposes", output_digest: digest(toolInput) },
        { step: "server_resolves_fixture_evidence", output: "COMPLETE" },
        { step: "delta_boundary_evaluates", output: toolResult.status },
        {
          step: "controller_pinned_receipt_verifies",
          output: toolResult.receipt_verification.artifact_verified,
        },
        {
          step: "one_use_executor_gate",
          output: toolResult.execution.eligibility,
        },
      ],
    },
    mandate: clone(mandate),
    proposal,
    evidence,
    execution_payload: executionPayload,
    decision: {
      schema_version: "delta.vendor_payment.decision.v2",
      decision: toolResult.status,
      evaluated_at: toolResult.receipt.payload.evaluated_at,
      mandate_id: toolResult.mandate_id,
      mandate_authorization_id:
        toolResult.mandate_authorization_id,
      proposal_id: toolResult.proposal_id,
      ...toolResult.bound_artifacts,
      constraints: [],
      blocking_failures: toolResult.blocking_failures,
      review_reasons: toolResult.review_reasons,
    },
    receipt: toolResult.receipt,
    receipt_verification: toolResult.receipt_verification,
    execution: toolResult.execution,
  };
  return { ...record, record_digest: digest(record) };
}

export async function runMastraPartnerBundle(options = {}) {
  const records = [];
  for (const scenario of ["pass", "block", "review"]) {
    records.push(
      await runMastraPartnerDemo({
        ...options,
        scenario,
      }),
    );
  }
  const bundle = {
    schema_version: "delta.mastra.partner_bundle.v1",
    artifact_class: "SIMULATED_MASTRA_INTEGRATION_SHAPE",
    generated_at: records[0].generated_at,
    outcomes: records.map((record) => ({
      decision: record.decision.decision,
      proposal_id: record.proposal.proposal_id,
      receipt_digest: record.receipt.receipt_digest,
      execution_eligibility: record.execution.eligibility,
      adapter_invoked: record.execution.adapter_invoked,
    })),
    records,
    claims: {
      mastra_runtime_exercised: false,
      brex_contacted: false,
      production_delta_invoked: false,
      money_moved: false,
    },
  };
  return { ...bundle, bundle_digest: digest(bundle) };
}
