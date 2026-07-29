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
  const simulated = artifactClass === "SIMULATED";
  return {
    artifact_class: artifactClass,
    status: simulated ? "EXECUTION_ELIGIBLE" : "FILLED",
    generated_at: "2026-07-24T12:00:00.000Z",
    record_digest: "a".repeat(64),
    policy: {
      product_id: "ETH-USDC",
      base_asset: "ETH",
      quote_asset: "USDC",
      side: "BUY",
      size: {
        operator: "MAX",
        value: "3000",
        asset: "USDC",
      },
      market_condition: {
        reference: "BEST_ASK",
        operator: "AT_OR_BELOW",
        value: "3000",
        asset: "USDC",
      },
      order_type: "SOR_LIMIT_IOC",
      limits: {
        max_slippage_bps: 35,
        settlement: {
          kind: "MAX_QUOTE_DEBIT",
          value: "3015",
        },
      },
    },
    market: {
      best_ask: "2995",
    },
    funding: {
      decision: "PASS",
      available_balance: "5000",
      funding_asset: "USDC",
    },
    proposal: {
      action: {
        product_id: "ETH-USDC",
        side: "BUY",
        quote_size: "2990",
        limit_price: "3000",
        time_in_force: "IOC",
      },
    },
    proposal_check: { decision: "PASS" },
    preview: {
      evidence: {
        est_average_filled_price: "2997",
        commission_total: "10",
        order_total: "3000",
      },
    },
    preview_check: { decision: "PASS" },
    delta: {
      status: "success",
      decision: "PASS",
      intent_id: "intent-test",
      verifier_confirmed: true,
      proof_digest: "b".repeat(64),
      cryptographic_proof_verified: false,
      proof_verification: {
        verified: true,
        cryptographically_verified: false,
        method: "SIMULATED_BINDING_CHECK_ONLY",
        verifier_identity: "SIMULATED_LOCAL_TEST_DOUBLE",
        program_id: null,
        proof_digest: "b".repeat(64),
      },
      receipt: {
        receipt_integrity: "LOCAL_SHA256_DIGEST",
        receipt_digest: "c".repeat(64),
      },
    },
    reconciliation: null,
    execution: {
      adapter_invoked: false,
      order_submitted: false,
      one_time_gate_consumed: simulated,
    },
    simulation: simulated
      ? {
          fixture_data: true,
          external_executor_invoked: false,
          exchange_outcome_observed: false,
        }
      : undefined,
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

test("simulation report stops at exact-payload eligibility without claiming a fill", () => {
  const html = renderExecutionHtml(record());
  assert.match(html, /SIMULATED · EXACT PAYLOAD ELIGIBLE/);
  assert.match(html, /NO CREATE · NO SUBMISSION · NO EXCHANGE OUTCOME/);
  assert.match(html, /Maximum size/);
  assert.match(html, /Fresh best ask at or below 3000 USDC/);
  assert.match(html, /Proposed size<\/dt><dd>2990 USDC/);
  assert.match(html, /Labeled Preview fixture/);
  assert.match(html, /Proposal check<\/dt><dd>PASS/);
  assert.match(html, /Preview check<\/dt><dd>PASS/);
  assert.match(html, /SIMULATED_BINDING_CHECK_ONLY/);
  assert.match(html, /Cryptographic proof verified<\/dt><dd>NO/);
  assert.match(html, /LOCAL_SHA256_DIGEST/);
  assert.doesNotMatch(html, /FULL-FILL/);
  assert.doesNotMatch(html, /Actual outcome/);
  assert.doesNotMatch(html, /Observed Coinbase outcome/);
  assert.doesNotMatch(html, /"status": "FILLED"/);
});

test("report renders an exact-size policy without inventing a condition", () => {
  const exact = record();
  exact.policy.size.operator = "EXACT";
  exact.policy.size.value = "0.25";
  exact.policy.size.asset = "SOL";
  exact.policy.market_condition = null;
  exact.policy.product_id = "SOL-USDC";
  exact.policy.base_asset = "SOL";
  exact.proposal.action.product_id = "SOL-USDC";
  exact.proposal.action.quote_size = undefined;
  exact.proposal.action.base_size = "0.25";
  exact.proposal.action.side = "SELL";
  exact.policy.side = "SELL";
  const html = renderExecutionHtml(exact);
  assert.match(html, /Exact size<\/dt><dd>0.25 SOL/);
  assert.match(html, /Market condition<\/dt><dd>None/);
  assert.match(html, /Proposed size<\/dt><dd>0.25 SOL/);
});

test("showcase HTML surfaces the bounded external-controller retry", () => {
  const showcase = record();
  showcase.demo = {
    bounded_retry: {
      max_attempts: 2,
      terminal_status: "SIMULATED_GATE_REACHED",
      note: "Illustrative controller trace.",
      human_mandate: {
        product_id: "ETH-USDC",
        max_allocation_usdc: "3000",
      },
      attempts: [
        { disposition: "RETRY", receipt: { verdict: "BLOCK" } },
        { disposition: "EXECUTE", receipt: { verdict: "PASS" } },
      ],
      execution: {
        external_executor_invoked: false,
        coinbase_create_invoked: false,
      },
    },
  };
  const html = renderExecutionHtml(showcase);
  assert.match(html, /Bounded deterministic retry/);
  assert.match(html, /BLOCK → RETRY · specific violations/);
  assert.match(html, /PASS → EXECUTE · exact payload and evidence bound/);
  assert.match(html, /Coinbase Create<\/dt><dd>NOT INVOKED/);
  assert.match(html, /External executor<\/dt><dd>NOT INVOKED/);
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
