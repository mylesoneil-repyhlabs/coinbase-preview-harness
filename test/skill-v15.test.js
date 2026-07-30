import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(
  TEST_DIR,
  "../skills/delta-coinbase-guard",
);

async function skillFile(relativePath) {
  return readFile(path.join(SKILL_DIR, relativePath), "utf8");
}

test("v1.5 skill makes the default experience chat-native and no-order", async () => {
  const skill = await skillFile("SKILL.md");

  assert.match(skill, /credential-free dry run and optional View-only facts/i);
  assert.match(skill, /Dry run is the default/i);
  assert.match(skill, /No order can be sent/i);
  assert.match(skill, /Keep the ordinary experience inside the conversation/i);
  assert.doesNotMatch(skill, /open a browser[^,\n]*,/i);
});

test("v1.5 skill keeps exact digest authorization internal", async () => {
  const skill = await skillFile("SKILL.md");

  assert.match(skill, /Authorize this mandate/);
  assert.match(skill, /saved exact policy digest internally/i);
  assert.match(skill, /initial request.*is not authorization/i);
  assert.match(skill, /do not show the policy digest/i);
  assert.match(skill, /does not authenticate who typed/i);
});

test("v1.5 skill uses one preflight command and avoids the legacy ceremony", async () => {
  const skill = await skillFile("SKILL.md");

  assert.match(
    skill,
    /preflight \\\n  --plan <saved-plan-path> \\\n  --confirm-policy <saved-policy-digest>/,
  );
  assert.match(skill, /Run exactly one ordinary command/i);
  assert.match(skill, /Never use the legacy configure\/bind\/confirm\/probe sequence/i);
  assert.match(skill, /--view-key-file <absolute-external-key-path>/);
});

test("v1.5 skill distinguishes simulation, View-only PASS, BLOCK, and REVIEW", async () => {
  const skill = await skillFile("SKILL.md");

  assert.match(skill, /local simulated Delta contract/i);
  assert.match(skill, /View-only `PASS`.*not a Delta authorization/is);
  assert.match(skill, /`BLOCK` means verified facts violated the mandate/i);
  assert.match(skill, /`REVIEW` means the guard could not obtain fresh, complete, matching evidence/i);
  assert.match(skill, /no Coinbase Create, no\s+order submitted/is);
});

test("v1.5 skill protects credentials, details, replay, and history", async () => {
  const [skill, security, workflow] = await Promise.all([
    skillFile("SKILL.md"),
    skillFile("references/security-boundary.md"),
    skillFile("references/workflow.md"),
  ]);

  assert.match(skill, /never the credential text/i);
  assert.match(skill, /Do not persist a key or permission attestation/i);
  assert.match(skill, /hashes.*behind an explicit details request/is);
  assert.match(skill, /history --clear.*explicit user confirmation/is);
  assert.match(skill, /nonce reuse with changed semantics must fail closed/i);

  assert.match(security, /can_trade=false/);
  assert.match(security, /Create, cancel, transfers, conversions/i);
  assert.match(security, /not independent authentication of Coinbase data/i);
  assert.match(workflow, /Preview.*not Delta authorization/is);
});

test("skill UI metadata presents the protected dry-run experience", async () => {
  const metadata = await skillFile("agents/openai.yaml");

  assert.match(metadata, /short_description: "Protected Coinbase spot dry runs"/);
  assert.match(metadata, /default_prompt:.*\$delta-coinbase-guard/);
  assert.match(metadata, /no order can be sent/);
});
