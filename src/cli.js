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
import { createCoinbaseRestAdapter } from "./coinbase-rest.js";
import {
  loadDeltaDecisionPublicKey,
  requestDeltaDecision,
} from "./delta-client.js";
import { runExecutionPipeline } from "./execution-pipeline.js";
import {
  assertBoundExecution,
  assertBoundExecutionForRecovery,
  createBoundExecution,
  readBoundExecution,
  writeBoundExecution,
} from "./execution-binding.js";
import { readExecutionPlanConsumption } from "./authorization-store.js";
import { writeExecutionReport } from "./execution-report.js";
import { runPreviewPipeline } from "./pipeline.js";
import {
  ATTESTATION_PATH,
  loadPermissionAttestation,
  loadAndVerifyTradeCredentials,
  verifyKeyFileAndConfigure,
  verifyTradeKeyFileAndConfigure,
} from "./permissions.js";
import {
  createExecutionPlan,
  loadSafetyProfile,
  readExecutionPlan,
  writeExecutionPlan,
} from "./plan.js";
import { writeReport } from "./report.js";
import { recoverExecution } from "./recovery.js";
import { fetchStaticSandboxPreview } from "./sandbox.js";
import { simulateExecution } from "./simulator.js";

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

async function configureExecution(args) {
  const keyFile = optionValue(args, "--key-file");
  if (!keyFile) {
    throw new Error(
      "Usage: node src/cli.js configure-execution --key-file /absolute/path/to/cdp_key.json",
    );
  }
  const result = await verifyTradeKeyFileAndConfigure(keyFile);
  process.stdout.write(`${JSON.stringify(result.attestation, null, 2)}\n`);
  process.stdout.write(
    "View+Trade credential verified; Transfer/Receive absent. The secret was not copied into this repository or stored by the harness.\n",
  );
}

async function intentText(args) {
  const inline = optionValue(args, "--intent");
  const filePath = optionValue(args, "--intent-file");
  if (inline && filePath) throw new Error("Use either --intent or --intent-file, not both");
  if (inline) return inline;
  if (filePath) return (await readFile(path.resolve(filePath), "utf8")).trim();
  throw new Error("Provide --intent \"...\" or --intent-file /absolute/path/to/intent.txt");
}

async function createPlanCommand(args) {
  const intent = await intentText(args);
  const compiler = optionValue(args, "--compiler") ?? "deterministic";
  const plan = await createExecutionPlan(intent, { compiler });
  const filePath = await writeExecutionPlan(plan);
  process.stdout.write(`${plan.status}\n`);
  process.stdout.write(`Plan: ${filePath}\n`);
  if (plan.policy_digest) {
    process.stdout.write(`\nCompiled policy:\n${JSON.stringify(plan.policy, null, 2)}\n\n`);
    process.stdout.write(`Policy digest: ${plan.policy_digest}\n`);
    process.stdout.write(
      `Next: ./run simulate --plan ${filePath} --confirm-policy ${plan.policy_digest}\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify(plan.compilation, null, 2)}\n`);
    process.exitCode = 2;
  }
}

async function bindExecution(args) {
  const planPath = optionValue(args, "--plan");
  const keyFile = optionValue(args, "--key-file");
  const policyConfirmation = optionValue(args, "--confirm-policy");
  if (!planPath || !keyFile || !policyConfirmation) {
    throw new Error(
      "Usage: bind-execution --plan /path/to/plan.json --confirm-policy <digest> --key-file /outside/repo/cdp_key.json",
    );
  }
  const plan = await readExecutionPlan(planPath);
  if (policyConfirmation !== plan.policy_digest) {
    throw new Error("Human confirmation digest does not match the compiled policy");
  }
  const verifiedTrade = await loadAndVerifyTradeCredentials(keyFile);
  const boundExecution = createBoundExecution(
    plan,
    verifiedTrade.attestation,
    policyConfirmation,
  );
  const filePath = await writeBoundExecution(boundExecution);
  process.stdout.write("AWAITING_HUMAN_CONFIRMATION\n");
  process.stdout.write(`Bound execution: ${filePath}\n`);
  process.stdout.write(
    `Portfolio fingerprint: ${boundExecution.authorization_scope.credential_binding.portfolio_fingerprint}\n`,
  );
  process.stdout.write(`Execution digest: ${boundExecution.execution_digest}\n`);
  process.stdout.write(
    `Next: ./run probe-execution --bound-execution ${filePath} --confirm-execution ${boundExecution.execution_digest} --key-file ${keyFile}\n`,
  );
}

async function simulate(args) {
  const planPath = optionValue(args, "--plan");
  const confirmation = optionValue(args, "--confirm-policy");
  if (!planPath || !confirmation) {
    throw new Error("Usage: simulate --plan /path/to/plan.json --confirm-policy <digest>");
  }
  const plan = await readExecutionPlan(planPath);
  const record = await simulateExecution(plan, confirmation);
  const paths = await writeExecutionReport(record, "execution-readiness");
  process.stdout.write(`${record.status}\n`);
  printPaths(paths);
  if (!["FILLED", "PARTIAL_FILL", "NO_FILL"].includes(record.status)) {
    process.exitCode = 1;
  }
}

async function probeExecution(args) {
  const executionConfirmedAt = new Date();
  const boundPath = optionValue(args, "--bound-execution");
  const confirmation = optionValue(args, "--confirm-execution");
  const keyFile = optionValue(args, "--key-file");
  if (!boundPath || !confirmation || !keyFile) {
    throw new Error(
      "Usage: probe-execution --bound-execution /path/to/bound.json --confirm-execution <digest> --key-file /outside/repo/cdp_key.json",
    );
  }
  const boundExecution = await readBoundExecution(boundPath);
  const [safetyProfile, verifiedTrade] = await Promise.all([
    loadSafetyProfile(),
    loadAndVerifyTradeCredentials(keyFile),
  ]);
  const plan = assertBoundExecution(
    boundExecution,
    verifiedTrade.attestation,
    confirmation,
  );
  const coinbase = createCoinbaseRestAdapter(verifiedTrade.credentials);
  const record = await runExecutionPipeline({
    mode: "PROBE",
    plan,
    confirmPolicyDigest: boundExecution.policy_confirmation.supplied_digest,
    boundExecution,
    confirmExecutionDigest: confirmation,
    executionConfirmedAt,
    safetyProfile,
    attestation: verifiedTrade.attestation,
    getProduct: coinbase.getProduct,
    getBestBidAsk: coinbase.getBestBidAsk,
    previewAdapter: coinbase.previewOrder,
  });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const paths = await writeExecutionReport(record, `execution-probe-${timestamp}`);
  process.stdout.write(`${record.status}\n`);
  printPaths(paths);
  if (record.status !== "PREVIEW_PROBE_PASS") {
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Next only after reviewing the probe and configuring delta: ./run execute --bound-execution ${boundPath} --confirm-execution ${confirmation} --key-file ${keyFile} --live-execution --accept-real-money-risk\n`,
    );
  }
}

async function execute(args) {
  const executionConfirmedAt = new Date();
  if (!args.includes("--live-execution") || !args.includes("--accept-real-money-risk")) {
    throw new Error(
      "Live execution is gated. Both --live-execution and --accept-real-money-risk are required.",
    );
  }
  const boundPath = optionValue(args, "--bound-execution");
  const confirmation = optionValue(args, "--confirm-execution");
  const keyFile = optionValue(args, "--key-file");
  if (!boundPath || !confirmation || !keyFile) {
    throw new Error(
      "Usage: execute --bound-execution /path/to/bound.json --confirm-execution <digest> --key-file /outside/repo/cdp_key.json --live-execution --accept-real-money-risk",
    );
  }
  const boundExecution = await readBoundExecution(boundPath);
  const [safetyProfile, verifiedTrade, deltaPublicKey] = await Promise.all([
    loadSafetyProfile(),
    loadAndVerifyTradeCredentials(keyFile),
    loadDeltaDecisionPublicKey(),
  ]);
  const plan = assertBoundExecution(
    boundExecution,
    verifiedTrade.attestation,
    confirmation,
  );
  const coinbase = createCoinbaseRestAdapter(verifiedTrade.credentials);
  const record = await runExecutionPipeline({
    mode: "LIVE",
    plan,
    confirmPolicyDigest: boundExecution.policy_confirmation.supplied_digest,
    boundExecution,
    confirmExecutionDigest: confirmation,
    executionConfirmedAt,
    safetyProfile,
    attestation: verifiedTrade.attestation,
    getProduct: coinbase.getProduct,
    getBestBidAsk: coinbase.getBestBidAsk,
    previewAdapter: coinbase.previewOrder,
    deltaAdapter: requestDeltaDecision,
    createAdapter: coinbase.createOrder,
    getOrderAdapter: coinbase.getOrder,
    listFillsAdapter: coinbase.listFills,
    deltaPublicKey,
  });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const paths = await writeExecutionReport(record, `live-execution-${timestamp}`);
  process.stdout.write(`${record.status}\n`);
  printPaths(paths);
  if (!["FILLED", "PARTIAL_FILL", "NO_FILL"].includes(record.status)) {
    process.exitCode = 1;
  }
}

async function reconcileExecution(args) {
  const boundPath = optionValue(args, "--bound-execution");
  const keyFile = optionValue(args, "--key-file");
  if (!boundPath || !keyFile) {
    throw new Error(
      "Usage: reconcile-execution --bound-execution /path/to/bound.json --key-file /outside/repo/trade-key.json",
    );
  }
  const [boundExecution, verifiedTrade] = await Promise.all([
    readBoundExecution(boundPath),
    loadAndVerifyTradeCredentials(keyFile),
  ]);
  const plan = assertBoundExecutionForRecovery(
    boundExecution,
    verifiedTrade.attestation,
  );
  const stored = await readExecutionPlanConsumption(plan.plan_id);
  const coinbase = createCoinbaseRestAdapter(verifiedTrade.credentials);
  const record = await recoverExecution({
    planId: plan.plan_id,
    stored,
    attestation: verifiedTrade.attestation,
    listOrdersAdapter: coinbase.listOrders,
    getOrderAdapter: coinbase.getOrder,
    listFillsAdapter: coinbase.listFills,
  });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const paths = await writeExecutionReport(
    record,
    `execution-reconciliation-${timestamp}`,
  );
  process.stdout.write(`${record.status}\n`);
  printPaths(paths);
  if (!["FILLED", "PARTIAL_FILL", "NO_FILL"].includes(record.status)) {
    process.exitCode = 1;
  }
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
  plan --intent "..." [--compiler deterministic|openai]
  plan --intent-file /absolute/path/to/intent.txt [--compiler deterministic|openai]
  simulate --plan /path/to/plan.json --confirm-policy <digest>
  configure-execution --key-file /outside/repo/trade-key.json
  bind-execution --plan /path/to/plan.json --confirm-policy <digest> --key-file /outside/repo/trade-key.json
  probe-execution --bound-execution /path/to/bound.json --confirm-execution <digest> --key-file /outside/repo/trade-key.json
  execute --bound-execution /path/to/bound.json --confirm-execution <digest> --key-file /outside/repo/trade-key.json --live-execution --accept-real-money-risk
  reconcile-execution --bound-execution /path/to/bound.json --key-file /outside/repo/trade-key.json

The execution command is unreachable without both human digest confirmations, a fresh
View+Trade-only credential attestation, a signed delta ALLOW bound to the exact
payload, and two explicit real-money flags. Reconciliation is read-only and can
only inspect the already-consumed plan with the same credential-bound portfolio.
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
  } else if (command === "plan") {
    await createPlanCommand(args);
  } else if (command === "simulate") {
    await simulate(args);
  } else if (command === "configure-execution") {
    await configureExecution(args);
  } else if (command === "bind-execution") {
    await bindExecution(args);
  } else if (command === "probe-execution") {
    await probeExecution(args);
  } else if (command === "execute") {
    await execute(args);
  } else if (command === "reconcile-execution") {
    await reconcileExecution(args);
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
}
