import {
  assertMandateAdapter,
  assertMandateStatus,
  assertCompleteCoinbaseProofBindings,
  assertIntentBinding,
  assertProposalBinding,
  assertVerifiedProof,
  isTerminalMandateStatus,
} from "./contract.js";
import { toDeltaWireAttributes } from "./coinbase-policy.js";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function poll({
  read,
  terminal,
  timeoutMs,
  pollIntervalMs,
  timeoutMessage,
}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = await read();
    if (terminal(value)) return value;
    if (Date.now() >= deadline) throw new Error(timeoutMessage);
    await sleep(pollIntervalMs);
  }
}

export async function evaluateMandateCandidate({
  adapter,
  policySource,
  parameters,
  actionRecord,
  authorization,
  proofEvidenceBindings,
  timeoutMs = 60_000,
  pollIntervalMs = 250,
}) {
  assertMandateAdapter(adapter);
  if (typeof policySource !== "string" || !policySource.trim()) {
    throw new Error("Delta policy source is required");
  }
  if (
    !actionRecord ||
    typeof actionRecord !== "object" ||
    Array.isArray(actionRecord)
  ) {
    throw new Error("A frozen Coinbase action record is required");
  }
  const requiredProofEvidenceBindings =
    assertCompleteCoinbaseProofBindings(proofEvidenceBindings);
  const expectedAttrs = toDeltaWireAttributes(parameters);

  const { policyId } = await adapter.submitPolicy(policySource);
  if (typeof policyId !== "string" || !policyId) {
    throw new Error("Delta adapter did not return a policy ID");
  }
  const { intentId } = await adapter.authorizeIntent({
    policyId,
    parameters,
    authorization,
  });
  if (typeof intentId !== "string" || !intentId) {
    throw new Error("Delta adapter did not return an intent ID");
  }
  const prepared = await adapter.prepareProposal({ actionRecord });
  const solution = prepared?.solution;
  if (typeof solution !== "string" || !solution) {
    throw new Error("Delta adapter did not return a proposal solution");
  }
  await adapter.submitProposal({ intentId, solution });

  const status = await poll({
    read: async () => {
      const current = assertMandateStatus(
        await adapter.getStatus({ intentId }),
      );
      if (current.proposal) {
        assertProposalBinding(current.proposal, solution);
      }
      if (
        ["success", "failure", "expired"].includes(current.status) &&
        current.intent_id !== intentId
      ) {
        throw new Error("Delta status is not bound to the authorized intent");
      }
      return current;
    },
    terminal: isTerminalMandateStatus,
    timeoutMs,
    pollIntervalMs,
    timeoutMessage:
      "Delta evaluation did not reach a terminal status before the deadline",
  });

  if (status.status !== "success") {
    return {
      status: status.status,
      policy_id: policyId,
      intent_id: intentId,
      proposal: status.proposal ?? null,
      evidence: status.evidence ?? null,
      constraint_failures: status.constraint_failures ?? [],
      reason: status.reason ?? null,
      proof: null,
      verified: false,
    };
  }
  assertProposalBinding(status.proposal, solution);

  const verification = await poll({
    read: () => adapter.getVerificationOutcome({ intentId }),
    terminal: (value) =>
      value != null &&
      ["success", "failure", "expired"].includes(value.outcome),
    timeoutMs,
    pollIntervalMs,
    timeoutMessage:
      "Delta verifier did not confirm the evaluation before the deadline",
  });
  if (verification.outcome !== "success") {
    throw new Error(
      `Delta verifier rejected the evaluation: ${verification.reason ?? verification.outcome}`,
    );
  }
  assertProposalBinding(verification.proposal, solution);
  assertIntentBinding(
    verification.intent,
    { intentId, policyId, expectedAttrs },
    "Delta verifier outcome intent",
  );

  const proof = await poll({
    read: () => adapter.getProof({ intentId }),
    terminal: (value) => value != null,
    timeoutMs,
    pollIntervalMs,
    timeoutMessage: "Delta verifier did not return the proof before the deadline",
  });
  assertVerifiedProof({
    proof,
    intentId,
    policyId,
    solution,
    expectedAttrs,
    evidenceBindings: requiredProofEvidenceBindings,
  });

  return {
    status: "success",
    policy_id: policyId,
    intent_id: intentId,
    proposal: status.proposal,
    evidence: status.evidence,
    constraint_failures: [],
    reason: null,
    proof,
    verified: true,
  };
}

export function mandateDisposition(result, attempt, maxAttempts) {
  if (
    result?.status === "success" &&
    result.verified === true &&
    result.proof &&
    typeof result.proof === "object"
  ) {
    return "EXECUTE";
  }
  if (
    result?.status === "failure" &&
    Array.isArray(result.constraint_failures) &&
    result.constraint_failures.length > 0 &&
    attempt < maxAttempts
  ) {
    return "RETRY";
  }
  return "STOP";
}

export async function runMandateAttemptLoop({
  propose,
  collectEvidence,
  evaluate,
  execute,
  maxAttempts = 3,
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("maxAttempts must be an integer from 1 through 10");
  }
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const previous = attempts.at(-1) ?? null;
    const proposal = await propose({ attempt, previous });
    const candidate =
      typeof collectEvidence === "function"
        ? await collectEvidence({ attempt, proposal, previous })
        : proposal;
    const result = await evaluate(candidate, attempt);
    const disposition = mandateDisposition(result, attempt, maxAttempts);
    attempts.push({ attempt, candidate, result, disposition });
    if (disposition === "EXECUTE") {
      return {
        status: "EXECUTED",
        attempts,
        execution: await execute(candidate, result),
      };
    }
    if (disposition === "STOP") {
      return { status: "STOPPED", attempts, execution: null };
    }
  }
  return { status: "STOPPED", attempts, execution: null };
}
