#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "runtime",
  "tmp",
]);

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(entryPath)));
    } else if (entry.isFile() && /\.md(?:own)?$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function localTargets(markdown) {
  const targets = [];
  const prose = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
  const markdownLink = /!?\[[^\]]*]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
  const htmlLink = /<(?:a|img)\b[^>]*?\b(?:href|src)=["']([^"']+)["'][^>]*>/gi;

  for (const match of prose.matchAll(markdownLink)) {
    targets.push(match[1].replace(/^<|>$/g, ""));
  }
  for (const match of prose.matchAll(htmlLink)) {
    targets.push(match[1]);
  }
  return targets;
}

function isRemoteOrDocumentAnchor(target) {
  return (
    target.startsWith("#") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

const failures = [];
for (const markdownPath of await markdownFiles(ROOT)) {
  const markdown = await readFile(markdownPath, "utf8");
  for (const target of localTargets(markdown)) {
    if (isRemoteOrDocumentAnchor(target)) {
      continue;
    }
    const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
    if (!withoutFragment) {
      continue;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(withoutFragment);
    } catch {
      failures.push({
        source: path.relative(ROOT, markdownPath),
        target,
        reason: "invalid percent encoding",
      });
      continue;
    }
    const resolved = decoded.startsWith("/")
      ? path.join(ROOT, decoded)
      : path.resolve(path.dirname(markdownPath), decoded);
    const relativeTarget = path.relative(ROOT, resolved);
    if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      failures.push({
        source: path.relative(ROOT, markdownPath),
        target,
        reason: "escapes repository root",
      });
      continue;
    }
    if (!(await exists(resolved))) {
      failures.push({
        source: path.relative(ROOT, markdownPath),
        target,
        reason: "missing",
      });
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(
      `${failure.source}: ${failure.target} (${failure.reason})\n`,
    );
  }
  process.stderr.write(`Found ${failures.length} broken local link(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Local documentation links are valid.\n");
}
