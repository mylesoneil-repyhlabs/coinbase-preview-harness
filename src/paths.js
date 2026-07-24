import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const HARNESS_ROOT = path.resolve(SOURCE_DIR, "..");
export const RUNTIME_DIR = path.join(HARNESS_ROOT, "runtime");
