import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const HARNESS_ROOT = path.resolve(SOURCE_DIR, "..");
export const RUNTIME_DIR = path.join(HARNESS_ROOT, "runtime");
export const STATE_DIR = path.resolve(
  process.env.DELTA_COINBASE_GUARD_STATE_DIR ??
    path.join(
      process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
      "delta",
      "coinbase-guard",
    ),
);
