import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(TEST_DIR, "../src/cli.js");
const MISSING_KEY_PATH = "/definitely/missing/delta-coinbase-guard-key.json";

async function runLockedCommand(command, args) {
  try {
    await execFileAsync(process.execPath, [CLI_PATH, command, ...args], {
      env: {
        ...process.env,
        DELTA_MANDATE_ADAPTER_MODULE: "/tmp/untrusted-runtime-adapter.js",
      },
    });
    assert.fail(`${command} unexpectedly succeeded`);
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("execute fails at the compile-time Delta seam before reading credentials", async () => {
  const result = await runLockedCommand("execute", [
    "--bound-execution",
    "/definitely/missing/bound.json",
    "--confirmation-receipt",
    "/definitely/missing/receipt.json",
    "--key-file",
    MISSING_KEY_PATH,
    "--live-execution",
    "--accept-real-money-risk",
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /ENGINEERING_INTEGRATION_REQUIRED/);
  assert.doesNotMatch(result.stderr, /missing|credential|key\.json/i);
  assert.equal(result.stdout, "");
});

test("reconciliation is also locked before reading credentials", async () => {
  const result = await runLockedCommand("reconcile-execution", [
    "--bound-execution",
    "/definitely/missing/bound.json",
    "--key-file",
    MISSING_KEY_PATH,
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /ENGINEERING_INTEGRATION_REQUIRED/);
  assert.doesNotMatch(result.stderr, /missing|credential|key\.json/i);
  assert.equal(result.stdout, "");
});
