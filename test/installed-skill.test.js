import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_RUN = path.resolve(
  TEST_DIR,
  "../skills/delta-coinbase-guard/scripts/run",
);

test("the exact run wrapper named by the installed skill is executable", async () => {
  await access(SKILL_RUN, constants.X_OK);
  const metadata = await lstat(SKILL_RUN);
  assert.equal(metadata.isFile(), true);
});

test("the installed-skill wrapper reaches the matching harness showcase", async () => {
  const { stdout } = await execFileAsync(
    SKILL_RUN,
    ["coinbase-demo", "--no-artifacts"],
    { timeout: 15_000 },
  );
  assert.match(stdout, /^SIMULATION_ONLY$/m);
  assert.match(stdout, /^CONDITIONAL_MANDATE_SHOWCASE=COMPLETE$/m);
  assert.match(stdout, /^ATTEMPT_1=BLOCK->RETRY /m);
  assert.match(stdout, /^ATTEMPT_2=PASS->EXECUTE /m);
  assert.match(stdout, /^EXACT_PAYLOAD_MATCH=true$/m);
  assert.match(stdout, /^EVIDENCE_MATCH=true$/m);
  assert.match(stdout, /^DURABLE_ONE_TIME_GRANT_ISSUED=false$/m);
  assert.match(stdout, /^EXTERNAL_EXECUTOR_INVOKED=false$/m);
  assert.match(stdout, /^COINBASE_CREATE_INVOKED=false$/m);
  assert.match(stdout, /^ARTIFACTS_WRITTEN=false$/m);
});
