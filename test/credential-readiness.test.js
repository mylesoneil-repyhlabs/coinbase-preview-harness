import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(TEST_DIR, "../src/cli.js");

test("credential readiness is safe to run before a key is supplied", async () => {
  const result = await execFileAsync(process.execPath, [
    CLI_PATH,
    "credential-readiness",
  ]);

  assert.match(
    result.stdout,
    /CREDENTIALS_NOT_CONFIGURED|CREDENTIAL_ATTESTATION_PRESENT/,
  );
  assert.match(result.stdout, /PLANNER_SCOPE=View only/);
  assert.match(result.stdout, /FUTURE_EXECUTOR_SCOPE=View\+Trade/);
  assert.match(result.stdout, /PERSISTED_SECRET_MATERIAL=false/);
  assert.match(result.stdout, /LIVE_CREATE=LOCKED/);
  assert.match(result.stdout, /5\.00 USDC principal/);
  assert.doesNotMatch(result.stdout, /PRIVATE KEY|apiKeys\//);
  assert.equal(result.stderr, "");
});

test("configure-credentials requires an external key path without prompting", async () => {
  try {
    await execFileAsync(process.execPath, [CLI_PATH, "configure-credentials"]);
    assert.fail("configure-credentials unexpectedly succeeded");
  } catch (error) {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /--key-file/);
    assert.doesNotMatch(error.stderr, /PRIVATE KEY|apiKeys\//);
  }
});
