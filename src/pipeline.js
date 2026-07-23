import { createEvidenceRecord } from "./evidence.js";
import { evaluatePreview, evaluateProposal, selectPreviewEvidence } from "./policy.js";

export async function runPreviewPipeline({
  artifactClass,
  mandate,
  order,
  previewAdapter,
  adapterMode,
}) {
  const precheck = evaluateProposal(mandate, order);
  if (precheck.verdict === "BLOCK") {
    return createEvidenceRecord({
      artifactClass,
      mandate,
      order,
      precheck,
      coinbase: {
        adapter_invoked: false,
        reason: "Blocked before Coinbase preview.",
      },
      finalVerdict: "BLOCK",
    });
  }

  let adapterResult;
  try {
    adapterResult = await previewAdapter(order);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const category =
      lower.includes("credential") || lower.includes("unauthorized") || lower.includes("401")
        ? "AUTHENTICATION_ERROR"
        : lower.includes("timed out") || lower.includes("timeout")
          ? "TIMEOUT"
          : lower.includes("preview") || lower.includes("insufficient")
            ? "COINBASE_PREVIEW_ERROR"
            : "SYSTEM_ERROR";
    return createEvidenceRecord({
      artifactClass,
      mandate,
      order,
      precheck,
      coinbase: {
        adapter_invoked: true,
        mode: adapterMode === "dry-run" ? "OFFICIAL_CLI_DRY_RUN" : "LIVE_PREVIEW",
        contacted_coinbase: adapterMode === "dry-run" ? false : "UNKNOWN",
        error: {
          category,
          message,
        },
      },
      postcheck: {
        verdict: "BLOCK",
        reason: "Failed closed because Coinbase preview did not produce a valid response.",
      },
      finalVerdict: category,
    });
  }
  if (adapterMode === "dry-run") {
    return createEvidenceRecord({
      artifactClass,
      mandate,
      order,
      precheck,
      coinbase: {
        adapter_invoked: true,
        mode: "OFFICIAL_CLI_DRY_RUN",
        contacted_coinbase: false,
        request: adapterResult.request,
        action: adapterResult.action,
      },
      finalVerdict: "CREDENTIALS_REQUIRED_FOR_LIVE_PREVIEW",
    });
  }

  const postcheck = evaluatePreview(mandate, order, adapterResult.response);
  return createEvidenceRecord({
    artifactClass,
    mandate,
    order,
    precheck,
    coinbase: {
      adapter_invoked: true,
      mode: "LIVE_PREVIEW",
      contacted_coinbase: true,
      preview: selectPreviewEvidence(adapterResult.response),
    },
    postcheck,
    finalVerdict: postcheck.verdict,
  });
}
