import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ROOT } from "./paths.js";
import { digest } from "./evidence.js";
import { JWT_PROFILE } from "./permissions.js";

export const BOUND_EXECUTION_DIR = path.join(
  HARNESS_ROOT,
  "runtime",
  "bound-executions",
);

const BOUND_FIELDS = Object.freeze([
  "schema_version",
  "binding_id",
  "created_at",
  "status",
  "plan",
  "plan_digest",
  "policy_confirmation",
  "authorization_scope",
  "execution_digest",
  "confirmation",
]);

const SCOPE_FIELDS = Object.freeze([
  "schema_version",
  "binding_id",
  "plan_id",
  "plan_digest",
  "policy_digest",
  "safety_profile",
  "credential_binding",
]);

const CREDENTIAL_FIELDS = Object.freeze([
  "jwt_profile",
  "portfolio_fingerprint",
  "credential_fingerprint",
  "can_view",
  "can_trade",
  "can_transfer",
  "can_receive",
]);

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function assertExactFields(value, fields, name) {
  assertObject(value, name);
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (unknown.length || missing.length) {
    throw new Error(
      `${name} schema mismatch: unknown=${unknown.join(",") || "none"}; missing=${missing.join(",") || "none"}`,
    );
  }
}

function credentialBinding(attestation) {
  const binding = {
    jwt_profile: attestation?.jwt_profile,
    portfolio_fingerprint: attestation?.portfolio_fingerprint,
    credential_fingerprint: attestation?.key_fingerprint,
    can_view: attestation?.can_view,
    can_trade: attestation?.can_trade,
    can_transfer: attestation?.can_transfer,
    can_receive: attestation?.can_receive,
  };
  assertExactFields(binding, CREDENTIAL_FIELDS, "credential binding");
  if (
    binding.jwt_profile !== JWT_PROFILE ||
    binding.can_view !== true ||
    binding.can_trade !== true ||
    binding.can_transfer !== false ||
    binding.can_receive !== false ||
    typeof binding.portfolio_fingerprint !== "string" ||
    !binding.portfolio_fingerprint ||
    typeof binding.credential_fingerprint !== "string" ||
    !binding.credential_fingerprint
  ) {
    throw new Error("Credential binding is missing or unsafe");
  }
  return binding;
}

export function createBoundExecution(plan, attestation, confirmPolicyDigest) {
  if (
    plan?.schema_version !== "delta.coinbase.execution_plan.v1" ||
    plan?.status !== "AWAITING_HUMAN_CONFIRMATION" ||
    digest(plan.policy) !== plan.policy_digest
  ) {
    throw new Error("Only a valid, confirmation-ready execution plan can be bound");
  }
  if (confirmPolicyDigest !== plan.policy_digest) {
    throw new Error("Human confirmation digest does not match the compiled policy");
  }
  const bindingId = randomUUID();
  const planDigest = digest(plan);
  const authorizationScope = {
    schema_version: "delta.coinbase.execution_scope.v1",
    binding_id: bindingId,
    plan_id: plan.plan_id,
    plan_digest: planDigest,
    policy_digest: plan.policy_digest,
    safety_profile: plan.safety_profile,
    credential_binding: credentialBinding(attestation),
  };
  const executionDigest = digest(authorizationScope);
  return {
    schema_version: "delta.coinbase.bound_execution.v1",
    binding_id: bindingId,
    created_at: new Date().toISOString(),
    status: "AWAITING_HUMAN_CONFIRMATION",
    plan,
    plan_digest: planDigest,
    policy_confirmation: {
      supplied_digest: confirmPolicyDigest,
      matched: true,
      confirmed_at: new Date().toISOString(),
    },
    authorization_scope: authorizationScope,
    execution_digest: executionDigest,
    confirmation: {
      required: true,
      instruction: `Review the policy and credential-scoped portfolio, then pass --confirm-execution ${executionDigest}`,
    },
  };
}

export function assertBoundExecution(
  boundExecution,
  attestation,
  confirmExecutionDigest,
) {
  assertExactFields(boundExecution, BOUND_FIELDS, "bound execution");
  if (
    boundExecution.schema_version !== "delta.coinbase.bound_execution.v1" ||
    boundExecution.status !== "AWAITING_HUMAN_CONFIRMATION"
  ) {
    throw new Error("Bound execution is not ready for confirmation");
  }
  if (digest(boundExecution.plan) !== boundExecution.plan_digest) {
    throw new Error("Bound execution plan digest mismatch");
  }
  if (
    boundExecution.policy_confirmation?.matched !== true ||
    boundExecution.policy_confirmation?.supplied_digest !==
      boundExecution.plan.policy_digest
  ) {
    throw new Error("Bound execution policy confirmation mismatch");
  }
  assertExactFields(
    boundExecution.authorization_scope,
    SCOPE_FIELDS,
    "authorization scope",
  );
  const scope = boundExecution.authorization_scope;
  if (
    scope.schema_version !== "delta.coinbase.execution_scope.v1" ||
    scope.binding_id !== boundExecution.binding_id ||
    scope.plan_id !== boundExecution.plan.plan_id ||
    scope.plan_digest !== boundExecution.plan_digest ||
    scope.policy_digest !== boundExecution.plan.policy_digest ||
    digest(scope.safety_profile) !==
      digest(boundExecution.plan.safety_profile) ||
    digest(scope) !== boundExecution.execution_digest
  ) {
    throw new Error("Bound execution authorization scope mismatch");
  }
  if (confirmExecutionDigest !== boundExecution.execution_digest) {
    throw new Error("Human confirmation digest does not match the bound execution");
  }
  const freshBinding = credentialBinding(attestation);
  if (digest(freshBinding) !== digest(scope.credential_binding)) {
    throw new Error("Fresh Coinbase credential or portfolio does not match the confirmed binding");
  }
  return boundExecution.plan;
}

export function assertBoundExecutionForRecovery(boundExecution, attestation) {
  return assertBoundExecution(
    boundExecution,
    attestation,
    boundExecution?.execution_digest,
  );
}

export async function writeBoundExecution(boundExecution) {
  await mkdir(BOUND_EXECUTION_DIR, { recursive: true, mode: 0o700 });
  const filePath = path.join(
    BOUND_EXECUTION_DIR,
    `${boundExecution.binding_id}.json`,
  );
  await writeFile(filePath, `${JSON.stringify(boundExecution, null, 2)}\n`, {
    mode: 0o600,
  });
  return filePath;
}

export async function readBoundExecution(filePath) {
  const raw = await readFile(path.resolve(filePath), "utf8");
  const boundExecution = JSON.parse(raw);
  if (boundExecution.schema_version !== "delta.coinbase.bound_execution.v1") {
    throw new Error("Unsupported bound execution schema");
  }
  return boundExecution;
}
