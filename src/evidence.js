import { createHash } from "node:crypto";
import { sanitize } from "./sanitize.js";

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function digestBytes(value) {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) {
    throw new Error("byte digest input must be a string or Buffer");
  }
  return createHash("sha256").update(value).digest("hex");
}

export function createEvidenceRecord(input) {
  const safe = sanitize({
    schema: "delta.coinbase.preview_verification_record.v1",
    artifact_class: input.artifactClass,
    generated_at: new Date().toISOString(),
    evaluator: {
      name: "delta preview policy prototype",
      production_delta_verifier_invoked: false,
      note: "This is an integration prototype, not a production delta receipt or proof.",
    },
    execution: {
      execution_adapter_present: false,
      order_created: false,
      statement: "NO ORDER CREATED",
    },
    mandate: input.mandate,
    proposal: input.order,
    proposal_digest: digest(input.order),
    precheck: input.precheck,
    coinbase: input.coinbase,
    postcheck: input.postcheck ?? {
      verdict: "PENDING",
      reason: "Requires one authenticated Coinbase preview response.",
    },
    final_verdict: input.finalVerdict,
  });
  return {
    ...safe,
    record_digest: digest(safe),
  };
}
