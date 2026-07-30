import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(TEST_DIR, "../src/cli.js");
const EXAMPLE_INTENT_PATH = path.resolve(
  TEST_DIR,
  "../examples/first-live-intent.txt",
);
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

test("plan hides operational paths by default and reveals one for an installed skill handoff on request", async () => {
  const compact = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      "plan",
      "--intent-file",
      EXAMPLE_INTENT_PATH,
      "--compiler",
      "deterministic",
    ],
    { cwd: tmpdir() },
  );
  assert.doesNotMatch(compact.stdout, /^Plan: /m);
  assert.doesNotMatch(compact.stdout, /^Policy digest: /m);

  const result = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      "plan",
      "--intent-file",
      EXAMPLE_INTENT_PATH,
      "--compiler",
      "deterministic",
      "--details",
    ],
    { cwd: tmpdir() },
  );
  const match = result.stdout.match(/^Plan: (.+)$/m);
  assert.ok(match, "CLI did not print the plan path");
  assert.equal(path.isAbsolute(match[1]), true);
  await access(match[1]);
});
