#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8"));
}

const packageJson = await json("package.json");
assert(
  /^\d+\.\d+\.\d+$/.test(packageJson.version),
  "package.json version must be a release SemVer",
);
const [major, minor] = packageJson.version.split(".");
assert(
  packageJson.name === "delta-coinbase-guard",
  "package name must be delta-coinbase-guard",
);
assert(
  packageJson.private === true,
  "package must remain private so a release cannot publish it to npm",
);
assert(
  packageJson.engines?.node === ">=22",
  "package Node engine must remain >=22",
);
assert(
  packageJson.scripts?.["check:release"] ===
    "node scripts/validate-release-metadata.mjs",
  "package must expose check:release",
);
assert(
  packageJson.scripts?.["release:bundle"] ===
    "bash scripts/build-release-bundle.sh HEAD",
  "package release:bundle must build the committed HEAD by default",
);

const nvmrc = (await readFile(path.join(ROOT, ".nvmrc"), "utf8")).trim();
assert(nvmrc === "22", ".nvmrc must match the Node 22 release floor");

const skill = await readFile(
  path.join(ROOT, "skills/delta-coinbase-guard/SKILL.md"),
  "utf8",
);
assert(
  skill.includes(`# Delta Coinbase Guard v${major}.${minor}`),
  "skill heading must match package major/minor version",
);

const schema = await json("config/coinbase-spot-policy.v2.schema.json");
assert(
  schema.properties?.schema_version?.const ===
    "delta.coinbase.compilation.v2",
  "release must contain the v2 policy compilation schema",
);
assert(
  schema.properties?.taxonomy_version?.const ===
    "digital-asset-spot-order.v2",
  "release must contain the v2 spot-order taxonomy",
);

const preview = await json("config/preview-capability-profile.json");
assert(
  JSON.stringify(preview.allowed_sides) === JSON.stringify(["BUY", "SELL"]),
  "Preview capability must explicitly allow BUY and SELL",
);
assert(
  preview.create_enabled === false,
  "public Preview capability must keep Coinbase Create disabled",
);

const liveSafety = await json("config/execution-safety-profile.json");
assert(
  liveSafety.max_principal === "5.00" &&
    liveSafety.max_executions === 1,
  "future live safety profile must remain capped at 5.00 and one execution",
);

for (const relativePath of [
  "install",
  "run",
  "skills/delta-coinbase-guard/scripts/run",
]) {
  await access(path.join(ROOT, relativePath), constants.X_OK);
}

process.stdout.write(
  `Release metadata is coherent for delta-coinbase-guard v${packageJson.version}.\n`,
);
