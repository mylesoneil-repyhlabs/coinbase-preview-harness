import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { LibSQLStore } from "@mastra/libsql";
import {
  deltaToolResultSchema,
  simulatedDeltaGatedVendorPayment,
} from "./delta-vendor-payment-tool.js";
import {
  vendorPaymentReviewWorkflow,
} from "./vendor-payment-review-workflow.js";

const requestContext = new RequestContext();
requestContext.set("tenantId", "demo-company-001");
requestContext.set("userId", "demo-procurement-owner");
requestContext.set("workflowRunId", "mastra-review-run-001");

if (!simulatedDeltaGatedVendorPayment.execute) {
  throw new Error("Mastra tool execute function is unavailable");
}

const toolContext = {
  requestContext,
} as Parameters<
  NonNullable<typeof simulatedDeltaGatedVendorPayment.execute>
>[1];

const evaluation = deltaToolResultSchema.parse(
  await simulatedDeltaGatedVendorPayment.execute(
    {
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
    toolContext,
  ),
);

const storage = new LibSQLStore({
  id: "delta-mastra-review-demo",
  url: ":memory:",
});
const mastra = new Mastra({
  storage,
  workflows: { vendorPaymentReviewWorkflow },
});
const workflow = mastra.getWorkflow("vendorPaymentReviewWorkflow");
const run = await workflow.createRun();
const suspended = await run.start({
  inputData: { evaluation },
  requestContext,
});

if (suspended.status !== "suspended") {
  throw new Error(`Expected suspended workflow, got ${suspended.status}`);
}

const resumed = await run.resume({
  step: "review-vendor-payment",
  resumeData: {
    decision: "APPROVE",
    reviewer_id: "authenticated-reviewer-001",
    authenticated_by_server: true,
    reviewed_proposal_digest:
      evaluation.bound_artifacts.proposal_digest,
    reviewed_receipt_digest: evaluation.receipt.receipt_digest,
  },
});

if (resumed.status !== "success") {
  throw new Error(`Expected successful resume, got ${resumed.status}`);
}

console.log(
  JSON.stringify(
    {
      simulation_only: true,
      initial_delta_decision: evaluation.status,
      initial_execution_locked:
        evaluation.execution.adapter_invoked === false,
      workflow_initial_status: suspended.status,
      workflow_resumed_status: resumed.status,
      review_outcome: resumed.result,
      payment_adapter_invoked: false,
      live_mastra_server_or_studio_contacted: false,
      brex_contacted: false,
      production_delta_invoked: false,
      money_moved: false,
    },
    null,
    2,
  ),
);

await storage.close();
