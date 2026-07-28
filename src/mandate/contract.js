import { canonicalize } from "../evidence.js";

const STATUS_VALUES = new Set([
  "open",
  "processing",
  "success",
  "failure",
  "review",
  "expired",
]);

export const COINBASE_PROOF_BINDING_FIELDS = Object.freeze([
  "product_id",
  "action_descriptor_digest",
  "authorized_limit_price",
  "funding_evidence_digest",
  "preview_id",
  "create_payload_digest",
  "preview_request_digest",
  "portfolio_fingerprint",
  "credential_fingerprint",
]);

function requireFunction(adapter, name) {
  if (typeof adapter?.[name] !== "function") {
    throw new Error(`Mandate adapter must implement ${name}()`);
  }
}

export function assertMandateAdapter(adapter) {
  for (const method of [
    "submitPolicy",
    "authorizeIntent",
    "prepareProposal",
    "submitProposal",
    "getStatus",
    "getVerificationOutcome",
    "getProof",
  ]) {
    requireFunction(adapter, method);
  }
  return adapter;
}

export function assertMandateStatus(status) {
  if (!status || !STATUS_VALUES.has(status.status)) {
    throw new Error("Mandate adapter returned an invalid status");
  }
  if (
    ["processing", "success", "failure", "review"].includes(status.status) &&
    typeof status.proposal?.solution !== "string"
  ) {
    throw new Error(`Mandate ${status.status} status omitted its proposal`);
  }
  if (
    status.status === "failure" &&
    !Array.isArray(status.constraint_failures)
  ) {
    throw new Error("Mandate failure omitted constraint_failures");
  }
  if (
    ["success", "failure", "review", "expired"].includes(status.status) &&
    (typeof status.intent_id !== "string" || !status.intent_id)
  ) {
    throw new Error(`Mandate ${status.status} status omitted its intent ID`);
  }
  return status;
}

export function isTerminalMandateStatus(status) {
  return ["success", "failure", "review", "expired"].includes(status.status);
}

export function assertProposalBinding(actual, expectedSolution) {
  if (actual?.solution !== expectedSolution) {
    throw new Error("Verified Delta proposal does not match the frozen Coinbase action");
  }
}

export function assertIntentBinding(
  actual,
  { intentId, policyId, expectedAttrs },
  source = "Delta artifact",
) {
  if (actual?.id !== intentId || actual?.policy_id !== policyId) {
    throw new Error(`${source} is not bound to the authorized intent and policy`);
  }
  if (!actual?.attrs || !expectedAttrs) {
    throw new Error(`${source} attributes do not match the authorized intent`);
  }
  let attributesMatch = false;
  try {
    attributesMatch =
      canonicalize(actual.attrs) === canonicalize(expectedAttrs);
  } catch {
    attributesMatch = false;
  }
  if (!attributesMatch) {
    throw new Error(`${source} attributes do not match the authorized intent`);
  }
  return actual;
}

export function assertCompleteCoinbaseProofBindings(bindings) {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
    throw new Error("Complete Coinbase proof evidence bindings are required");
  }
  const actual = Object.keys(bindings).sort();
  const expected = [...COINBASE_PROOF_BINDING_FIELDS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error(
      `Coinbase proof evidence bindings must contain exactly: ${COINBASE_PROOF_BINDING_FIELDS.join(", ")}`,
    );
  }
  for (const name of COINBASE_PROOF_BINDING_FIELDS) {
    if (typeof bindings[name] !== "string" || !bindings[name]) {
      throw new Error(`Coinbase proof evidence binding ${name} is required`);
    }
  }
  return bindings;
}

export function readDeltaWireScalar(objectValue, name) {
  const tagged = objectValue?.fields?.[name];
  if (!tagged || typeof tagged !== "object" || Array.isArray(tagged)) {
    throw new Error(`Delta proof evidence omitted ${name}`);
  }
  for (const tag of ["String", "Int", "Bool"]) {
    if (Object.hasOwn(tagged, tag)) return tagged[tag];
  }
  throw new Error(`Delta proof evidence ${name} is not a scalar`);
}

function hasNonemptyProofMaterial(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
}

export function assertVerifiedProof({
  proof,
  intentId,
  policyId,
  solution,
  expectedAttrs,
  evidenceBindings,
}) {
  if (!proof || typeof proof !== "object") {
    throw new Error("Delta verifier did not return a proof");
  }
  if (!hasNonemptyProofMaterial(proof.sp1_proof)) {
    throw new Error("Delta verifier proof omitted nonempty sp1_proof");
  }
  const signedIntent = proof.signed_intent;
  assertIntentBinding(
    signedIntent?.intent,
    { intentId, policyId, expectedAttrs },
    "Delta proof SignedIntent",
  );
  assertProposalBinding(proof.proposal, solution);
  const requiredBindings = assertCompleteCoinbaseProofBindings(evidenceBindings);
  for (const [name, expected] of Object.entries(requiredBindings)) {
    if (readDeltaWireScalar(proof.evidence, name) !== expected) {
      throw new Error(
        `Delta proof evidence ${name} does not match the frozen Coinbase action`,
      );
    }
  }
  return proof;
}
