import test from "node:test";
import assert from "node:assert/strict";
import { renderHtmlReport } from "../src/report.js";
import { sanitize } from "../src/sanitize.js";

test("report escapes API-controlled strings and always states no order was created", () => {
  const record = {
    artifact_class: "FIXTURE",
    final_verdict: "BLOCK",
    generated_at: "2026-07-23T00:00:00.000Z",
    record_digest: "a".repeat(64),
    mandate: {
      allowed_products: ["ETH-USDC"],
      allowed_sides: ["BUY"],
      allowed_order_types: ["market"],
      max_quote_size: "20.00",
      max_order_total: "21.00",
      max_commission_total: "1.00",
    },
    proposal: {
      product_id: "<img src=x onerror=alert(1)>",
      side: "BUY",
      type: "market",
      quote_size: "20.00",
    },
    precheck: { checks: {}, failures: [{ message: "<script>alert(1)</script>" }] },
    postcheck: {},
    coinbase: {},
  };
  const html = renderHtmlReport(record);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /NO ORDER CREATED/);
});

test("sanitizer redacts secrets, JWTs, and home paths", () => {
  const output = sanitize({
    private_key: "secret",
    Authorization: "Bearer eyJabc.def.ghi",
    message: `${process.env.HOME}/credentials.json`,
  });
  assert.equal(output.private_key, "[REDACTED]");
  assert.equal(output.Authorization, "[REDACTED]");
  assert.match(output.message, /REDACTED_HOME/);
});

test("live authentication failures render as failed closed, not credential-ready", () => {
  const record = {
    artifact_class: "LIVE",
    final_verdict: "AUTHENTICATION_ERROR",
    generated_at: "2026-07-23T00:00:00.000Z",
    record_digest: "b".repeat(64),
    mandate: {
      allowed_products: ["ETH-USDC"],
      allowed_sides: ["BUY"],
      allowed_order_types: ["market"],
      max_quote_size: "20.00",
      max_order_total: "21.00",
      max_commission_total: "1.00",
    },
    proposal: {
      product_id: "ETH-USDC",
      side: "BUY",
      type: "market",
      quote_size: "20.00",
    },
    precheck: { checks: {}, failures: [] },
    postcheck: { verdict: "BLOCK", failures: [] },
    coinbase: {
      error: {
        category: "AUTHENTICATION_ERROR",
        message: "HTTP 401 unauthorized",
      },
    },
  };
  const html = renderHtmlReport(record);
  assert.match(html, /Preview failed closed/);
  assert.match(html, /HTTP 401 unauthorized/);
  assert.doesNotMatch(html, />Credential-ready</);
});
