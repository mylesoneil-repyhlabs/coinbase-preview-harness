#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenAdvisorServer } from "../src/advisor/server.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(
  ROOT,
  "docs",
  "images",
  "advisor-v1.6",
);

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

function capture(binary, args, screenshot) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    });
    const timeout = setTimeout(
      () => child.kill("SIGTERM"),
      12_000,
    );
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

const chrome = await firstExecutable([
  process.env.CHROME_BINARY,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]);
const advisor = await listenAdvisorServer({ port: 0 });
const profileRoot = await mkdtemp(
  path.join(os.tmpdir(), "delta-advisor-v1.6-chrome-"),
);

try {
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const captureSpec of [
    {
      file: "01-first-run.png",
      height: 900,
      width: 1280,
    },
  ]) {
    const screenshot = path.join(
      OUTPUT_DIR,
      captureSpec.file,
    );
    const profile = path.join(
      profileRoot,
      captureSpec.file.replace(".png", ""),
    );
    await rm(screenshot, { force: true });
    await mkdir(profile, { mode: 0o700 });
    await capture(
      chrome,
      [
        "--headless=new",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-default-browser-check",
        "--no-first-run",
        `--user-data-dir=${profile}`,
        `--window-size=${captureSpec.width},${captureSpec.height}`,
        "--force-device-scale-factor=1",
        "--virtual-time-budget=2000",
        `--screenshot=${screenshot}`,
        advisor.url,
      ],
      screenshot,
    );
  }
} finally {
  await advisor.close();
  await rm(profileRoot, { recursive: true, force: true });
}

process.stdout.write(
  [
    `Advisor screenshot written to ${OUTPUT_DIR}`,
    "Credential-free Dry run only. No Coinbase credential or network call was used.",
    "",
  ].join("\n"),
);
