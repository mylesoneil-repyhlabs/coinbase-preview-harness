import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ADVISOR_CAPABILITIES_PATH,
  advisorStatusCapabilities,
  loadAdvisorCapabilities,
} from "../src/advisor/capabilities.js";

const EXECUTION_FEATURES = [
  "post_pass_final_confirmation_readiness",
  "durable_executor",
  "live_execution",
  "autonomous_execution",
  "coinbase_create",
];

async function baseProfile() {
  return JSON.parse(
    await readFile(ADVISOR_CAPABILITIES_PATH, "utf8"),
  );
}

async function temporaryProfile(t, profile) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delta-advisor-capabilities-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "capabilities.json");
  await writeFile(file, JSON.stringify(profile));
  return file;
}

test("the shipped capability contract enables only the locked readiness preview", async () => {
  const profile = loadAdvisorCapabilities();
  const status = advisorStatusCapabilities(profile);
  assert.equal(profile.features.live_readiness_preview, true);
  assert.equal(status.live_readiness_preview, true);
  for (const feature of EXECUTION_FEATURES) {
    assert.equal(profile.features[feature], false, feature);
  }
  assert.equal(profile.release_boundaries.coinbase_create_enabled, false);
  assert.equal(profile.release_boundaries.production_delta_integrated, false);
  assert.equal(profile.release_boundaries.unattended_execution, false);
});

test("missing or nonboolean live-readiness capability fails closed", async (t) => {
  for (const invalid of [undefined, "true", 1, null]) {
    const profile = await baseProfile();
    if (invalid === undefined) {
      delete profile.features.live_readiness_preview;
    } else {
      profile.features.live_readiness_preview = invalid;
    }
    const file = await temporaryProfile(t, profile);
    assert.throws(
      () => loadAdvisorCapabilities(file),
      /live_readiness_preview must be boolean/i,
    );
  }
});

test("an explicit false live-readiness flag safely disables the projection", async (t) => {
  const profile = await baseProfile();
  profile.features.live_readiness_preview = false;
  const file = await temporaryProfile(t, profile);
  const loaded = loadAdvisorCapabilities(file);
  assert.equal(loaded.features.live_readiness_preview, false);
  assert.equal(
    advisorStatusCapabilities(loaded).live_readiness_preview,
    false,
  );
});

test("every execution-related feature independently fails startup and status projection", async (t) => {
  for (const feature of EXECUTION_FEATURES) {
    const profile = await baseProfile();
    profile.features[feature] = true;
    const file = await temporaryProfile(t, profile);
    assert.throws(
      () => loadAdvisorCapabilities(file),
      new RegExp(`${feature} must remain disabled`, "i"),
    );
    assert.throws(
      () => advisorStatusCapabilities(profile),
      new RegExp(`${feature} must remain disabled`, "i"),
    );
  }
});

test("execution release boundaries independently fail closed", async (t) => {
  for (const boundary of [
    "coinbase_create_enabled",
    "production_delta_integrated",
    "unattended_execution",
  ]) {
    const profile = await baseProfile();
    profile.release_boundaries[boundary] = true;
    const file = await temporaryProfile(t, profile);
    assert.throws(
      () => loadAdvisorCapabilities(file),
      /release boundary cannot enable execution/i,
    );
  }
});
