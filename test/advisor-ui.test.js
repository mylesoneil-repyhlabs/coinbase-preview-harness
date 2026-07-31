import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileDeterministicIntent } from "../src/intent-compiler.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const [html, app, styles] = await Promise.all([
  readFile(path.join(ROOT, "web", "index.html"), "utf8"),
  readFile(path.join(ROOT, "web", "app.js"), "utf8"),
  readFile(path.join(ROOT, "web", "styles.css"), "utf8"),
]);

function defaultIntentFromHtml() {
  const match = html.match(
    /<textarea\b[^>]*\bid=["']intent-input["'][^>]*>([\s\S]*?)<\/textarea>/i,
  );
  assert.ok(match, "the advisor must ship a visible starter intent");
  return match[1].trim();
}

function sampleIntentFromApp() {
  const match = app.match(
    /const\s+SAMPLE_INTENT\s*=\s*["']([\s\S]*?)["'];/,
  );
  assert.ok(match, "the quick-start intent must remain explicit and reviewable");
  return match[1];
}

test("the composer starts empty and the explicit quick-start compiles safely", () => {
  const starter = defaultIntentFromHtml();
  const quickStart = sampleIntentFromApp();
  assert.equal(starter, "");
  assert.match(html, /Try a protected ETH dry run/i);
  assert.match(html, /data-start=["']trade["']/i);

  const compilation = compileDeterministicIntent(quickStart);
  assert.equal(compilation.status, "READY_FOR_CONFIRMATION");
  assert.equal(compilation.policy.product_id, "ETH-USDC");
  assert.equal(compilation.policy.side, "BUY");
  assert.equal(compilation.policy.size.operator, "MAX");
  assert.equal(compilation.policy.size.value, "3000");
  assert.equal(compilation.policy.market_condition.reference, "BEST_ASK");
  assert.equal(compilation.policy.market_condition.value, "3000");
  assert.equal(compilation.policy.limits.max_slippage_bps, 35);
  assert.equal(compilation.policy.limits.max_commission.value, "15");
  assert.equal(compilation.policy.limits.settlement.value, "3015");
  assert.equal(compilation.policy.usage.max_executions, 1);
});

test("static frontend contains no browser persistence, unsafe HTML sinks, or remote assets", () => {
  for (const [name, source] of [
    ["index.html", html],
    ["app.js", app],
    ["styles.css", styles],
  ]) {
    assert.doesNotMatch(
      source,
      /\b(?:localStorage|sessionStorage|indexedDB|caches\.open|serviceWorker)\b/,
      `${name} must not persist advisor or credential data in browser storage`,
    );
    assert.doesNotMatch(
      source,
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b|new\s+Function\b/,
      `${name} must not introduce an unsafe DOM/code sink`,
    );
    assert.doesNotMatch(
      source,
      /https?:\/\/[A-Za-z0-9]/,
      `${name} must not depend on third-party assets, analytics, or endpoints`,
    );
  }

  assert.doesNotMatch(
    html,
    /\b(?:src|href)\s*=\s*["']\/\/[A-Za-z0-9]/i,
  );
  assert.doesNotMatch(styles, /url\(\s*["']?\/\/[A-Za-z0-9]/i);
  assert.doesNotMatch(html, /<iframe\b|<object\b|<embed\b/i);
  assert.doesNotMatch(styles, /@import\b/i);
  assert.doesNotMatch(app, /\b(?:WebSocket|EventSource|XMLHttpRequest)\b/);
  assert.match(app, /\btextContent\b/);
  assert.match(app, /\breplaceChildren\(/);
});

test("browser code talks only to the narrow same-origin advisor API", () => {
  const routes = [
    ...app.matchAll(/requestJson\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(routes)].sort(),
    [
      "/api/activity",
      "/api/advisor/authorize",
      "/api/advisor/plan",
      "/api/demo/review",
      "/api/demo/showcase",
      "/api/status",
    ],
  );
  assert.equal((app.match(/\bfetch\(/g) ?? []).length, 1);
  assert.match(app, /credentials:\s*["']same-origin["']/);
  assert.match(app, /cache:\s*["']no-store["']/);
  assert.match(app, /redirect:\s*["']error["']/);
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /["']X-Delta-Advisor["']:\s*["']1["']/);
});

test("markup has keyboard and screen-reader foundations for the complete flow", () => {
  assert.match(html, /<html\s+lang=["']en["']/i);
  assert.match(html, /<a\b[^>]*href=["']#main-content["'][^>]*>Skip/i);
  assert.match(html, /<nav\b[^>]*aria-label=["']Primary["']/i);
  assert.match(html, /<main\s+id=["']main-content["']/i);
  assert.match(html, /<aside\b[^>]*aria-label=["']Delta protection["']/i);
  assert.match(html, /<form\s+id=["']advisor-form["']/i);
  assert.match(html, /<label\s+for=["']intent-input["']/i);
  assert.match(
    html,
    /<textarea\b(?=[^>]*\bid=["']intent-input["'])(?=[^>]*\bname=["']intent["'])(?=[^>]*\brequired\b)[^>]*>/i,
  );
  assert.match(
    html,
    /id=["']conversation["'][^>]*aria-live=["']polite["']/i,
  );
  assert.match(html, /id=["']announcer["'][^>]*aria-live=["']assertive["']/i);

  for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
    assert.match(
      match[1],
      /\btype=["'](?:button|submit)["']/i,
      `every button must declare its type: ${match[0]}`,
    );
  }

  assert.match(app, /aria-busy/);
  assert.doesNotMatch(app, /ArrowLeft|ArrowRight/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /@media\s*\(max-width:\s*780px\)/);
  assert.match(styles, /min-height:\s*44px/);
});

test("default copy makes the current and future safety boundaries unmistakable", () => {
  assert.match(html, /No order can be sent/i);
  assert.match(html, /Coinbase is not contacted/i);
  assert.match(html, /has no Coinbase Create route/i);
  assert.match(html, /Simulation is the default/i);
  assert.match(html, /Plan a future condition/i);
  assert.match(html, />Preview</i);
  assert.match(html, /No monitoring or autonomous trade/i);
  assert.ok((html.match(/Coming soon/gi) ?? []).length >= 2);
  assert.match(html, /Educational research,\s*never advice/i);
  assert.match(html, /Editable planning,\s*never auto-buy/i);
  assert.match(html, /Nothing is watching the market/i);
  assert.match(html, /View-only connection\s+arrives.+next sprint/is);
  assert.match(html, /Do not paste a Coinbase password, key, private key, or JWT/i);
  assert.match(html, /Not a Coinbase product, integration, or\s+endorsement/i);
  assert.match(app, /This authorizes evaluation only\s*·\s*not an order/i);
  assert.match(app, /Live order unavailable/i);
  assert.match(app, /no individualized advice\s*·\s*no order/i);
  assert.match(app, /PASS · Fits mandate/);
  assert.match(app, /BLOCK · Outside mandate/);
  assert.match(app, /REVIEW · Unable to verify/);
  assert.match(app, /Observed vs allowed/);
  assert.match(app, /No order submitted · Coinbase Create remains unavailable/);
  assert.doesNotMatch(app, /Saved locally with exact integrity bindings/i);
  assert.match(app, /Generated and verified locally with exact integrity bindings/i);
});

test("frontend consumes normalized clarification and unsupported messages", () => {
  const normalizedMessageReads =
    app.match(/\bitem\?\.message\b/g) ?? [];
  assert.ok(
    normalizedMessageReads.length >= 2,
    "clarification and unsupported renderers must show the server DTO's precise message",
  );
});

test("mandate authorization is bound to the rendered plan and stale cards lock", () => {
  const renderStart = app.indexOf("function renderMandate(plan)");
  const renderEnd = app.indexOf("function firstIssue", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);
  assert.match(renderSource, /const planId = plan\?\.plan_id/);
  assert.match(renderSource, /"data-plan-id": planId/);
  assert.match(
    renderSource,
    /authorizePlan\(planId,\s*authorizeButton\)/,
  );

  const authorizeStart = app.indexOf(
    "async function authorizePlan(planId, button)",
  );
  const authorizeEnd = app.indexOf(
    "function attemptOutcome",
    authorizeStart,
  );
  const authorizeSource = app.slice(authorizeStart, authorizeEnd);
  assert.match(
    authorizeSource,
    /state\.authorizeButtons\.get\(planId\) !== button/,
  );
  assert.match(authorizeSource, /body:\s*\{\s*plan_id:\s*planId\s*\}/);
  assert.match(app, /invalidateMandateAuthorizations\("Superseded"\)/);
  assert.match(app, /button\.dataset\.guardLocked = "true"/);
});

test("pending guard runs before mandate mutation and locks conflicting controls", () => {
  const prepareStart = app.indexOf("async function prepareMandate(event)");
  const prepareEnd = app.indexOf(
    "async function authorizePlan",
    prepareStart,
  );
  const prepareSource = app.slice(prepareStart, prepareEnd);
  const pendingGuard = prepareSource.indexOf("if (state.pending)");
  const invalidation = prepareSource.indexOf(
    'invalidateMandateAuthorizations("Superseded")',
  );
  assert.ok(pendingGuard >= 0);
  assert.ok(invalidation > pendingGuard);
  assert.match(
    prepareSource,
    /current mandate was not changed/,
  );
  assert.match(app, /setActionControlsDisabled\(pending\)/);
  assert.match(
    html,
    /data-view-target=["']advisor["'][\s\S]*?data-action-control=["']guard["']/,
  );
  assert.match(app, /state\.pendingRegion\?\.setAttribute\("aria-busy"/);
  assert.match(app, /5_000/);
  assert.match(html, /data-cancel-pending/);
  assert.match(app, /abort\("USER_CANCELLED"\)/);
});

test("decision rendering fails closed without one exact verified outcome", () => {
  const outcomeStart = app.indexOf("function resultOutcome(record)");
  const outcomeEnd = app.indexOf("function resultReason", outcomeStart);
  const outcomeSource = app.slice(outcomeStart, outcomeEnd);
  assert.match(outcomeSource, /\.trim\(\)\.toUpperCase\(\)/);
  assert.match(
    outcomeSource,
    /record\?\.receipt\?\.verified !== true/,
  );
  assert.match(
    outcomeSource,
    /\["PASS", "BLOCK", "REVIEW"\]\.includes\(decision\)/,
  );
  assert.doesNotMatch(outcomeSource, /includes\(["']pass/i);
});

test("mobile contract preserves the safety strip and compact composer", () => {
  assert.match(styles, /@media\s*\(max-width:\s*360px\)/);
  assert.match(
    styles,
    /\.trust-strip\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/,
  );
  assert.match(
    styles,
    /\.composer textarea\s*\{[\s\S]*?height:\s*46px/,
  );
  assert.match(
    styles,
    /\.composer textarea:focus,[\s\S]*?height:\s*126px/,
  );
  assert.match(styles, /\.comparison\s*\{[\s\S]*?overflow-x:\s*auto/);
});
