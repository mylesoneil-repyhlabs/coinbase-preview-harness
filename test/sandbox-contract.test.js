import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ROOT } from "../src/coinbase-cli.js";
import { evaluatePreview } from "../src/policy.js";

const mandate = {
  allowed_products: ["ETH-USDC"],
  allowed_sides: ["BUY"],
  allowed_order_types: ["market"],
  max_quote_size: "20.00",
  max_order_total: "21.00",
  max_commission_total: "1.00",
};

const order = {
  product_id: "ETH-USDC",
  side: "BUY",
  type: "market",
  quote_size: "20.00",
};

async function loadArtifact(name) {
  return JSON.parse(await readFile(path.join(HARNESS_ROOT, "artifacts", name), "utf8"));
}

test("Coinbase static sandbox artifact matches the preview response contract", async () => {
  const artifact = await loadArtifact("coinbase-static-sandbox.json");
  assert.equal(artifact.source, "coinbase_static_sandbox");
  assert.equal(typeof artifact.response.order_total, "string");
  assert.equal(typeof artifact.response.commission_total, "string");
  assert.ok(Array.isArray(artifact.response.errs));
});

test("documented Coinbase insufficient-funds response fails closed", async () => {
  const artifact = await loadArtifact(
    "coinbase-static-sandbox-previeworder-insufficient-fund.json",
  );
  assert.deepEqual(artifact.response.errs, ["PREVIEW_INSUFFICIENT_FUND"]);
  const result = evaluatePreview(mandate, order, artifact.response);
  assert.equal(result.verdict, "BLOCK");
  assert.ok(result.failures.some((failure) => failure.code === "COINBASE_PREVIEW_ERROR"));
});
