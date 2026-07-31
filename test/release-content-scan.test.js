import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCANNER = path.resolve("scripts/scan-release-content.mjs");

async function withPayload(callback) {
  const root = await mkdtemp(
    path.join(tmpdir(), "delta-coinbase-release-scan-test-"),
  );
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function scan(root) {
  return spawnSync(process.execPath, [SCANNER, root], {
    encoding: "utf8",
  });
}

test("release content scan accepts a small text-only payload", async () => {
  await withPayload(async (root) => {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "README.md"), "# safe release\n");
    await writeFile(path.join(root, "src", "index.js"), "export {};\n");

    const result = scan(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release content scan passed: 2 text files/);
  });
});

test("release content scan rejects embedded private-key material", async () => {
  await withPayload(async (root) => {
    const marker = ["-----BEGIN ", "EC PRIVATE KEY-----"].join("");
    await writeFile(path.join(root, "unsafe.txt"), `${marker}\nsecret\n`);

    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /contains private-key material/);
  });
});

test("release content scan rejects embedded image data that could hide a canary", async () => {
  await withPayload(async (root) => {
    const privateMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    const encodedCanary = Buffer.from(privateMarker).toString("base64");
    const imageScheme = ["data", "image/png;base64"].join(":");
    const imageElement = ["<", "image"].join("");
    await writeFile(
      path.join(root, "unsafe.svg"),
      `${imageElement} href="${imageScheme},${encodedCanary}" />\n`,
    );

    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /contains an embedded image/);
  });
});

test("release content scan rejects provider-token-shaped values", async () => {
  await withPayload(async (root) => {
    const prefix = ["gh", "p_"].join("");
    const token = `${prefix}${"a".repeat(24)}`;
    await writeFile(path.join(root, "unsafe.txt"), `${token}\n`);

    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /contains a provider token/);
  });
});

test("release content scan rejects non-placeholder Coinbase credentials", async () => {
  await withPayload(async (root) => {
    const variable = ["COINBASE_", "API_SECRET"].join("");
    const value = ["not-a-", "placeholder-secret-value"].join("");
    await writeFile(path.join(root, "unsafe.txt"), `${variable}=${value}\n`);

    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /contains a Coinbase credential assignment/);
  });
});

test("release content scan rejects runtime and credential-shaped paths", async () => {
  await withPayload(async (root) => {
    await mkdir(path.join(root, "runtime"));
    await writeFile(path.join(root, "runtime", "state.json"), "{}\n");

    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /credential- or runtime-shaped path/);
  });
});

test("release content scan rejects non-Coinbase partner-demo paths", async () => {
  await withPayload(async (root) => {
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "mastra-partner.js"),
      "export {};\n",
    );

    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the Coinbase release product scope/);
  });
});

test("release content scan rejects binary files", async () => {
  await withPayload(async (root) => {
    await writeFile(path.join(root, "binary.dat"), Buffer.from([1, 0, 2]));

    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /contains binary data/);
  });
});
