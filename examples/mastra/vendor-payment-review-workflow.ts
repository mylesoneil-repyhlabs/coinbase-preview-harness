import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { deltaToolResultSchema } from "./delta-vendor-payment-tool.js";

const reviewWorkflowInputSchema = z
  .object({
    evaluation: deltaToolResultSchema,
  })
  .strict();

const reviewWorkflowOutputSchema = z
  .object({
    status: z.enum([
      "NO_REVIEW_REQUIRED",
      "DECLINED",
      "REAUTHORIZE_WITH_DELTA",
    ]),
    proposal_digest: z.string().length(64),
    receipt_digest: z.string().length(64),
    reviewer_id: z.string().min(1).nullable(),
    instruction: z.string().min(1),
  })
  .strict();

export const reviewVendorPaymentStep = createStep({
  id: "review-vendor-payment",
  inputSchema: reviewWorkflowInputSchema,
  outputSchema: reviewWorkflowOutputSchema,
  suspendSchema: z
    .object({
      reason: z.string().min(1),
      proposal_digest: z.string().length(64),
      receipt_digest: z.string().length(64),
      receipt_expires_at: z.string().datetime(),
      next_action: z.literal(
        "AUTHENTICATED_REVIEWER_MUST_RESUME_OR_DECLINE",
      ),
    })
    .strict(),
  resumeSchema: z
    .object({
      decision: z.enum(["APPROVE", "DECLINE"]),
      reviewer_id: z.string().min(1),
      authenticated_by_server: z.literal(true),
      reviewed_proposal_digest: z.string().length(64),
      reviewed_receipt_digest: z.string().length(64),
    })
    .strict(),
  retries: 0,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { evaluation } = inputData;
    const proposalDigest = evaluation.bound_artifacts.proposal_digest;
    const receiptDigest = evaluation.receipt.receipt_digest;

    if (evaluation.status !== "REVIEW") {
      return {
        status: "NO_REVIEW_REQUIRED" as const,
        proposal_digest: proposalDigest,
        receipt_digest: receiptDigest,
        reviewer_id: null,
        instruction:
          "Continue according to the original delta decision; this step does not change it.",
      };
    }

    if (!resumeData) {
      return suspend({
        reason:
          "Delta returned REVIEW. The payment remains locked pending an authenticated decision.",
        proposal_digest: proposalDigest,
        receipt_digest: receiptDigest,
        receipt_expires_at: evaluation.receipt.payload.expires_at,
        next_action:
          "AUTHENTICATED_REVIEWER_MUST_RESUME_OR_DECLINE",
      });
    }

    if (
      resumeData.reviewed_proposal_digest !== proposalDigest ||
      resumeData.reviewed_receipt_digest !== receiptDigest
    ) {
      throw new Error(
        "Review resume data does not match the suspended proposal and receipt",
      );
    }

    if (resumeData.decision === "DECLINE") {
      return {
        status: "DECLINED" as const,
        proposal_digest: proposalDigest,
        receipt_digest: receiptDigest,
        reviewer_id: resumeData.reviewer_id,
        instruction:
          "Keep the payment locked. No fresh delta decision is requested.",
      };
    }

    return {
      status: "REAUTHORIZE_WITH_DELTA" as const,
      proposal_digest: proposalDigest,
      receipt_digest: receiptDigest,
      reviewer_id: resumeData.reviewer_id,
      instruction:
        "Request a fresh delta decision bound to this authenticated review. Never mutate REVIEW into PASS inside the workflow.",
    };
  },
});

export const vendorPaymentReviewWorkflow = createWorkflow({
  id: "vendor-payment-review",
  inputSchema: reviewWorkflowInputSchema,
  outputSchema: reviewWorkflowOutputSchema,
  retryConfig: {
    attempts: 0,
    delay: 0,
  },
})
  .then(reviewVendorPaymentStep)
  .commit();
