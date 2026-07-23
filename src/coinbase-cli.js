import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sanitize } from "./sanitize.js";

const execFileAsync = promisify(execFile);
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS_ROOT = path.resolve(SOURCE_DIR, "..");
export const CLI_ENTRY = path.join(
  HARNESS_ROOT,
  "node_modules",
  "@coinbase",
  "coinbase-cli",
  "dist",
  "index.js",
);
export const CONFIG_DIR = path.join(HARNESS_ROOT, "runtime", "coinbase-cli");
export const ENVIRONMENT_NAME = "live-delta-preview";
export const CLI_VERSION = "0.0.4";

export function buildChildEnvironment() {
  return {
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "",
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    COINBASE_CONFIG_DIR: CONFIG_DIR,
    COINBASE_ENV: ENVIRONMENT_NAME,
    COINBASE_NO_HISTORY: "1",
    COINBASE_NO_UPDATE_CHECK: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
}

export function buildPreviewArgs(order, { dryRun = false } = {}) {
  const args = [
    "orders",
    "preview",
    `product_id=${order.product_id}`,
    `side=${order.side}`,
    `type=${order.type}`,
    `quote_size=${order.quote_size}`,
  ];
  if (dryRun) args.push("--dry-run");
  return args;
}

export async function runPinnedCli(args, { timeout = 15_000 } = {}) {
  await access(CLI_ENTRY);
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });

  try {
    const result = await execFileAsync(process.execPath, [CLI_ENTRY, ...args], {
      cwd: HARNESS_ROOT,
      env: buildChildEnvironment(),
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout,
      windowsHide: true,
      shell: false,
    });
    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    const details = sanitize({
      message: error.message,
      code: error.code,
      signal: error.signal,
      killed: error.killed,
      stdout: error.stdout,
      stderr: error.stderr,
    });
    const wrapped = new Error(details.stderr || details.message || "Coinbase CLI failed");
    wrapped.details = details;
    throw wrapped;
  }
}

export async function getCliVersion() {
  const result = await runPinnedCli(["--version"]);
  return result.stdout;
}

export async function getPreviewTemplate() {
  const result = await runPinnedCli(["orders", "preview", "--template"]);
  return JSON.parse(result.stdout);
}

export function parseDryRun(stdout, stderr = "") {
  const marker = "would execute orders_preview";
  if (!stderr.startsWith(marker) && !stdout.startsWith(marker)) {
    throw new Error("Unexpected Coinbase dry-run output");
  }
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) throw new Error("Coinbase dry-run did not emit a request body");
  return JSON.parse(stdout.slice(jsonStart));
}

export async function dryRunPreview(order) {
  const args = buildPreviewArgs(order, { dryRun: true });
  const result = await runPinnedCli(args);
  return {
    action: "orders_preview",
    argv: args,
    request: parseDryRun(result.stdout, result.stderr),
    contacted_coinbase: false,
  };
}

export async function livePreview(order) {
  const args = buildPreviewArgs(order);
  const result = await runPinnedCli(args, { timeout: 30_000 });
  const preview = JSON.parse(result.stdout);
  return {
    action: "orders_preview",
    argv: args,
    response: preview,
    contacted_coinbase: true,
  };
}
