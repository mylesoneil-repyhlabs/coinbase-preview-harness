#!/usr/bin/env node
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CLI_ENTRY,
  CLI_VERSION,
  HARNESS_ROOT,
  dryRunPreview,
  getCliVersion,
  getPreviewTemplate,
  livePreview,
} from "./coinbase-cli.js";
import { runPreviewPipeline } from "./pipeline.js";
import { ATTESTATION_PATH, loadPermissionAttestation, verifyKeyFileAndConfigure } from "./permissions.js";
import { writeReport } from "./report.js";
import { fetchStaticSandboxPreview } from "./sandbox.js";

const DEFAULT_MANDATE_PATH = path.join(HARNESS_ROOT, "config", "mandate.example.json");
const FIXTURE_DIR = path.join(HARNESS_ROOT, "fixtures");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadMandate() {
  return readJson(DEFAULT_MANDATE_PATH);
}

async function loadFixture(name = "allowed") {
  const safeName = path.basename(name, ".json");
  return readJson(path.join(FIXTURE_DIR, `${safeName}.json`));
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function printPaths(paths) {
  process.stdout.write(`JSON: ${paths.jsonPath}\nHTML: ${paths.htmlPath}\n`);
}

async function doctor() {
  const checks = [];
  checks.push({
    name: "Node.js",
    status: Number(process.versions.node.split(".")[0]) >= 22 ? "PASS" : "FAIL",
    detail: process.version,
  });

  try {
    await access(CLI_ENTRY);
    const version = await getCliVersion();
    checks.push({
      name: "Pinned Coinbase CLI",
      status: version === `coinbase ${CLI_VERSION}` ? "PASS" : "FAIL",
      detail: version,
    });
  } catch (error) {
    checks.push({ name: "Pinned Coinbase CLI", status: "FAIL", detail: error.message });
  }

  try {
    const template = await getPreviewTemplate();
    checks.push({
      name: "Preview command surface",
      status: template.product_id ? "PASS" : "FAIL",
      detail: "Official template read; harness does not execute the template.",
    });
  } catch (error) {
    checks.push({ name: "Preview command surface", status: "FAIL", detail: error.message });
  }

  let credentialDetail = "Not checked. Doctor never reads the keychain.";
  try {
    await access(ATTESTATION_PATH);
    credentialDetail = "A local permission attestation exists; credentials were still not read.";
  } catch {}
  checks.push({ name: "Credentials", status: "NOT_CHECKED", detail: credentialDetail });

  console.table(checks);
  if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
}

async function dryRun(args) {
  const fixture = await loadFixture(optionValue(args, "--fixture") ?? "allowed");
  const mandate = await loadMandate();
  const record = await runPreviewPipeline({
    artifactClass: "FIXTURE",
    mandate,
    order: fixture.order,
    previewAdapter: dryRunPreview,
    adapterMode: "dry-run",
  });
  const paths = await writeReport(record, `dry-run-${fixture.name}`);
  process.stdout.write(`${record.final_verdict}\n`);
  printPaths(paths);
}

async function runFixtures() {
  const mandate = await loadMandate();
  const fixtureFiles = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith(".json")).sort();
  const results = [];
  let allowedRecord;

  for (const file of fixtureFiles) {
    const fixture = await readJson(path.join(FIXTURE_DIR, file));
    let adapterCalls = 0;
    const record = await runPreviewPipeline({
      artifactClass: "FIXTURE",
      mandate,
      order: fixture.order,
      previewAdapter: async (order) => {
        adapterCalls += 1;
        return dryRunPreview(order);
      },
      adapterMode: "dry-run",
    });
    const actualPrecheck = record.precheck.verdict;
    results.push({
      fixture: fixture.name,
      expected: fixture.expected_precheck,
      actual: actualPrecheck,
      adapter_calls: adapterCalls,
      status:
        fixture.expected_precheck === actualPrecheck &&
        adapterCalls === (actualPrecheck === "ALLOW" ? 1 : 0) &&
        (actualPrecheck === "BLOCK" ||
          record.final_verdict === "CREDENTIALS_REQUIRED_FOR_LIVE_PREVIEW")
          ? "PASS"
          : "FAIL",
    });
    if (fixture.name === "allowed") allowedRecord = record;
  }

  console.table(results);
  if (results.some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
    return;
  }
  const paths = await writeReport(allowedRecord, "credential-readiness");
  printPaths(paths);
}

async function sandbox(args) {
  const fixture = await loadFixture(optionValue(args, "--fixture") ?? "allowed");
  const scenario = optionValue(args, "--scenario");
  const result = await fetchStaticSandboxPreview(fixture.order, { scenario });
  const outputDir = path.join(HARNESS_ROOT, "artifacts");
  const suffix = scenario ? `-${scenario.toLowerCase().replaceAll("_", "-")}` : "";
  const outputPath = path.join(outputDir, `coinbase-static-sandbox${suffix}.json`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Saved: ${outputPath}\n`);
}

async function configure(args) {
  const keyFile = optionValue(args, "--key-file");
  if (!keyFile) throw new Error("Usage: node src/cli.js configure --key-file /absolute/path/to/cdp_key.json");
  const result = await verifyKeyFileAndConfigure(keyFile);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write("View-only credential verified and stored by the official Coinbase CLI in the OS keychain.\n");
}

async function preview(args) {
  if (!args.includes("--live-preview")) {
    throw new Error("Live preview is gated. Re-run with --live-preview after view-only credential configuration.");
  }
  await loadPermissionAttestation();
  const fixture = await loadFixture(optionValue(args, "--fixture") ?? "allowed");
  const mandate = await loadMandate();
  const record = await runPreviewPipeline({
    artifactClass: "LIVE",
    mandate,
    order: fixture.order,
    previewAdapter: livePreview,
    adapterMode: "live",
  });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const paths = await writeReport(record, `live-preview-${timestamp}`);
  process.stdout.write(`${record.final_verdict}\n`);
  printPaths(paths);
  if (!["ALLOW", "BLOCK"].includes(record.final_verdict)) process.exitCode = 1;
}

function usage() {
  return `Coinbase Preview Harness

Commands:
  doctor
  fixtures
  dry-run [--fixture allowed]
  sandbox [--scenario PreviewOrder_insufficient_fund]
  configure --key-file /absolute/path/to/key.json
  preview --live-preview [--fixture allowed]

There is deliberately no order-execution command.
`;
}

const [command, ...args] = process.argv.slice(2);

try {
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(usage());
  } else if (command === "doctor") {
    await doctor();
  } else if (command === "fixtures") {
    await runFixtures();
  } else if (command === "dry-run") {
    await dryRun(args);
  } else if (command === "sandbox") {
    await sandbox(args);
  } else if (command === "configure") {
    await configure(args);
  } else if (command === "preview") {
    await preview(args);
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
}
