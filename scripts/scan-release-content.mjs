#!/usr/bin/env node
import {
  lstat,
  readdir,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;
const FORBIDDEN_FILE_NAMES = new Set([
  ".delta-coinbase-guard-node",
  ".ds_store",
  ".env",
]);
const FORBIDDEN_EXTENSIONS = new Set([
  ".jwk",
  ".key",
  ".p12",
  ".pem",
  ".pfx",
]);
const FORBIDDEN_PATH_PARTS = new Set([
  ".git",
  "__macosx",
  "artifacts",
  "credentials",
  "node_modules",
  "runtime",
  "tmp",
]);

function fail(message) {
  throw new Error(`Release content scan failed: ${message}`);
}

function isPlaceholder(value) {
  const normalized = value.trim().replace(/^["']|["']$/g, "");
  return (
    normalized.length === 0 ||
    normalized.includes("${") ||
    normalized.includes("<") ||
    /^(?:dummy|example|placeholder|redacted|replace|test|your|x{4,})\b/i.test(
      normalized,
    )
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scanText(relativePath, text) {
  const privateKeyPattern = new RegExp(
    `${escapeRegExp("-----BEGIN ")}(?:EC |OPENSSH |RSA )?${escapeRegExp(
      "PRIVATE KEY-----",
    )}`,
  );
  if (privateKeyPattern.test(text)) {
    fail(`${relativePath} contains private-key material.`);
  }

  const providerPrefixes = [
    ["gh", "p_"].join(""),
    ["github_", "pat_"].join(""),
    ["sk-", "proj-"].join(""),
    ["sk-", "ant-api"].join(""),
  ];
  for (const prefix of providerPrefixes) {
    const tokenPattern = new RegExp(
      `\\b${escapeRegExp(prefix)}[A-Za-z0-9_-]{20,}\\b`,
      "g",
    );
    if (tokenPattern.test(text)) {
      fail(`${relativePath} contains a provider token.`);
    }
  }

  const bearerPattern =
    /\bBearer\s+([A-Za-z0-9._~+/=-]{24,})\b/gi;
  for (const match of text.matchAll(bearerPattern)) {
    if (!isPlaceholder(match[1])) {
      fail(`${relativePath} contains a bearer-token-shaped value.`);
    }
  }

  const credentialAssignmentPattern =
    /\b(?:COINBASE|CDP)_(?:API_)?(?:KEY|SECRET|PRIVATE_KEY)\s*[:=]\s*([^\s,;]+)/gi;
  for (const match of text.matchAll(credentialAssignmentPattern)) {
    if (!isPlaceholder(match[1])) {
      fail(`${relativePath} contains a Coinbase credential assignment.`);
    }
  }

  const credentialJsonPattern =
    /["'](?:api[_-]?secret|private[_-]?key)["']\s*:\s*["']([^"']{16,})["']/gi;
  for (const match of text.matchAll(credentialJsonPattern)) {
    if (!isPlaceholder(match[1])) {
      fail(`${relativePath} contains a credential-shaped JSON value.`);
    }
  }
}

async function collectFiles(root, relativePath = "") {
  const target = relativePath === "" ? root : path.join(root, relativePath);
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink()) {
    fail(`${relativePath || "."} is a symlink.`);
  }
  if (metadata.isDirectory()) {
    const files = [];
    for (const entry of (await readdir(target)).sort()) {
      const child = relativePath === "" ? entry : path.join(relativePath, entry);
      files.push(...(await collectFiles(root, child)));
    }
    return files;
  }
  if (!metadata.isFile()) {
    fail(`${relativePath} is not a regular file.`);
  }
  return [{ relativePath, size: metadata.size }];
}

const input = process.argv[2];
const managedInstall = process.argv[3] === "--managed-install";
if (process.argv.length > (managedInstall ? 4 : 3)) {
  fail("unexpected command-line arguments.");
}
if (!input || !path.isAbsolute(input)) {
  fail("provide an absolute extracted release root.");
}
const inputMetadata = await lstat(input);
if (!inputMetadata.isDirectory() || inputMetadata.isSymbolicLink()) {
  fail("release root must be a real directory.");
}
const root = await realpath(input);
const rootMetadata = await lstat(root);
if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
  fail("release root must be a real directory.");
}

const files = await collectFiles(root);
let payloadBytes = 0;
for (const file of files) {
  const normalizedPath = file.relativePath.split(path.sep).join("/");
  const lowerPath = normalizedPath.toLowerCase();
  const pathParts = lowerPath.split("/");
  const basename = pathParts.at(-1);
  const extension = path.extname(basename);

  if (
    pathParts.some((part) => FORBIDDEN_PATH_PARTS.has(part)) ||
    (FORBIDDEN_FILE_NAMES.has(basename) &&
      !(managedInstall && basename === ".delta-coinbase-guard-node")) ||
    basename.startsWith(".env.") ||
    FORBIDDEN_EXTENSIONS.has(extension) ||
    /(?:^|\/)(?:api_key|cdp_key|credential)[^/]*\.json$/i.test(normalizedPath)
  ) {
    fail(`${normalizedPath} has a credential- or runtime-shaped path.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    fail(`${normalizedPath} exceeds the ${MAX_FILE_BYTES}-byte file limit.`);
  }
  payloadBytes += file.size;
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    fail(`payload exceeds the ${MAX_PAYLOAD_BYTES}-byte aggregate limit.`);
  }

  const contents = await readFile(path.join(root, file.relativePath));
  if (contents.includes(0)) {
    fail(`${normalizedPath} contains binary data; release files must be text.`);
  }
  scanText(normalizedPath, contents.toString("utf8"));
}

process.stdout.write(
  `Release content scan passed: ${files.length} text files, ${payloadBytes} bytes.\n`,
);
