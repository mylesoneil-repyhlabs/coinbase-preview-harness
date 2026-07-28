#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  createCoinbaseExecutionAdapter,
  createCoinbaseRestAdapter,
} from "./coinbase-rest.js";
import { runCoinbaseDemo } from "./coinbase-demo.js";
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
  loadAndVerifyViewCredentials,
  loadAndVerifyTradeCredentials,
  TRADE_ATTESTATION_PATH,
  VIEW_ATTESTATION_PATH,
  verifyViewKeyFileAndConfigure,
  verifyTradeKeyFileAndConfigure,
} from "./permissions.js";
import { HARNESS_ROOT } from "./paths.js";
import {
  runMastraPartnerBundle,
  runMastraPartnerDemo,
} from "./mastra-partner.js";
import {
  writeMastraPartnerBundleReport,
  writePartnerDemoReport,
} from "./partner-demo.js";
import {
  createExecutionPlan,
  loadPreviewCapabilityProfile,
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

function printPreviewProbeSummary(record) {
  process.stdout.write("COINBASE_PREVIEW_PROBE\n");
  process.stdout.write(
    `AUTHORIZED_POLICY=${JSON.stringify(record.policy)}\n`,
  );
  process.stdout.write(
    `AUTHORIZATION_DIGEST=${record.policy_digest ?? "none"}\n`,
  );
  process.stdout.write(
    `CANONICAL_ACTION=${JSON.stringify(record.action_descriptor)}\n`,
  );
  process.stdout.write(
    `FUNDING_CHECK=${JSON.stringify(record.funding)}\n`,
  );
  process.stdout.write(
    `AGENT_PROPOSAL=${JSON.stringify(record.proposal)}\n`,
  );
  process.stdout.write(
    `PROPOSAL_DECISION=${record.proposal_check?.decision ?? "NOT_REACHED"}\n`,
  );
  process.stdout.write(
    `COINBASE_PREVIEW_EVIDENCE=${JSON.stringify(record.preview)}\n`,
  );
  process.stdout.write(
    `PREVIEW_DECISION=${record.preview_check?.decision ?? "NOT_REACHED"}\n`,
  );
  process.stdout.write(
    `PREVIEW_REVIEW_REASONS=${JSON.stringify(
      record.preview_check?.review_reasons ?? [],
    )}\n`,
  );
  process.stdout.write(
    `FAILURE=${JSON.stringify(record.failure ?? null)}\n`,
  );
  process.stdout.write("DELTA_DECISION=NOT_RUN_PREVIEW_ONLY\n");
  process.stdout.write("EXACT_PASS_GATE=false\n");
  process.stdout.write("EXECUTION_ELIGIBILITY=LOCKED\n");
  process.stdout.write("COINBASE_CONTACTED=true\n");
  process.stdout.write("COINBASE_CREATE_INVOKED=false\n");
  process.stdout.write("PRODUCTION_DELTA_INVOKED=false\n");
  process.stdout.write("MONEY_MOVED=false\n");
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
    "config/coinbase-spot-policy.v2.schema.json",
    "config/preview-capability-profile.json",
    "config/execution-safety-profile.json",
    "skills/delta-coinbase-guard/SKILL.md",
  ];
  try {
    await Promise.all(
      requiredFiles.map((file) => access(path.join(HARNESS_ROOT, file))),
    );
    checks.push({
      name: "v1.3 contracts and skill",
      status: "PASS",
      detail:
        "Generic spot policy, Preview capability, live safety profile, and installable skill are present.",
    });
  } catch {
    checks.push({
      name: "v1.3 contracts and skill",
      status: "FAIL",
      detail: "One or more required v1.3 files are missing.",
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
    process.stdout.write(
      `Canonical Coinbase action:\n${JSON.stringify(
        plan.action_descriptor,
        null,
        2,
      )}\n\n`,
    );
    process.stdout.write(`Policy digest: ${plan.policy_digest}\n`);
    process.stdout.write(
      "PAUSE: nothing may be proposed or previewed until a trusted host receives a new user-authored message authorizing the displayed policy digest.\n",
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

async function configurePreview(args) {
  const keyFile = optionValue(args, "--key-file");
  if (!keyFile) {
    throw new Error(
      "Usage: configure-preview-credentials --key-file /absolute/path/to/cdp_key.json",
    );
  }
  const result = await verifyViewKeyFileAndConfigure(keyFile);
  process.stdout.write(`${JSON.stringify(result.attestation, null, 2)}\n`);
  process.stdout.write(
    "View-only credential verified; Trade/Transfer/Receive are absent. The key remains outside this repository and is not copied by the guard.\n",
  );
}

async function credentialReadiness() {
  const [viewConfigured, tradeConfigured] = await Promise.all([
    access(VIEW_ATTESTATION_PATH).then(
      () => true,
      () => false,
    ),
    access(TRADE_ATTESTATION_PATH).then(
      () => true,
      () => false,
    ),
  ]);
  process.stdout.write(
    `${
      viewConfigured || tradeConfigured
        ? "CREDENTIAL_ATTESTATION_PRESENT"
        : "CREDENTIALS_NOT_CONFIGURED"
    }\n`,
  );
  process.stdout.write(
    `VIEW_ATTESTATION=${viewConfigured ? "PRESENT" : "NOT_CONFIGURED"}\n`,
  );
  process.stdout.write(
    `FUTURE_EXECUTOR_ATTESTATION=${
      tradeConfigured ? "PRESENT" : "NOT_CONFIGURED"
    }\n`,
  );
  process.stdout.write(
    "KEY_LOCATION=external absolute path supplied only at command time\n",
  );
  process.stdout.write(
    "PLANNER_SCOPE=View only; Trade+Transfer+Receive disabled\n",
  );
  process.stdout.write(
    "FUTURE_EXECUTOR_SCOPE=View+Trade; Transfer+Receive disabled; key isolated from the agent\n",
  );
  process.stdout.write(
    "PERSISTED_SECRET_MATERIAL=false\n",
  );
  process.stdout.write(
    "LIVE_CREATE=LOCKED_PENDING_REVIEWED_DELTA_ADAPTER_AND_ONE_TIME_GRANT_STORE\n",
  );
  process.stdout.write(
    "FUTURE_LIVE_SAFETY_CAP=5.00 USDC principal; 5.50 USDC all-in; one ETH-USDC IOC order; 120 seconds\n",
  );
  process.stdout.write(
    "For trusted reads/Preview, keep a View-only key outside this repository with mode 0600, then run configure-preview-credentials with its absolute path. Do not supply a View+Trade executor key until live testing is the only remaining blocker.\n",
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
  const credentialRole =
    optionValue(args, "--credential-role") ?? "preview";
  if (!["preview", "executor"].includes(credentialRole)) {
    throw new Error(
      "--credential-role must be preview or executor",
    );
  }
  const verified =
    credentialRole === "preview"
      ? await loadAndVerifyViewCredentials(keyFile)
      : await loadAndVerifyTradeCredentials(keyFile);
  const boundExecution = createBoundExecution(
    plan,
    verified.attestation,
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
  const tradeBound =
    boundExecution.authorization_scope?.credential_binding?.can_trade ===
    true;
  const verified = tradeBound
    ? await loadAndVerifyTradeCredentials(keyFile)
    : await loadAndVerifyViewCredentials(keyFile);
  const receipt = createExecutionConfirmation({
    boundExecution,
    attestation: verified.attestation,
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
  process.stdout.write(
    `AUTHORIZED_POLICY=${JSON.stringify(record.policy)}\n`,
  );
  process.stdout.write(
    `AUTHORIZATION_DIGEST=${record.policy_digest}\n`,
  );
  process.stdout.write(
    `CANONICAL_ACTION=${JSON.stringify(record.action_descriptor)}\n`,
  );
  process.stdout.write(
    `FUNDING_CHECK=${JSON.stringify(record.funding)}\n`,
  );
  process.stdout.write(
    `AGENT_PROPOSAL=${JSON.stringify(record.proposal)}\n`,
  );
  process.stdout.write(
    `PROPOSAL_DECISION=${record.proposal_check?.decision ?? "NOT_REACHED"}\n`,
  );
  process.stdout.write(
    `COINBASE_PREVIEW_FIXTURE=${JSON.stringify(record.preview)}\n`,
  );
  process.stdout.write(
    `PREVIEW_DECISION=${record.preview_check?.decision ?? "NOT_REACHED"}\n`,
  );
  process.stdout.write(
    `DELTA_DECISION=${record.delta?.decision ?? "NOT_REACHED"}\n`,
  );
  process.stdout.write(
    `DELTA_DECISION_RECEIPT=${JSON.stringify(record.delta?.receipt ?? null)}\n`,
  );
  process.stdout.write(
    `PROOF_PRESENT=${record.delta?.proof_present === true}\n`,
  );
  process.stdout.write(
    `PROOF_DIGEST=${record.delta?.proof_digest ?? "none"}\n`,
  );
  process.stdout.write(
    `FAILURE=${JSON.stringify(record.failure ?? null)}\n`,
  );
  process.stdout.write(
    "RETRY_POLICY=Only a structured retryable BLOCK may be retried; maximum attempts are controller-bounded; REVIEW stops locked.\n",
  );
  process.stdout.write(
    `EXACT_PASS_GATE=${
      record.delta?.decision === "PASS" &&
      record.delta?.verifier_confirmed === true
    }\n`,
  );
  process.stdout.write(`SIMULATED_RESULT=${record.status}\n`);
  process.stdout.write(
    `SIMULATED_EXECUTOR_INVOKED=${record.execution.adapter_invoked}\n`,
  );
  process.stdout.write(
    "SIMULATED_EXECUTOR_TYPE=IN_MEMORY_COINBASE_SHAPED_ADAPTER; NO_NETWORK\n",
  );
  process.stdout.write("COINBASE_CREATE_INVOKED=false\n");
  process.stdout.write("COINBASE_CONTACTED=false\n");
  process.stdout.write("PRODUCTION_DELTA_INVOKED=false\n");
  process.stdout.write("MONEY_MOVED=false\n");
  printPaths(paths);
  if (!["FILLED", "PARTIAL_FILL", "NO_FILL"].includes(record.status)) {
    process.exitCode = 1;
  }
}

async function coinbaseDemo(args) {
  const unsupported = args.filter((argument) => argument !== "--no-artifacts");
  if (unsupported.length > 0) {
    throw new Error("Usage: coinbase-demo [--no-artifacts]");
  }
  const record = await runCoinbaseDemo();
  const retry = record.demo.bounded_retry;
  const first = retry.attempts[0];
  const second = retry.attempts[1];
  process.stdout.write("SIMULATION_ONLY\n");
  process.stdout.write("CONDITIONAL_MANDATE_SHOWCASE=COMPLETE\n");
  process.stdout.write(`HUMAN_MANDATE=${retry.human_mandate_text}\n`);
  process.stdout.write(
    `AUTHORIZED_POLICY=${JSON.stringify(retry.human_mandate)}\n`,
  );
  process.stdout.write(
    "AUTHORIZATION_STATUS=USER_REQUESTED_SIMULATION_ONLY; NOT_LIVE_TRADE_AUTHORIZATION\n",
  );
  process.stdout.write(`MANDATE_DIGEST=${first.receipt.mandate_digest}\n`);
  process.stdout.write(
    `AUTHORIZATION_DIGEST=${first.receipt.authorization_digest}\n`,
  );
  process.stdout.write(`AUTHORIZED_AT=${first.receipt.authorized_at}\n`);
  process.stdout.write(
    `MANDATE_EXPIRES_AT=${first.receipt.mandate_expires_at}\n`,
  );
  process.stdout.write(
    `AGENT_PROPOSAL_1=${JSON.stringify(first.exact_payload)}\n`,
  );
  process.stdout.write(
    `ATTEMPT_1_FIXTURE_ECONOMICS=${JSON.stringify(first.economics)}\n`,
  );
  process.stdout.write(
    `ATTEMPT_1_EVIDENCE_DIGEST=${first.evidence_digest}\n`,
  );
  process.stdout.write(
    `ATTEMPT_1_EVIDENCE_SOURCE=${first.evidence.collected_by}\n`,
  );
  process.stdout.write(
    `ATTEMPT_1=${first.receipt.verdict}->${first.disposition} ` +
      `PROPOSAL_DIGEST=${first.exact_payload_digest}\n`,
  );
  process.stdout.write(
    `ATTEMPT_1_FAILURES=${JSON.stringify(
      first.constraint_failures.map(({ id, reason }) => ({ id, reason })),
    )}\n`,
  );
  process.stdout.write(
    `ATTEMPT_1_RECEIPT=${JSON.stringify(first.receipt)}\n`,
  );
  process.stdout.write(
    `ATTEMPT_1_RECEIPT_VERIFIED=${first.receipt.verified}\n`,
  );
  process.stdout.write("CONTROLLER_ACTION=RETRY_ONCE_WITHIN_FIXED_BUDGET\n");
  process.stdout.write(
    "RETRY_EVIDENCE=NEW_LABELED_MARKET_PREVIEW_AND_PORTFOLIO_FIXTURE; AGENT_CANNOT_AUTHOR_EVIDENCE\n",
  );
  process.stdout.write(
    `AGENT_PROPOSAL_2=${JSON.stringify(second.exact_payload)}\n`,
  );
  process.stdout.write(
    `ATTEMPT_2_FIXTURE_ECONOMICS=${JSON.stringify(second.economics)}\n`,
  );
  process.stdout.write(
    `ATTEMPT_2_EVIDENCE_DIGEST=${second.evidence_digest}\n`,
  );
  process.stdout.write(
    `ATTEMPT_2_EVIDENCE_SOURCE=${second.evidence.collected_by}\n`,
  );
  process.stdout.write(
    `ATTEMPT_2=${second.receipt.verdict}->${second.disposition} ` +
      `PROPOSAL_DIGEST=${second.exact_payload_digest}\n`,
  );
  process.stdout.write(
    `ATTEMPT_2_RECEIPT=${JSON.stringify(second.receipt)}\n`,
  );
  process.stdout.write(
    `ATTEMPT_2_RECEIPT_VERIFIED=${second.receipt.verified}\n`,
  );
  process.stdout.write(
    `EXECUTION_ELIGIBILITY=${retry.execution.status}\n`,
  );
  process.stdout.write(
    `EXECUTION_PAYLOAD_DIGEST=${retry.execution.exact_payload_digest}\n`,
  );
  process.stdout.write(
    `EXECUTION_EVIDENCE_DIGEST=${retry.execution.evidence_digest}\n`,
  );
  process.stdout.write(`EXECUTION_GATE=${retry.execution.gate}\n`);
  process.stdout.write(
    `EXACT_PAYLOAD_MATCH=${
      retry.execution.exact_payload_digest === second.exact_payload_digest
    }\n`,
  );
  process.stdout.write(
    `EVIDENCE_MATCH=${
      retry.execution.evidence_digest === second.evidence_digest
    }\n`,
  );
  process.stdout.write(
    `SIMULATED_TRACE_ELIGIBILITIES=${retry.execution.simulated_trace_eligibilities}\n`,
  );
  process.stdout.write(
    `DURABLE_ONE_TIME_GRANT_ISSUED=${retry.execution.durable_one_time_grant_issued}\n`,
  );
  process.stdout.write(
    `EXTERNAL_EXECUTOR_INVOKED=${retry.execution.external_executor_invoked}\n`,
  );
  process.stdout.write("PRODUCTION_DELTA_INVOKED=false\n");
  process.stdout.write("COINBASE_CONTACTED=false\n");
  process.stdout.write("COINBASE_CREATE_INVOKED=false\n");
  process.stdout.write("ARTIFACTS_WRITTEN=false\n");
}

async function mastraDemo(args) {
  const scenario = optionValue(args, "--scenario");
  const expectedArgs = scenario ? ["--scenario", scenario] : [];
  if (
    args.length !== expectedArgs.length ||
    args.some((argument, index) => argument !== expectedArgs[index])
  ) {
    throw new Error(
      "Usage: mastra-demo [--scenario pass|block|review]",
    );
  }
  process.stdout.write("SIMULATION_ONLY\n");
  process.stdout.write("MASTRA_PARTNER_PROOF=COMPLETE\n");
  if (scenario) {
    const record = await runMastraPartnerDemo({ scenario });
    const paths = await writePartnerDemoReport(record, {
      reportPrefix: "mastra-demo",
    });
    process.stdout.write(`DELTA_DECISION=${record.decision.decision}\n`);
    process.stdout.write(
      `PROPOSAL_DIGEST=${record.decision.proposal_digest}\n`,
    );
    process.stdout.write(
      `EVIDENCE_DIGEST=${record.decision.evidence_digest}\n`,
    );
    process.stdout.write(
      `EXECUTION_PAYLOAD_DIGEST=${record.decision.execution_payload_digest}\n`,
    );
    process.stdout.write(
      `RECEIPT_DIGEST=${record.receipt.receipt_digest}\n`,
    );
    process.stdout.write(
      `RECEIPT_INTEGRITY_VERIFIED=${record.receipt_verification.artifact_verified}\n`,
    );
    process.stdout.write(
      `EXECUTION_ELIGIBILITY=${record.execution.eligibility}\n`,
    );
    process.stdout.write(
      `ONE_USE_GRANT_CONSUMED=${record.execution.grant_consumed}\n`,
    );
    printPaths(paths);
  } else {
    const bundle = await runMastraPartnerBundle();
    const paths = await writeMastraPartnerBundleReport(bundle);
    process.stdout.write("SCENARIOS=PASS,BLOCK,REVIEW\n");
    process.stdout.write(`BUNDLE_DIGEST=${bundle.bundle_digest}\n`);
    process.stdout.write(
      `OUTCOMES=${JSON.stringify(bundle.outcomes)}\n`,
    );
    printPaths(paths);
  }
  process.stdout.write("MASTRA_RUNTIME_EXERCISED=false\n");
  process.stdout.write(
    "REFERENCE_MASTRA_RUNTIME=examples/mastra (pinned createTool + persisted REVIEW workflow)\n",
  );
  process.stdout.write("BREX_CONTACTED=false\n");
  process.stdout.write("PRODUCTION_DELTA_INVOKED=false\n");
  process.stdout.write("MONEY_MOVED=false\n");
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
  const [boundExecution, executionConfirmation, capabilityProfile] =
    await Promise.all([
      readBoundExecution(boundPath),
      readExecutionConfirmation(receiptPath),
      loadPreviewCapabilityProfile(),
    ]);
  const verifiedTrade = await loadAndVerifyViewCredentials(keyFile);
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
    capabilityProfile,
    attestation: verifiedTrade.attestation,
    listAccounts: coinbase.listAccounts,
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
  printPreviewProbeSummary(record);
  printPaths(paths);
  if (record.status !== "PREVIEW_PROBE_PASS") {
    process.exitCode = 1;
  } else {
    process.stdout.write(
      "Coinbase Preview passed and Create was not called. Public v1.3 cannot submit an order; reviewed Delta and executor integration is required.\n",
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
  const [
    boundExecution,
    executionConfirmation,
    capabilityProfile,
    executionSafetyProfile,
  ] =
    await Promise.all([
      readBoundExecution(boundPath),
      readExecutionConfirmation(receiptPath),
      loadPreviewCapabilityProfile(),
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
    capabilityProfile,
    executionSafetyProfile,
    attestation: verifiedTrade.attestation,
    listAccounts: coinbase.listAccounts,
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
  return `Delta Coinbase Guard v1.3

Commands:
  doctor
  credential-readiness
  configure-preview-credentials --key-file /outside/repo/view_key.json
  configure-executor-credentials --key-file /outside/repo/trade_key.json
  coinbase-demo [--no-artifacts]
  mastra-demo [--scenario pass|block|review]
  plan --intent "..." [--compiler deterministic|openai]
  plan --intent-file /absolute/path/to/intent.txt [--compiler deterministic|openai]
  simulate --plan /path/to/plan.json --confirm-policy <digest>
  configure-execution --key-file /outside/repo/cdp_key.json
  bind-execution --plan /path/to/plan.json --confirm-policy <digest> --key-file /outside/repo/cdp_key.json [--credential-role preview|executor]
  confirm-execution --bound-execution /path/to/bound.json --confirm-execution <digest> --key-file /outside/repo/cdp_key.json
  probe-execution --bound-execution /path/to/bound.json --confirmation-receipt /absolute/path/to/receipt.json --key-file /outside/repo/cdp_key.json
  execute --bound-execution /path/to/bound.json --confirmation-receipt /absolute/path/to/receipt.json --key-file /outside/repo/cdp_key.json --live-execution --accept-real-money-risk
  reconcile-execution --bound-execution /path/to/bound.json --key-file /outside/repo/cdp_key.json

The public v1.3 supports generic SPOT BUY/SELL planning, deterministic simulation,
credential-scoped confirmation, and a real Coinbase Preview probe. Coinbase Create and recovery are
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
  } else if (command === "credential-readiness") {
    await credentialReadiness();
  } else if (
    command === "configure-credentials" ||
    command === "configure-preview-credentials"
  ) {
    await configurePreview(args);
  } else if (command === "configure-executor-credentials") {
    await configureExecution(args);
  } else if (command === "coinbase-demo") {
    await coinbaseDemo(args);
  } else if (command === "mastra-demo") {
    await mastraDemo(args);
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
