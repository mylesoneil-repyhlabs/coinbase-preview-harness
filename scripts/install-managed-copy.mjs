#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const INSTALL_SCHEMA = "delta.coinbase.managed_install.v1";
const PRODUCT = "delta-coinbase-guard";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const COPY_ENTRIES = Object.freeze([
  ".nvmrc",
  "README.md",
  "SECURITY.md",
  "config",
  "docs/COINBASE-CODEX-RECORDING-KIT.md",
  "docs/COINBASE-CREDENTIAL-SETUP.md",
  "docs/COINBASE-DEMO-ASSURANCE.md",
  "docs/COINBASE-EVIDENCE-CONTRACT.md",
  "docs/ENGINEERING-HANDOFF.md",
  "docs/MANDATE-ADAPTER-CONTRACT.md",
  "docs/SPRINT-LOG.md",
  "docs/ADVISOR-SPRINT-LOG.md",
  "docs/ADVISOR-DEMO-v1.6.md",
  "docs/RELEASE-NOTES-v1.6.0.md",
  "docs/VIRTUAL-ADVISOR-DESIGN-CONTRACT.md",
  "docs/VIRTUAL-ADVISOR-ROADMAP.md",
  "docs/VIRTUAL-ADVISOR-THREAT-MODEL.md",
  "examples/conditional-buy-intent.txt",
  "examples/conditional-sell-intent.txt",
  "examples/first-live-intent.txt",
  "examples/generic-buy-intent.txt",
  "examples/generic-sell-intent.txt",
  "examples/recording-v1.3-buy-intent.txt",
  "examples/recording-v1.3-sell-intent.txt",
  "install",
  "output/coinbase-demo-panels",
  "output/coinbase-v1.5-trust-panels",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "run",
  "scripts",
  "skills",
  "src",
  "web",
]);
const REPOSITORY_ONLY_PATHS = new Set([
  "scripts/generate-mastra-partner-assets.mjs",
  "scripts/run-mastra-partner-demo.mjs",
  "scripts/validate-mastra-partner-assets.mjs",
  "src/mastra-partner.js",
  "src/partner-demo.js",
]);
const REQUIRED_MANAGED_FILES = Object.freeze([
  "package.json",
  "run",
  "config/execution-safety-profile.json",
  "config/preview-capability-profile.json",
  "skills/delta-coinbase-guard/SKILL.md",
  "skills/delta-coinbase-guard/scripts/run",
  "src/cli.js",
  "src/advisor-server.js",
  "docs/ADVISOR-SPRINT-LOG.md",
  "docs/ADVISOR-DEMO-v1.6.md",
  "docs/RELEASE-NOTES-v1.6.0.md",
  "docs/VIRTUAL-ADVISOR-DESIGN-CONTRACT.md",
  "docs/VIRTUAL-ADVISOR-ROADMAP.md",
  "docs/VIRTUAL-ADVISOR-THREAT-MODEL.md",
  "web/index.html",
  "web/app.js",
  "web/styles.css",
]);
const MARKER_NAME = ".delta-coinbase-guard-install.json";
const NODE_PATH_NAME = ".delta-coinbase-guard-node";

function fail(message) {
  process.stderr.write(`Managed install error: ${message}\n`);
  process.exit(1);
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function assertDirectoryWithoutSymlink(directory, label) {
  if (!existsSync(directory)) fail(`${label} does not exist.`);
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} must be a real directory, not a symlink.`);
  }
}

function assertSafeRelativePath(relativePath) {
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath.split(path.sep).includes("..")
  ) {
    fail("managed manifest contains an unsafe path.");
  }
}

function isRepositoryOnlyPath(relativePath) {
  return REPOSITORY_ONLY_PATHS.has(
    relativePath.split(path.sep).join("/"),
  );
}

function copyEntry(sourceRoot, destinationRoot, relativePath, files) {
  assertSafeRelativePath(relativePath);
  const sourcePath = path.join(sourceRoot, relativePath);
  const destinationPath = path.join(destinationRoot, relativePath);
  const metadata = lstatSync(sourcePath);
  if (metadata.isSymbolicLink()) {
    fail(`source payload contains a symlink at ${relativePath}.`);
  }
  if (metadata.isDirectory()) {
    mkdirSync(destinationPath, {
      recursive: true,
      mode: metadata.mode & 0o777,
    });
    for (const child of readdirSync(sourcePath).sort()) {
      const childPath = path.join(relativePath, child);
      if (isRepositoryOnlyPath(childPath)) continue;
      copyEntry(
        sourceRoot,
        destinationRoot,
        childPath,
        files,
      );
    }
    return;
  }
  if (!metadata.isFile()) {
    fail(`source payload contains an unsupported file at ${relativePath}.`);
  }
  mkdirSync(path.dirname(destinationPath), {
    recursive: true,
    mode: 0o700,
  });
  copyFileSync(sourcePath, destinationPath);
  chmodSync(destinationPath, metadata.mode & 0o777);
  files.push({
    path: relativePath.split(path.sep).join("/"),
    sha256: sha256(destinationPath),
  });
}

function collectSourceEntry(sourceRoot, relativePath, files) {
  assertSafeRelativePath(relativePath);
  const sourcePath = path.join(sourceRoot, relativePath);
  const metadata = lstatSync(sourcePath);
  if (metadata.isSymbolicLink()) {
    fail(`source payload contains a symlink at ${relativePath}.`);
  }
  if (metadata.isDirectory()) {
    for (const child of readdirSync(sourcePath).sort()) {
      const childPath = path.join(relativePath, child);
      if (isRepositoryOnlyPath(childPath)) continue;
      collectSourceEntry(
        sourceRoot,
        childPath,
        files,
      );
    }
    return;
  }
  if (!metadata.isFile()) {
    fail(`source payload contains an unsupported file at ${relativePath}.`);
  }
  files.push({
    path: relativePath.split(path.sep).join("/"),
    sha256: sha256(sourcePath),
  });
}

function collectSourceFiles(sourceRoot) {
  assertDirectoryWithoutSymlink(sourceRoot, "source harness");
  const files = [];
  for (const entry of COPY_ENTRIES) {
    const sourcePath = path.join(sourceRoot, entry);
    if (!existsSync(sourcePath)) {
      fail(`source payload is missing ${entry}.`);
    }
    collectSourceEntry(sourceRoot, entry, files);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function writeNodePath(managedRoot, nodeBinary) {
  if (!path.isAbsolute(nodeBinary)) {
    fail("Node.js path must be absolute.");
  }
  const nodePathFile = path.join(managedRoot, NODE_PATH_NAME);
  if (existsSync(nodePathFile) && lstatSync(nodePathFile).isSymbolicLink()) {
    fail("refusing to replace a symlinked Node.js path file.");
  }
  const temporary = `${nodePathFile}.update.${process.pid}`;
  if (existsSync(temporary)) {
    fail("temporary Node.js path file already exists.");
  }
  writeFileSync(temporary, `${nodeBinary}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporary, nodePathFile);
}

function createManagedCopy(sourceRoot, destinationRoot, version, nodeBinary) {
  if (!VERSION_PATTERN.test(version)) fail("release version is invalid.");
  assertDirectoryWithoutSymlink(sourceRoot, "source harness");
  const canonicalSource = realpathSync(sourceRoot);
  const destinationWithinSource = path.relative(
    canonicalSource,
    path.resolve(destinationRoot),
  );
  if (
    destinationWithinSource === "" ||
    (!destinationWithinSource.startsWith(`..${path.sep}`) &&
      destinationWithinSource !== ".." &&
      !path.isAbsolute(destinationWithinSource))
  ) {
    fail("managed destination must be outside the source harness.");
  }
  if (existsSync(destinationRoot)) {
    fail("managed staging destination already exists.");
  }
  mkdirSync(destinationRoot, { mode: 0o700 });

  const files = [];
  for (const entry of COPY_ENTRIES) {
    const sourcePath = path.join(sourceRoot, entry);
    if (!existsSync(sourcePath)) {
      fail(`source payload is missing ${entry}.`);
    }
    copyEntry(sourceRoot, destinationRoot, entry, files);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const marker = {
    schema_version: INSTALL_SCHEMA,
    product: PRODUCT,
    version,
    files,
  };
  writeFileSync(
    path.join(destinationRoot, MARKER_NAME),
    `${JSON.stringify(marker, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  writeNodePath(destinationRoot, nodeBinary);
}

function readAndVerifyMarker(managedRoot, version) {
  if (!VERSION_PATTERN.test(version)) fail("release version is invalid.");
  assertDirectoryWithoutSymlink(managedRoot, "managed harness");
  const markerPath = path.join(managedRoot, MARKER_NAME);
  if (!existsSync(markerPath) || lstatSync(markerPath).isSymbolicLink()) {
    fail("managed harness marker is missing or unsafe.");
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    fail("managed harness marker is malformed.");
  }
  if (
    marker?.schema_version !== INSTALL_SCHEMA ||
    marker?.product !== PRODUCT ||
    marker?.version !== version ||
    !Array.isArray(marker?.files)
  ) {
    fail("managed harness identity does not match this release.");
  }

  const verifiedPaths = new Set();
  for (const file of marker.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      fail("managed harness marker contains an invalid file entry.");
    }
    const relativePath = file.path.split("/").join(path.sep);
    assertSafeRelativePath(relativePath);
    if (verifiedPaths.has(file.path)) {
      fail("managed harness marker contains a duplicate file.");
    }
    verifiedPaths.add(file.path);
    const filePath = path.join(managedRoot, relativePath);
    if (!existsSync(filePath)) {
      fail(`managed harness is missing ${file.path}.`);
    }
    const metadata = lstatSync(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      fail(`managed harness file is unsafe at ${file.path}.`);
    }
    if (sha256(filePath) !== file.sha256) {
      fail(`managed harness integrity check failed at ${file.path}.`);
    }
  }
  for (const requiredPath of REQUIRED_MANAGED_FILES) {
    if (!verifiedPaths.has(requiredPath)) {
      fail(`managed harness marker does not bind ${requiredPath}.`);
    }
  }
  if (
    ![...verifiedPaths].some((filePath) =>
      /^config\/coinbase-spot-policy\.v\d+\.schema\.json$/.test(filePath),
    )
  ) {
    fail("managed harness marker does not bind a spot-policy schema.");
  }

  let packageMetadata;
  try {
    packageMetadata = JSON.parse(
      readFileSync(path.join(managedRoot, "package.json"), "utf8"),
    );
  } catch {
    fail("managed package metadata is malformed.");
  }
  if (
    packageMetadata?.name !== PRODUCT ||
    packageMetadata?.version !== version
  ) {
    fail("managed package metadata does not match this release.");
  }
  return marker;
}

function verifySourceMatchesManaged(managedRoot, sourceRoot, version) {
  const marker = readAndVerifyMarker(managedRoot, version);
  const sourceFiles = collectSourceFiles(sourceRoot);
  if (sourceFiles.length !== marker.files.length) {
    fail("managed version does not match the source release payload.");
  }
  for (let index = 0; index < sourceFiles.length; index += 1) {
    const source = sourceFiles[index];
    const installed = marker.files[index];
    if (
      source.path !== installed.path ||
      source.sha256 !== installed.sha256
    ) {
      fail("managed version does not match the source release payload.");
    }
  }
}

const [operation, ...argumentsList] = process.argv.slice(2);
if (operation === "create" && argumentsList.length === 4) {
  createManagedCopy(...argumentsList);
} else if (operation === "verify" && argumentsList.length === 2) {
  readAndVerifyMarker(...argumentsList);
} else if (operation === "verify-source" && argumentsList.length === 3) {
  verifySourceMatchesManaged(...argumentsList);
} else if (operation === "set-node" && argumentsList.length === 3) {
  const [managedRoot, version, nodeBinary] = argumentsList;
  readAndVerifyMarker(managedRoot, version);
  writeNodePath(managedRoot, nodeBinary);
} else {
  fail(
    "usage: install-managed-copy.mjs create <source> <destination> <version> <node> | verify <managed-root> <version> | verify-source <managed-root> <source> <version> | set-node <managed-root> <version> <node>",
  );
}
