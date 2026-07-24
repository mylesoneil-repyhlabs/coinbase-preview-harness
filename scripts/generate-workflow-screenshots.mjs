#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutionPlan } from "../src/plan.js";
import { simulateExecution } from "../src/simulator.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(
  ROOT,
  "output",
  "playwright",
  "delta-coinbase-guard-v1",
);
const HTML_PATH = path.join(OUTPUT_DIR, "index.html");
const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";
const stepArgumentIndex = process.argv.indexOf("--step");
const requestedStep =
  stepArgumentIndex === -1
    ? null
    : Number(process.argv[stepArgumentIndex + 1]);
if (
  requestedStep !== null &&
  (!Number.isInteger(requestedStep) ||
    requestedStep < 1 ||
    requestedStep > 7)
) {
  throw new Error("--step must be an integer from 1 through 7");
}

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(
    "Chrome was not found. Set CHROME_BINARY to a Chrome or Chromium executable.",
  );
}

function run(binary, args, screenshot) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 8_000);
    child.once("error", reject);
    child.once("exit", async (code, signal) => {
      clearTimeout(timeout);
      try {
        await access(screenshot);
        resolve();
      } catch {
        reject(
          new Error(
            `Chrome screenshot failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
          ),
        );
      }
    });
  });
}

function startServer({ html, record }) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(
      request.url ?? "/",
      "http://127.0.0.1",
    ).pathname;
    if (pathname === "/" || pathname === "/index.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
    } else if (pathname === "/record.json") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(`${JSON.stringify(record)}\n`);
    } else if (pathname === "/intent.txt") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(`${INTENT}\n`);
    } else {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const chrome = await firstExecutable([
  process.env.CHROME_BINARY,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]);
const html = await readFile(HTML_PATH, "utf8");
const plan = await createExecutionPlan(INTENT);
const record = await simulateExecution(plan, plan.policy_digest);
const server = await startServer({ html, record });
const address = server.address();
const profileDir = await mkdtemp(
  path.join(os.tmpdir(), "delta-coinbase-guard-chrome-"),
);

try {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const steps = requestedStep === null
    ? [1, 2, 3, 4, 5, 6, 7]
    : [requestedStep];
  for (const step of steps) {
    const screenshot = path.join(
      OUTPUT_DIR,
      `step-${String(step).padStart(2, "0")}-${[
        "intent",
        "policy",
        "confirm",
        "propose",
        "preview",
        "verify",
        "execute",
      ][step - 1]}.png`,
    );
    await rm(screenshot, { force: true });
    const stepProfile = path.join(profileDir, `step-${step}`);
    await mkdir(stepProfile, { mode: 0o700 });
    await run(chrome, [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-default-browser-check",
      "--no-first-run",
      `--user-data-dir=${stepProfile}`,
      "--window-size=1440,900",
      "--force-device-scale-factor=1",
      "--virtual-time-budget=1500",
      `--screenshot=${screenshot}`,
      `http://127.0.0.1:${address.port}/?step=${step}`,
    ], screenshot);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(profileDir, { recursive: true, force: true });
}

process.stdout.write(`Workflow screenshots written to ${OUTPUT_DIR}\n`);
