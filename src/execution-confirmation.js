import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ROOT } from "./paths.js";
import { digest } from "./evidence.js";
import { assertBoundExecution } from "./execution-binding.js";

export const EXECUTION_CONFIRMATION_DIR = path.join(
  HARNESS_ROOT,
  "runtime",
  "execution-confirmations",
);

const CONFIRMATION_FIELDS = Object.freeze([
  "schema_version",
  "confirmation_id",
  "binding_id",
  "plan_id",
  "execution_digest",
  "credential_binding_digest",
  "confirmed_at",
  "expires_at",
  "receipt_digest",
]);

function assertExactFields(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(`${name} has an invalid field set`);
  }
}

function withoutReceiptDigest(receipt) {
  const { receipt_digest: _receiptDigest, ...unsigned } = receipt;
  return unsigned;
}

function receiptPath(bindingId) {
  if (typeof bindingId !== "string" || !bindingId) {
    throw new Error("execution binding id is required");
  }
  const fingerprint = createHash("sha256").update(bindingId).digest("hex");
  return path.join(EXECUTION_CONFIRMATION_DIR, `${fingerprint}.json`);
}

export function createExecutionConfirmation({
  boundExecution,
  attestation,
  confirmedExecutionDigest,
  confirmedAt = new Date(),
}) {
  const plan = assertBoundExecution(
    boundExecution,
    attestation,
    confirmedExecutionDigest,
  );
  if (!(confirmedAt instanceof Date) || !Number.isFinite(confirmedAt.getTime())) {
    throw new Error("execution confirmation time is invalid");
  }
  const expiresAt = new Date(
    confirmedAt.getTime() + plan.policy.validity.ttl_seconds * 1_000,
  );
  const receipt = {
    schema_version: "delta.coinbase.execution_confirmation.v1",
    confirmation_id: randomUUID(),
    binding_id: boundExecution.binding_id,
    plan_id: plan.plan_id,
    execution_digest: boundExecution.execution_digest,
    credential_binding_digest: digest(
      boundExecution.authorization_scope.credential_binding,
    ),
    confirmed_at: confirmedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  return {
    ...receipt,
    receipt_digest: digest(receipt),
  };
}

export function assertExecutionConfirmation({
  receipt,
  boundExecution,
  attestation,
  current = new Date(),
}) {
  assertExactFields(
    receipt,
    CONFIRMATION_FIELDS,
    "execution confirmation receipt",
  );
  if (
    receipt.schema_version !== "delta.coinbase.execution_confirmation.v1" ||
    digest(withoutReceiptDigest(receipt)) !== receipt.receipt_digest
  ) {
    throw new Error("execution confirmation receipt digest is invalid");
  }
  const plan = assertBoundExecution(
    boundExecution,
    attestation,
    receipt.execution_digest,
  );
  if (
    receipt.binding_id !== boundExecution.binding_id ||
    receipt.plan_id !== plan.plan_id ||
    receipt.execution_digest !== boundExecution.execution_digest ||
    receipt.credential_binding_digest !==
      digest(boundExecution.authorization_scope.credential_binding)
  ) {
    throw new Error(
      "execution confirmation receipt does not match the bound execution",
    );
  }
  const confirmedAt = new Date(receipt.confirmed_at);
  const expiresAt = new Date(receipt.expires_at);
  if (
    !(current instanceof Date) ||
    !Number.isFinite(current.getTime()) ||
    !Number.isFinite(confirmedAt.getTime()) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() - confirmedAt.getTime() !==
      plan.policy.validity.ttl_seconds * 1_000
  ) {
    throw new Error("execution confirmation receipt timestamps are invalid");
  }
  if (confirmedAt.getTime() > current.getTime() + 2_000) {
    throw new Error("execution confirmation receipt is from the future");
  }
  if (current.getTime() >= expiresAt.getTime()) {
    throw new Error(
      "execution confirmation receipt expired; create and authorize a new bound execution",
    );
  }
  return { plan, confirmedAt, expiresAt };
}

export async function writeExecutionConfirmation(receipt) {
  assertExactFields(
    receipt,
    CONFIRMATION_FIELDS,
    "execution confirmation receipt",
  );
  await mkdir(EXECUTION_CONFIRMATION_DIR, {
    recursive: true,
    mode: 0o700,
  });
  const filePath = receiptPath(receipt.binding_id);
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "this bound execution already has a confirmation receipt; it cannot be re-timestamped",
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return filePath;
}

export async function readExecutionConfirmation(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("execution confirmation receipt path must be absolute");
  }
  const receipt = JSON.parse(await readFile(filePath, "utf8"));
  assertExactFields(
    receipt,
    CONFIRMATION_FIELDS,
    "execution confirmation receipt",
  );
  return receipt;
}
