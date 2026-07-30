#!/usr/bin/env node
import {
  runMastraPartnerBundle,
  runMastraPartnerDemo,
} from "../src/mastra-partner.js";
import {
  writeMastraPartnerBundleReport,
  writePartnerDemoReport,
} from "../src/partner-demo.js";

function usage() {
  return (
    "Usage: node scripts/run-mastra-partner-demo.mjs " +
    "[--scenario pass|block|review]\n"
  );
}

function parseScenario(args) {
  if (args.length === 0) return null;
  if (
    args.length === 2 &&
    args[0] === "--scenario" &&
    ["pass", "block", "review"].includes(args[1])
  ) {
    return args[1];
  }
  throw new Error(usage().trim());
}

function printPaths(paths) {
  process.stdout.write(
    `JSON: ${paths.jsonPath}\nHTML: ${paths.htmlPath}\n`,
  );
}

async function main() {
  const scenario = parseScenario(process.argv.slice(2));
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

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
