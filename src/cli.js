#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  createCoinbaseExecutionAdapter,
  createCoinbaseRestAdapter,
} from "./coinbase-rest.js";
import { runExecutionPipeline } from "./execution-pipeline.js";
import {
  assertBoundExecutionForRecovery,
  createBoundExecution,
  readBoundExecution,
  writeBoundExecution,
} from "./execution-binding.js";
import {
  assertExecutionConfirmation,
  createExecutionConfirmation,
  readExecutionConfirmation,
  writeExecutionConfirmation,
} from "./execution-confirmation.js";
import { writeExecutionReport } from "./execution-report.js";
import {
  assertProductionExecutionDependencies,
  loadProductionExecutionDependencies,
  productionExecutionStatus,
} from "./integration/production-composition.js";
import {
  loadAndVerifyTradeCredentials,
  verifyTradeKeyFileAndConfigure,
} from "./permissions.js";
import { HARNESS_ROOT } from "./paths.js";
import {
  createExecutionPlan,
  loadSafetyProfile,
  readExecutionPlan,
  writeExecutionPlan,
} from "./plan.js";
import { recoverExecution } from "./recovery.js";
import { sanitize } from "./sanitize.js";
import { simulateExecution } from "./simulator.js";

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function printPaths(paths) {
  process.stdout.write(
    `JSON: ${path.resolve(paths.jsonPath)}\n` +
      `HTML: ${path.resolve(paths.htmlPath)}\n`,
  );
}

async function doctor() {
  const checks = [
    {
      name: "Node.js",
      status: Number(process.versions.node.split(".")[0]) >= 22 ? "PASS" : "FAIL",
      detail: process.version,
    },
  ];
  const requiredFiles = [
    "config/coinbase-spot-policy.v1.schema.json",
    "config/execution-safety-profile.json",
    "skills/delta-coinbase-guard/SKILL.md",
  ];
  try {
    await Promise.all(
      requiredFiles.map((file) => access(path.join(HARNESS_ROOT, file))),
    );
    checks.push({
      name: "V1 contracts and skill",
      status: "PASS",
      detail: "Policy schema, safety profile, and installable skill are present.",
    });
  } catch {
    checks.push({
      name: "V1 contracts and skill",
      status: "FAIL",
      detail: "One or more required V1 files are missing.",
    });
  }
  checks.push({
    name: "Coinbase credentials",
    status: "NOT_CHECKED",
    detail: "Doctor never reads a key or contacts Coinbase.",
  });
  const production = productionExecutionStatus();
  checks.push({
    name: "Real Coinbase Create",
    status: production.enabled ? "PASS" : "LOCKED",
    detail: production.detail,
  });

  console.table(checks);
  if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
}

async function intentText(args) {
  const inline = optionValue(args, "--intent");
  const filePath = optionValue(args, "--intent-file");
  if (inline && filePath) {
    throw new Error("Use either --intent or --intent-file, not both");
  }
  if (inline) return inline;
  if (filePath) return (await readFile(path.resolve(filePath), "utf8")).trim();
  throw new Error(
    'Provide --intent "..." or --intent-file /absolute/path/to/intent.txt',
  );
}

async function createPlanCommand(args) {
  const intent = await intentText(args);
  const compiler = optionValue(args, "--compiler") ?? "deterministic";
  const plan = await createExecutionPlan(intent, { compiler });
  const filePath = await writeExecutionPlan(plan);
  process.stdout.write(`${plan.status}\n`);
  process.stdout.write(`Plan: ${path.resolve(filePath)}\n`);
  if (plan.policy_digest) {
    process.stdout.write(
      `\nCompiled policy:\n${JSON.stringify(plan.policy, null, 2)}\n\n`,
    );
    process.stdout.write(`Policy digest: ${plan.policy_digest}\n`);
    process.stdout.write(
      "PAUSE: a trusted host must wait for a new user-authored message authorizing the displayed policy digest.\n",
    );
  } else {
    process.stdout.write(`${JSON.stringify(plan.compilation, null, 2)}\n`);
    process.exitCode = 2;
  }
}

async function configureExecution(args) {
  const keyFile = optionValue(args, "--key-file");
  if (!keyFile) {
    throw new Error(
      "Usage: configure-execution --key-file /absolute/path/to/cdp_key.json",
    );
  }
  const result = await verifyTradeKeyFileAndConfigure(keyFile);
  process.stdout.write(`${JSON.stringify(result.attestation, null, 2)}\n`);
  process.stdout.write(
    "View+Trade credential verified; Transfer/Receive are absent. The key remains outside this repository and is not copied by the guard.\n",
  );
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
    throw new Error(
      "Human confirmation digest does not match the compiled policy",
    );
  }
  const verifiedTrade = await loadAndVerifyTradeCredentials(keyFile);
  const boundExecution = createBoundExecution(
    plan,
    verifiedTrade.attestation,
    policyConfirmation,
  );
  const filePath = await writeBoundExecution(boundExecution);
  process.stdout.write("AWAITING_HUMAN_CONFIRMATION\n");
  process.stdout.write(`Bound execution: ${path.resolve(filePath)}\n`);
  process.stdout.write(
    `Portfolio fingerprint: ${boundExecution.authorization_scope.credential_binding.portfolio_fingerprint}\n`,
  );
  process.stdout.write(
    `Execution digest: ${boundExecution.execution_digest}\n`,
  );
  process.stdout.write(
    "PAUSE: a trusted host must wait for a new user-authored message authorizing the displayed execution digest, then record one immutable confirmation receipt.\n",
  );
}

async function confirmExecution(args) {
  const boundPath = optionValue(args, "--bound-execution");
  const confirmation = optionValue(args, "--confirm-execution");
  const keyFile = optionValue(args, "--key-file");
  if (!boundPath || !confirmation || !keyFile) {
    throw new Error(
      "Usage: confirm-execution --bound-execution /path/to/bound.json --confirm-execution <user-authorized-digest> --key-file /outside/repo/cdp_key.json",
    );
  }
  const boundExecution = await readBoundExecution(boundPath);
  const verifiedTrade = await loadAndVerifyTradeCredentials(keyFile);
  const receipt = createExecutionConfirmation({
    boundExecution,
    attestation: verifiedTrade.attestation,
    confirmedExecutionDigest: confirmation,
    confirmedAt: new Date(),
  });
  const receiptPath = await writeExecutionConfirmation(receipt);
  process.stdout.write("EXECUTION_CONFIRMATION_RECORDED\n");
  process.stdout.write(
    `Confirmation receipt: ${path.resolve(receiptPath)}\n`,
  );
  process.stdout.write(`Expires at: ${receipt.expires_at}\n`);
  process.stdout.write(
    "This receipt records the supplied digest but does not authenticate who typed it; the trusted host owns that check. Its timestamp cannot be refreshed.\n",
  );
}

async function simulate(args) {
  const planPath = optionValue(args, "--plan");
  const confirmation = optionValue(args, "--confirm-policy");
  if (!planPath || !confirmation) {
    throw new Error(
      "Usage: simulate --plan /path/to/plan.json --confirm-policy <digest>",
    );
  }
  const plan = await readExecutionPlan(planPath);
  const record = await simulateExecution(plan, confirmation);
  const paths = await writeExecutionReport(record, "execution-readiness");
  process.stdout.write("SIMULATION_ONLY\n");
  process.stdout.write(`SIMULATED_RESULT=${record.status}\n`);
  process.stdout.write("COINBASE_CREATE_INVOKED=false\n");
  printPaths(paths);
  if (!["FILLED", "PARTIAL_FILL", "NO_FILL"].includes(record.status)) {
    process.exitCode = 1;
  }
}

async function probeExecution(args) {
  const boundPath = optionValue(args, "--bound-execution");
  const receiptPath = optionValue(args, "--confirmation-receipt");
  const keyFile = optionValue(args, "--key-file");
  if (!boundPath || !receiptPath || !keyFile) {
    throw new Error(
      "Usage: probe-execution --bound-execution /path/to/bound.json --confirmation-receipt /path/to/receipt.json --key-file /outside/repo/cdp_key.json",
    );
  }
  const [boundExecution, executionConfirmation, safetyProfile] =
    await Promise.all([
      readBoundExecution(boundPath),
      readExecutionConfirmation(receiptPath),
      loadSafetyProfile(),
    ]);
  const verifiedTrade = await loadAndVerifyTradeCredentials(keyFile);
  const { plan } = assertExecutionConfirmation({
    receipt: executionConfirmation,
    boundExecution,
    attestation: verifiedTrade.attestation,
    current: new Date(),
  });
  const coinbase = createCoinbaseRestAdapter(verifiedTrade.credentials);
  const record = await runExecutionPipeline({
    mode: "PROBE",
    plan,
    confirmPolicyDigest: boundExecution.policy_confirmation.supplied_digest,
    boundExecution,
    executionConfirmation,
    safetyProfile,
    attestation: verifiedTrade.attestation,
    getProduct: coinbase.getProduct,
    getBestBidAsk: coinbase.getBestBidAsk,
    previewAdapter: coinbase.previewOrder,
  });
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  const paths = await writeExecutionReport(
    record,
    `execution-probe-${timestamp}`,
  );
  process.stdout.write(`${record.status}\n`);
  printPaths(paths);
  if (record.status !== "PREVIEW_PROBE_PASS") {
    process.exitCode = 1;
  } else {
    process.stdout.write(
      "Coinbase Preview passed and Create was not called. Public V1 cannot submit an order; engineering integration is required.\n",
    );
  }
}

async function execute(args) {
  const production = assertProductionExecutionDependencies(
    await loadProductionExecutionDependencies(),
  );
  if (
    !args.includes("--live-execution") ||
    !args.includes("--accept-real-money-risk")
  ) {
    throw new Error(
      "Live execution is gated. Both --live-execution and --accept-real-money-risk are required.",
    );
  }
  const boundPath = optionValue(args, "--bound-execution");
  const receiptPath = optionValue(args, "--confirmation-receipt");
  const keyFile = optionValue(args, "--key-file");
  if (!boundPath || !receiptPath || !keyFile) {
    throw new Error(
      "Usage: execute --bound-execution /path/to/bound.json --confirmation-receipt /path/to/receipt.json --key-file /outside/repo/cdp_key.json --live-execution --accept-real-money-risk",
    );
  }
  const [boundExecution, executionConfirmation, safetyProfile] =
    await Promise.all([
      readBoundExecution(boundPath),
      readExecutionConfirmation(receiptPath),
      loadSafetyProfile(),
    ]);
  const verifiedTrade = await loadAndVerifyTradeCredentials(keyFile);
  const { plan } = assertExecutionConfirmation({
    receipt: executionConfirmation,
    boundExecution,
    attestation: verifiedTrade.attestation,
    current: new Date(),
  });
  const coinbase = createCoinbaseRestAdapter(verifiedTrade.credentials);
  const coinbaseExecution = createCoinbaseExecutionAdapter(
    verifiedTrade.credentials,
    production.executionCapability,
  );
  const record = await runExecutionPipeline({
    mode: "LIVE",
    executionCapability: production.executionCapability,
    plan,
    confirmPolicyDigest: boundExecution.policy_confirmation.supplied_digest,
    boundExecution,
    executionConfirmation,
    safetyProfile,
    attestation: verifiedTrade.attestation,
    getProduct: coinbase.getProduct,
    getBestBidAsk: coinbase.getBestBidAsk,
    previewAdapter: coinbase.previewOrder,
    mandateAdapter: production.mandateAdapter,
    createAdapter: coinbaseExecution.createOrder,
    getOrderAdapter: coinbase.getOrder,
    listFillsAdapter: coinbase.listFills,
    consumeGrant: production.consumeGrant,
    markGrant: production.markGrant,
  });
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  const paths = await writeExecutionReport(
    record,
    `live-execution-${timestamp}`,
  );
  process.stdout.write(`${record.status}\n`);
  printPaths(paths);
  if (!["FILLED", "PARTIAL_FILL", "NO_FILL"].includes(record.status)) {
    process.exitCode = 1;
  }
}

async function reconcileExecution(args) {
  const production = assertProductionExecutionDependencies(
    await loadProductionExecutionDependencies(),
  );
  const boundPath = optionValue(args, "--bound-execution");
  const keyFile = optionValue(args, "--key-file");
  if (!boundPath || !keyFile) {
    throw new Error(
      "Usage: reconcile-execution --bound-execution /path/to/bound.json --key-file /outside/repo/cdp_key.json",
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
  const stored = await production.readGrant(plan.plan_id);
  const coinbase = createCoinbaseRestAdapter(verifiedTrade.credentials);
  const record = await recoverExecution({
    planId: plan.plan_id,
    stored,
    attestation: verifiedTrade.attestation,
    listOrdersAdapter: coinbase.listOrders,
    getOrderAdapter: coinbase.getOrder,
    listFillsAdapter: coinbase.listFills,
    markGrant: production.markGrant,
  });
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
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

function usage() {
  return `Delta Coinbase Guard V1

Commands:
  doctor
  plan --intent "..." [--compiler deterministic|openai]
  plan --intent-file /absolute/path/to/intent.txt [--compiler deterministic|openai]
  simulate --plan /path/to/plan.json --confirm-policy <digest>
  configure-execution --key-file /outside/repo/cdp_key.json
  bind-execution --plan /path/to/plan.json --confirm-policy <digest> --key-file /outside/repo/cdp_key.json
  confirm-execution --bound-execution /path/to/bound.json --confirm-execution <digest> --key-file /outside/repo/cdp_key.json
  probe-execution --bound-execution /path/to/bound.json --confirmation-receipt /absolute/path/to/receipt.json --key-file /outside/repo/cdp_key.json
  execute --bound-execution /path/to/bound.json --confirmation-receipt /absolute/path/to/receipt.json --key-file /outside/repo/cdp_key.json --live-execution --accept-real-money-risk
  reconcile-execution --bound-execution /path/to/bound.json --key-file /outside/repo/cdp_key.json

The public V1 supports planning, deterministic simulation, credential-scoped
confirmation, and a real Coinbase Preview probe. Coinbase Create and recovery are
compile-time locked until Delta engineering installs the reviewed mandate adapter
and durable one-time grant store in src/integration/production-composition.js.
`;
}

const [command, ...args] = process.argv.slice(2);

try {
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(usage());
  } else if (command === "doctor") {
    await doctor();
  } else if (command === "plan") {
    await createPlanCommand(args);
  } else if (command === "simulate") {
    await simulate(args);
  } else if (command === "configure-execution") {
    await configureExecution(args);
  } else if (command === "bind-execution") {
    await bindExecution(args);
  } else if (command === "confirm-execution") {
    await confirmExecution(args);
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
  const message = sanitize(
    error instanceof Error ? error.message : String(error),
  );
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
}
