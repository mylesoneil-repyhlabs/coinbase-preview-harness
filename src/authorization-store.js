import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ROOT } from "./coinbase-cli.js";

export const AUTHORIZATION_DIR = path.join(
  HARNESS_ROOT,
  "runtime",
  "consumed-authorizations",
);
export const EXECUTION_PLAN_DIR = path.join(
  HARNESS_ROOT,
  "runtime",
  "consumed-execution-plans",
);

function fingerprintPath(directory, value) {
  const fingerprint = createHash("sha256").update(value).digest("hex");
  return path.join(directory, `${fingerprint}.json`);
}

async function consumeOnce(directory, value, record, replayMessage) {
  if (typeof value !== "string" || !value) throw new Error("one-time identifier is required");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = fingerprintPath(directory, value);
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(replayMessage);
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  return filePath;
}

async function markOnce(directory, value, patch) {
  const filePath = fingerprintPath(directory, value);
  const current = JSON.parse(await readFile(filePath, "utf8"));
  const next = { ...current, ...patch, updated_at: new Date().toISOString() };
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
  return next;
}

export async function consumeAuthorization(jti, record) {
  return consumeOnce(
    AUTHORIZATION_DIR,
    jti,
    record,
    "delta authorization has already been consumed",
  );
}

export async function markAuthorization(jti, patch) {
  return markOnce(AUTHORIZATION_DIR, jti, patch);
}

export async function consumeExecutionPlan(planId, record) {
  return consumeOnce(
    EXECUTION_PLAN_DIR,
    planId,
    record,
    "human-confirmed execution plan has already been consumed",
  );
}

export async function markExecutionPlan(planId, patch) {
  return markOnce(EXECUTION_PLAN_DIR, planId, patch);
}

export async function readExecutionPlanConsumption(planId) {
  if (typeof planId !== "string" || !planId) {
    throw new Error("execution plan id is required");
  }
  return JSON.parse(
    await readFile(fingerprintPath(EXECUTION_PLAN_DIR, planId), "utf8"),
  );
}
