import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "../src/evidence.js";
import { inspectPartnerDemoReceipt } from "../src/partner-demo.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(root, "output", "mastra");
const [json, html] = await Promise.all([
  readFile(
    path.join(outputDirectory, "mastra-delta-partner-proof.json"),
    "utf8",
  ),
  readFile(
    path.join(outputDirectory, "mastra-delta-partner-proof.html"),
    "utf8",
  ),
]);
const bundle = JSON.parse(json);
const { bundle_digest: bundleDigest, ...unsignedBundle } = bundle;

assert.equal(bundleDigest, digest(unsignedBundle));
assert.deepEqual(
  bundle.outcomes.map(({ decision }) => decision),
  ["PASS", "BLOCK", "REVIEW"],
);
assert.deepEqual(bundle.claims, {
  mastra_runtime_exercised: false,
  brex_contacted: false,
  production_delta_invoked: false,
  money_moved: false,
});

for (const record of bundle.records) {
  const { record_digest: recordDigest, ...unsignedRecord } = record;
  assert.equal(recordDigest, digest(unsignedRecord));
  const verification = inspectPartnerDemoReceipt(record.receipt, {
    // This validates the checked-in artifact against the key the generating
    // controller pinned for that run. It is not production issuer trust.
    trustedPublicKeyPem: record.receipt.public_key_pem,
    mandate: record.mandate,
    proposal: record.proposal,
    evidence: record.evidence,
    executionPayload: record.execution_payload,
    decision: record.decision,
    current: new Date(record.generated_at),
  });
  assert.equal(verification.artifact_verified, true);
  if (record.decision.decision === "PASS") {
    assert.equal(verification.execution_authorized, true);
    assert.equal(record.execution.adapter_invoked, true);
    assert.equal(record.execution.grant_consumed, true);
  } else {
    assert.equal(verification.execution_authorized, false);
    assert.equal(record.execution.adapter_invoked, false);
    assert.equal(record.execution.grant_consumed, false);
  }
}

assert.match(
  html,
  /NO LIVE MASTRA SERVER, BREX API, PRODUCTION DELTA, OR MONEY MOVEMENT/,
);
assert.match(html, /Schema-valid is not the same as authorized/);
assert.match(html, /PASS/);
assert.match(html, /BLOCK/);
assert.match(html, /REVIEW/);

process.stdout.write(
  "Mastra partner HTML and JSON artifacts are internally consistent.\n",
);
