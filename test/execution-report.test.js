import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  renderExecutionHtml,
  writeExecutionReport,
} from "../src/execution-report.js";

function record(artifactClass = "SIMULATED") {
  return {
    artifact_class: artifactClass,
    status: "FILLED",
    generated_at: "2026-07-24T12:00:00.000Z",
    record_digest: "a".repeat(64),
    policy: {},
    proposal: { action: {} },
    execution: {
      adapter_invoked: false,
      order_submitted: false,
    },
  };
}

test("simulation HTML starts with an unambiguous SIMULATION_ONLY banner", () => {
  const html = renderExecutionHtml(record());
  const bodyIndex = html.indexOf("<body>");
  const bannerIndex = html.indexOf("SIMULATION_ONLY");
  const mainIndex = html.indexOf("<main>");

  assert.ok(bodyIndex >= 0);
  assert.ok(bannerIndex > bodyIndex);
  assert.ok(bannerIndex < mainIndex);
  assert.match(
    html,
    /SIMULATION_ONLY · NO REAL ORDER · COINBASE AND PRODUCTION DELTA NOT CONTACTED/,
  );
});

test("live HTML does not carry the simulation banner", () => {
  const html = renderExecutionHtml(record("LIVE"));
  assert.doesNotMatch(html, /class="simulation-banner"/);
  assert.doesNotMatch(html, /SIMULATION_ONLY/);
});

test("reports are private, ignored-runtime artifacts with unique names", async (t) => {
  const harnessRoot = await mkdtemp(
    path.join(os.tmpdir(), "delta-coinbase-report-"),
  );
  t.after(() => rm(harnessRoot, { force: true, recursive: true }));
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const options = {
    harnessRoot,
    now: () => new Date("2026-07-24T12:34:56.789Z"),
    uniqueId: () => ids.shift(),
  };

  const first = await writeExecutionReport(record(), "../../unsafe name", options);
  const second = await writeExecutionReport(record(), "../../unsafe name", options);
  const outputDir = path.join(harnessRoot, "runtime", "artifacts");

  assert.equal(path.dirname(first.jsonPath), outputDir);
  assert.equal(path.dirname(first.htmlPath), outputDir);
  assert.notEqual(first.jsonPath, second.jsonPath);
  assert.match(path.basename(first.jsonPath), /^unsafe-name-/);
  assert.equal((await stat(path.join(harnessRoot, "runtime"))).mode & 0o777, 0o700);
  assert.equal((await stat(outputDir)).mode & 0o777, 0o700);
  assert.equal((await stat(first.jsonPath)).mode & 0o777, 0o600);
  assert.equal((await stat(first.htmlPath)).mode & 0o777, 0o600);
  assert.match(await readFile(first.htmlPath, "utf8"), /SIMULATION_ONLY/);
});

test("an allocated report name is never overwritten", async (t) => {
  const harnessRoot = await mkdtemp(
    path.join(os.tmpdir(), "delta-coinbase-report-"),
  );
  t.after(() => rm(harnessRoot, { force: true, recursive: true }));
  const options = {
    harnessRoot,
    now: () => new Date("2026-07-24T12:34:56.789Z"),
    uniqueId: () => "33333333-3333-4333-8333-333333333333",
  };

  const first = await writeExecutionReport(record(), "execution", options);
  const originalJson = await readFile(first.jsonPath, "utf8");

  await assert.rejects(
    writeExecutionReport(
      { ...record(), record_digest: "b".repeat(64) },
      "execution",
      options,
    ),
    (error) => error?.code === "EEXIST",
  );
  assert.equal(await readFile(first.jsonPath, "utf8"), originalJson);
});

test("report writing refuses a symlinked runtime directory", async (t) => {
  const harnessRoot = await mkdtemp(
    path.join(os.tmpdir(), "delta-coinbase-report-"),
  );
  const outside = await mkdtemp(
    path.join(os.tmpdir(), "delta-coinbase-report-outside-"),
  );
  t.after(() => rm(harnessRoot, { force: true, recursive: true }));
  t.after(() => rm(outside, { force: true, recursive: true }));
  await symlink(outside, path.join(harnessRoot, "runtime"));

  await assert.rejects(
    writeExecutionReport(record(), "execution", { harnessRoot }),
    /Refusing unsafe report directory/,
  );
  await assert.rejects(
    access(path.join(outside, "artifacts")),
    (error) => error?.code === "ENOENT",
  );
});
