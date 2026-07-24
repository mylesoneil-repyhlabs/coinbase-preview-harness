import test from "node:test";
import assert from "node:assert/strict";
import { sanitize } from "../src/sanitize.js";

test("sanitizer removes generic bearer values and Coinbase key identifiers", () => {
  const value = sanitize(
    "failed with Bearer opaque-secret_123 and organizations/org-1/apiKeys/key-1",
  );
  assert.equal(value.includes("opaque-secret"), false);
  assert.equal(value.includes("org-1"), false);
  assert.match(value, /Bearer \[REDACTED\]/);
  assert.match(value, /\[REDACTED_CDP_KEY_ID\]/);
});
