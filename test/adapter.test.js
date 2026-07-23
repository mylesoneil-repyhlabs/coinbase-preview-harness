import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildChildEnvironment, buildPreviewArgs, CLI_ENTRY, dryRunPreview, HARNESS_ROOT } from "../src/coinbase-cli.js";

const order = {
  product_id: "ETH-USDC",
  side: "BUY",
  type: "market",
  quote_size: "20.00",
};

test("builds only the fixed Coinbase preview command", () => {
  assert.deepEqual(buildPreviewArgs(order), [
    "orders",
    "preview",
    "product_id=ETH-USDC",
    "side=BUY",
    "type=market",
    "quote_size=20.00",
  ]);
  assert.ok(path.isAbsolute(CLI_ENTRY));
});

test("shell metacharacters remain a single inert argument", () => {
  const args = buildPreviewArgs({ ...order, product_id: "ETH-USDC; touch /tmp/pwned" });
  assert.equal(args[2], "product_id=ETH-USDC; touch /tmp/pwned");
  assert.equal(args.length, 6);
});

test("child environment scrubs ambient Coinbase credentials and pins isolation", () => {
  const environment = buildChildEnvironment();
  assert.equal(environment.COINBASE_NO_HISTORY, "1");
  assert.equal(environment.COINBASE_NO_UPDATE_CHECK, "1");
  assert.equal(environment.COINBASE_ENV, "live-delta-preview");
  for (const forbidden of ["COINBASE_KEY_ID", "COINBASE_KEY_SECRET", "COINBASE_KEYRING_SECRET", "COINBASE_URL"]) {
    assert.equal(Object.hasOwn(environment, forbidden), false);
  }
});

test("official CLI dry-run assembles the exact request without credentials", async () => {
  const result = await dryRunPreview(order);
  assert.equal(result.action, "orders_preview");
  assert.equal(result.contacted_coinbase, false);
  assert.deepEqual(result.request, order);
});

test("production source contains no Coinbase order execution command", async () => {
  const sourceFiles = [
    "src/coinbase-cli.js",
    "src/pipeline.js",
    "src/cli.js",
    "src/permissions.js",
    "src/sandbox.js",
  ];
  const contents = await Promise.all(sourceFiles.map((file) => readFile(path.join(HARNESS_ROOT, file), "utf8")));
  const source = contents.join("\n");
  assert.doesNotMatch(source, /orders[_ -]create/i);
  assert.doesNotMatch(source, /convert[_ -]execute/i);
  assert.doesNotMatch(source, /close[_ -]position/i);
  assert.doesNotMatch(source, /\btransfer\b/i);
});
