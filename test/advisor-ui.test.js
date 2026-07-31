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
const [html, app, styles, advisorViewModel] = await Promise.all([
  readFile(path.join(ROOT, "web", "index.html"), "utf8"),
  readFile(path.join(ROOT, "web", "app.js"), "utf8"),
  readFile(path.join(ROOT, "web", "styles.css"), "utf8"),
  readFile(
    path.join(ROOT, "src", "advisor", "view-model.js"),
    "utf8",
  ),
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
    ...app.matchAll(/["'](\/api\/[^"']+)["']/g),
  ].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(routes)].sort(),
    [
      "/api/activity",
      "/api/advisor/authorize",
      "/api/advisor/plan",
      "/api/conditional/authorize",
      "/api/conditional/cancel",
      "/api/conditional/plan",
      "/api/conditional/revise",
      "/api/conditional/revoke",
      "/api/conditional/simulate",
      "/api/connection",
      "/api/connection/connect",
      "/api/connection/disconnect",
      "/api/demo/review",
      "/api/demo/showcase",
      "/api/education/handoff",
      "/api/education/plan",
      "/api/education/revise",
      "/api/session",
      "/api/status",
    ],
  );
  assert.equal((app.match(/\bfetch\(/g) ?? []).length, 3);
  assert.match(app, /credentials:\s*["']omit["']/);
  assert.match(app, /cache:\s*["']no-store["']/);
  assert.match(app, /redirect:\s*["']error["']/);
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /["']X-Delta-Advisor["']:\s*["']1["']/);
  assert.match(
    app,
    /["']X-Delta-Advisor-Session["']:\s*capability/,
  );
  assert.match(app, /storage\s*!==\s*["']PAGE_MEMORY_ONLY["']/);
  assert.match(app, /state\.sessionCapability\s*=\s*capability/);
  assert.match(
    app,
    /capabilities\?\.conditional_plan_simulation === true/,
  );
  assert.match(
    app,
    /capabilities\?\.view_only_connection === true/,
  );
  assert.match(
    html,
    /data-view-target=["']connection["'][^>]*data-view-only-capability|data-view-only-capability[^>]*data-view-target=["']connection["']/i,
  );
  assert.match(
    html,
    /data-start=["']condition["'][^>]*data-conditional-capability|data-conditional-capability[^>]*data-start=["']condition["']/i,
  );
  assert.doesNotMatch(app, /\bconsole\.(?:log|debug|info|warn|error)\b/);
});

test("markup has keyboard and screen-reader foundations for the complete flow", () => {
  assert.match(html, /<html\s+lang=["']en["']/i);
  assert.match(html, /<a\b[^>]*href=["']#main-content["'][^>]*>Skip/i);
  assert.match(html, /<nav\b[^>]*aria-label=["']Primary["']/i);
  assert.match(html, /<main\s+id=["']main-content["']/i);
  assert.match(html, /<aside\b[^>]*aria-label=["']Delta protection["']/i);
  assert.match(html, /<form\s+id=["']advisor-form["']/i);
  assert.match(html, /<form\s+id=["']connection-form["']/i);
  assert.match(html, /<label\s+for=["']intent-input["']/i);
  assert.match(html, /<label\s+for=["']coinbase-key-name["']/i);
  assert.match(html, /<label\s+for=["']coinbase-private-key["']/i);
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
  assert.match(html, /Educational research,\s*never advice/i);
  assert.match(html, /Editable planning,\s*never auto-buy/i);
  assert.match(html, /Nothing is watching the market/i);
  assert.match(html, /credential-free dry run/i);
  assert.match(html, /permissions are exactly View only/i);
  assert.match(html, /Never enter your Coinbase\s+account password/i);
  assert.match(html, /This is not OAuth/i);
  assert.match(html, /Preview is point-in-time\s+information/i);
  assert.match(html, /not an execution or price guarantee/i);
  assert.match(html, /Create, order submission, transfers/i);
  assert.match(html, /Not a Coinbase product, integration, or\s+endorsement/i);
  assert.match(app, /This authorizes evaluation only\s*·\s*not an order/i);
  assert.match(app, /Orders off · no live confirmation available/i);
  assert.match(app, /Advice off · Orders off/);
  assert.match(app, /No trade authorized/);
  assert.match(app, /PASS · Fits mandate/);
  assert.match(app, /BLOCK · Outside mandate/);
  assert.match(app, /REVIEW · Unable to verify/);
  assert.match(app, /Observed vs allowed/);
  assert.match(app, /No order submitted · Coinbase Create remains unavailable/);
  assert.doesNotMatch(app, /Saved locally with exact integrity bindings/i);
  assert.match(app, /Generated and verified locally with exact integrity bindings/i);
  assert.match(app, /View-only verification stopped safely without fallback/i);
  assert.match(app, /Production Delta was not contacted/i);
  assert.doesNotMatch(
    app,
    /View-only point-in-time preflight plus local Delta simulation/i,
  );
});

test("locked live-readiness is projection-only, non-actionable, and mobile-safe", () => {
  assert.doesNotMatch(
    advisorViewModel,
    /DELTA_DEBUG_READINESS|console\.(?:debug|error|log)\s*\(/,
  );
  const previewStart = app.indexOf(
    "function armLiveReadinessExpiry(preview, card)",
  );
  const previewEnd = app.indexOf(
    "function renderResult",
    previewStart,
  );
  const previewSource = app.slice(previewStart, previewEnd);
  assert.ok(previewStart >= 0);
  assert.match(
    previewSource,
    /delta\.coinbase\.live_readiness_preview\.v1/,
  );
  assert.match(previewSource, /LOCKED_EXPLANATION_ONLY/);
  assert.match(previewSource, /DESIGN PREVIEW · LOCKED/);
  assert.match(previewSource, /ORDERS OFF/);
  assert.match(
    previewSource,
    /not authorization, eligibility, or readiness to trade/i,
  );
  assert.match(
    previewSource,
    /Future one-order scope/,
  );
  assert.match(
    previewSource,
    /no final challenge or execution grant exists/i,
  );
  assert.match(previewSource, /· Missing/);
  assert.match(previewSource, /preview_expires_at/);
  assert.match(previewSource, /armLiveReadinessExpiry/);
  assert.match(
    previewSource,
    /There is no final-confirmation, grant, or order route/i,
  );
  assert.doesNotMatch(
    previewSource,
    /element\(["'](?:button|a|input|textarea|select)["']/,
  );
  assert.doesNotMatch(
    previewSource,
    /\b(?:preview_id|client_order_id|credential_fingerprint|portfolio_fingerprint|create_payload|grant_id|challenge_id)\b/,
  );

  const resultStart = app.indexOf("function renderResult(");
  const resultEnd = app.indexOf(
    "async function prepareMandate",
    resultStart,
  );
  const resultSource = app.slice(resultStart, resultEnd);
  assert.match(
    resultSource,
    /state\.capabilities\?\.live_readiness_preview === true[\s\S]*?renderLiveReadinessPreview\(record\?\.live_readiness\)/,
  );
  assert.ok(
    resultSource.indexOf("no-order-banner") <
      resultSource.indexOf("renderLiveReadinessPreview"),
  );
  assert.ok(
    resultSource.indexOf("renderLiveReadinessPreview") <
      resultSource.indexOf("Technical receipt details"),
  );
  assert.match(
    resultSource,
    /Future preview · locked/,
  );
  assert.match(
    app,
    /VIEW-ONLY PREVIEW EXPIRED[\s\S]*?Preview expired · locked[\s\S]*?Start a fresh protected check/,
  );
  assert.match(
    resultSource,
    /setGuardStep\(liveReadiness \? "confirmation" : "decision"\)/,
  );
  assert.match(
    resultSource,
    /dom\.guardState\.textContent\s*=\s*liveReadiness\s*\?/,
  );
  assert.doesNotMatch(resultSource, /Live order unavailable/);

  assert.match(styles, /\.live-readiness-preview\s*\{/);
  assert.match(
    styles,
    /@media\s*\(max-width:\s*580px\)[\s\S]*?\.live-readiness-preview__facts,[\s\S]*?\.live-readiness-preview__prerequisites ul[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
});

test("educational planning begins neutral and requires an explicit one-leg handoff", () => {
  const amountInput = html.match(
    /<input\b(?=[^>]*\bid=["']education-amount["'])[^>]*>/i,
  )?.[0];
  assert.ok(amountInput);
  assert.doesNotMatch(amountInput, /\bvalue=/i);
  assert.match(amountInput, /\brequired\b/i);
  assert.match(amountInput, /placeholder=["']e\.g\. 10000["']/i);
  const selectedInputs = [
    ...html.matchAll(
      /<input\b(?=[^>]*\bdata-education-selected\b)[^>]*>/gi,
    ),
  ].map((match) => match[0]);
  assert.equal(selectedInputs.length, 3);
  for (const input of selectedInputs) {
    assert.doesNotMatch(input, /\bchecked\b/i);
  }
  const weightInputs = [
    ...html.matchAll(
      /<input\b(?=[^>]*\bdata-education-weight\b)[^>]*>/gi,
    ),
  ].map((match) => match[0]);
  const scenarioInputs = [
    ...html.matchAll(
      /<input\b(?=[^>]*\bdata-education-scenario\b)[^>]*>/gi,
    ),
  ].map((match) => match[0]);
  assert.equal(weightInputs.length, 3);
  assert.equal(scenarioInputs.length, 3);
  for (const input of [...weightInputs, ...scenarioInputs]) {
    assert.match(input, /\bvalue=["']0["']/i);
  }
  const scenarioConfirmation = html.match(
    /<input\b(?=[^>]*\bid=["']education-scenario-confirmed["'])[^>]*>/i,
  )?.[0];
  assert.ok(scenarioConfirmation);
  assert.doesNotMatch(scenarioConfirmation, /\bchecked\b/i);
  assert.match(
    html,
    /I chose these scenario assumptions, including any 0% values/i,
  );
  assert.match(
    html,
    /Load mechanical example · not a recommendation/i,
  );
  assert.match(html, /Risk and uncertainty/i);
  assert.match(html, /Digital-asset prices can be volatile/i);
  assert.match(html, /liquidity or market\s+availability can change/i);
  assert.match(html, /Scenarios are mechanical assumptions,\s+not forecasts/i);
  assert.match(html, /does not assess suitability or provide\s+individualized financial advice/i);
  assert.equal(
    (app.match(/\bloadMechanicalEducationExample\b/g) ?? [])
      .length,
    2,
    "the mechanical example must load only through its explicit button listener",
  );
  const exampleStart = app.indexOf(
    "function loadMechanicalEducationExample()",
  );
  const exampleEnd = app.indexOf(
    "function educationalInput()",
    exampleStart,
  );
  const exampleSource = app.slice(exampleStart, exampleEnd);
  assert.match(
    exampleSource,
    /dom\.educationAmount\.value = "10000"/,
  );
  assert.match(
    exampleSource,
    /dom\.educationalOutput\.replaceChildren\(\)/,
  );
  assert.match(
    exampleSource,
    /dom\.educationScenarioConfirmed\.checked = false/,
  );
  assert.match(
    app,
    /No default will be called user supplied/,
  );
  assert.match(
    app,
    /dom\.educationScenarioConfirmed\.checked = false/,
  );
  assert.match(app, /text:\s*"USER-SUPPLIED SCENARIO"/);
  assert.match(
    app,
    /\[data-education-selected\], \[data-education-scenario\]/,
  );

  const selectorStart = app.indexOf(
    "function educationLegSelector(saved)",
  );
  const selectorEnd = app.indexOf(
    "function renderEducationalPlan",
    selectorStart,
  );
  const selectorSource = app.slice(selectorStart, selectorEnd);
  assert.doesNotMatch(selectorSource, /radio\.checked\s*=/);
  assert.match(
    selectorSource,
    /Select exactly one allocation leg and choose Buy or Sell before creating a draft/,
  );
  assert.match(selectorSource, /for \(const side of \["BUY", "SELL"\]\)/);
  assert.doesNotMatch(selectorSource, /\.checked\s*=\s*true/);
  assert.match(selectorSource, /reveal\(feedback,\s*\{\s*focus:\s*true\s*\}\)/);
  assert.ok(
    selectorSource.indexOf("if (!legId || !side)") <
      selectorSource.indexOf(
        "void createEducationHandoff(",
      ),
  );

  const handoffStart = app.indexOf(
    "async function createEducationHandoff(",
  );
  const handoffEnd = app.indexOf(
    "function activityEntries",
    handoffStart,
  );
  const handoffSource = app.slice(handoffStart, handoffEnd);
  assert.match(handoffSource, /["']\/api\/education\/handoff["']/);
  assert.match(
    handoffSource,
    /body:\s*\{[\s\S]*?plan_id:[\s\S]*?revision:[\s\S]*?leg_id:\s*legId,[\s\S]*?side,/,
  );
  assert.doesNotMatch(
    handoffSource,
    /\/api\/advisor\/(?:plan|authorize)|\/api\/demo\/showcase/,
  );

  const renderStart = app.indexOf(
    "function renderEducationHandoff(saved)",
  );
  const renderEnd = app.indexOf(
    "async function saveEducational",
    renderStart,
  );
  const renderSource = app.slice(renderStart, renderEnd);
  assert.doesNotMatch(renderSource, /\brequestJson\(/);
  assert.match(renderSource, /Edit in protected Advisor/);
  assert.match(renderSource, /dom\.intentInput\.value = saved\.advisor_prefill/);
  assert.match(renderSource, /Editable Guard defaults/);
  assert.match(renderSource, /DRAFT CREATED · NOT AUTHORIZED/);

  assert.match(
    app,
    /Locally curated summary of primary source unavailable\./,
  );
  assert.match(app, /Open canonical primary source/);
  assert.match(app, /Market fact · \$\{product\.provenance/);
  assert.match(
    app,
    /education\?\.provenance\?\.label/,
  );
  assert.match(app, /Catalog reviewed \$\{formatConnectionTime/);
  assert.match(app, /content \$\{education\.content_digest\.slice/);
  assert.doesNotMatch(
    app,
    /Locally curated primary-source summary unavailable/,
  );
  assert.match(
    app,
    /I can’t choose an asset for you, rank tokens, or assess suitability/,
  );
  assert.match(
    app,
    /capabilities\?\.educational_research === true[\s\S]*?capabilities\?\.portfolio_planning === true/,
  );
  assert.match(
    html,
    /data-start=["']research["'][^>]*data-education-capability|data-education-capability[^>]*data-start=["']research["']/i,
  );
  assert.match(
    html,
    /data-start=["']portfolio["'][^>]*data-education-capability|data-education-capability[^>]*data-start=["']portfolio["']/i,
  );
  assert.match(
    styles,
    /\.inline-example-button\s*\{[\s\S]*?min-height:\s*44px/,
  );
  for (const asset of ["BTC", "ETH", "SOL"]) {
    assert.match(
      html,
      new RegExp(`${asset} allocation weight`, "i"),
    );
    assert.match(
      html,
      new RegExp(`${asset} scenario assumption`, "i"),
    );
  }
  const educationStart = html.indexOf(
    'id="educational-workspace"',
  );
  const educationEnd = html.indexOf(
    'id="educational-output"',
    educationStart,
  );
  const educationMarkup = html.slice(
    educationStart,
    educationEnd,
  );
  for (const asset of ["BTC", "ETH", "SOL"]) {
    assert.ok(
      educationMarkup.indexOf(asset) <
        educationMarkup.indexOf(
          `${asset} allocation weight`,
        ),
      `${asset} selection must precede its weight control in keyboard order`,
    );
    assert.ok(
      educationMarkup.indexOf(
        `${asset} allocation weight`,
      ) <
        educationMarkup.indexOf(
          `${asset} scenario assumption`,
        ),
      `${asset} weight must precede its scenario control in keyboard order`,
    );
  }
});

test("credential onboarding is session-only, explicit, and clears both inputs before network use", () => {
  const keyInput = html.match(
    /<input\b(?=[^>]*\bid=["']coinbase-key-name["'])[^>]*>/i,
  )?.[0];
  const privateKeyInput = html.match(
    /<textarea\b(?=[^>]*\bid=["']coinbase-private-key["'])[^>]*>/i,
  )?.[0];
  assert.ok(keyInput);
  assert.ok(privateKeyInput);
  assert.match(keyInput, /\bautocomplete=["']off["']/i);
  assert.match(keyInput, /\bspellcheck=["']false["']/i);
  assert.match(privateKeyInput, /\bautocomplete=["']new-password["']/i);
  assert.match(privateKeyInput, /\bspellcheck=["']false["']/i);
  assert.match(html, /cleared from these fields immediately/i);
  assert.match(html, /never written to\s+browser storage or Guard history/i);
  assert.match(html, /Disconnect and erase session key/i);
  assert.match(html, /15-minute idle\s*·\s*60-minute maximum/i);

  const connectStart = app.indexOf("async function connectViewOnly(event)");
  const connectEnd = app.indexOf(
    "async function disconnectViewOnly",
    connectStart,
  );
  const connectSource = app.slice(connectStart, connectEnd);
  const keyClear = connectSource.indexOf(
    'dom.coinbaseKeyName.value = ""',
  );
  const privateKeyClear = connectSource.indexOf(
    'dom.coinbasePrivateKey.value = ""',
  );
  const request = connectSource.indexOf(
    'requestJson("/api/connection/connect"',
  );
  assert.ok(keyClear >= 0);
  assert.ok(privateKeyClear > keyClear);
  assert.ok(request > privateKeyClear);
  assert.match(
    connectSource,
    /body:\s*\{\s*name,\s*privateKey\s*\}/,
  );
  assert.match(connectSource, /if \(state\.pending\)/);
  assert.match(connectSource, /fields have been cleared; nothing was stored/i);
  assert.match(app, /safeProviderMessage/);
});

test("each mandate makes Dry run versus View-only preflight an explicit bound choice", () => {
  const renderStart = app.indexOf("function renderMandate(plan)");
  const renderEnd = app.indexOf("function firstIssue", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);
  assert.match(renderSource, /Choose one protected check/);
  assert.match(renderSource, /value:\s*"dry_run"/);
  assert.match(renderSource, /value:\s*"view_only_preflight"/);
  assert.match(renderSource, /checked:\s*""/);
  assert.match(renderSource, /Preview is not an execution or price guarantee/);
  assert.match(
    renderSource,
    /authorizePlan\(planId,\s*authorizeButton,\s*selectedMode\(\)\)/,
  );

  const authorizeStart = app.indexOf("async function authorizePlan(");
  const authorizeEnd = app.indexOf("function attemptOutcome", authorizeStart);
  const authorizeSource = app.slice(authorizeStart, authorizeEnd);
  assert.match(
    authorizeSource,
    /\["dry_run",\s*"view_only_preflight"\]\.includes\(mode\)/,
  );
  assert.match(
    authorizeSource,
    /state\.connection\?\.connected !== true/,
  );
  assert.match(authorizeSource, /will not fall back automatically/i);
  assert.match(
    authorizeSource,
    /body:\s*\{\s*plan_id:\s*planId,\s*mode\s*\}/,
  );
});

test("frontend consumes normalized clarification and unsupported messages", () => {
  const normalizedMessageReads =
    app.match(/\bitem\?\.message\b/g) ?? [];
  assert.ok(
    normalizedMessageReads.length >= 2,
    "clarification and unsupported renderers must show the server DTO's precise message",
  );
});

test("activity merges and sorts session events with Guard history instead of hiding either stream", () => {
  const start = app.indexOf("function activityEntries(payload)");
  const end = app.indexOf("function activityMandate", start);
  const source = app.slice(start, end);
  assert.match(source, /payload\?\.session_activity/);
  assert.match(source, /payload\?\.guard_history/);
  assert.match(
    source,
    /\[\.\.\.sessionActivity,\s*\.\.\.guardHistory\]/,
  );
  assert.match(source, /activity_stream:\s*"SESSION_ACTIVITY"/);
  assert.match(source, /activity_stream:\s*"GUARD_HISTORY"/);
  assert.match(source, /\.sort\(/);
  assert.doesNotMatch(
    source,
    /if \(Array\.isArray\(payload\?\.guard_history\)[\s\S]*?return payload\.guard_history/,
  );
  assert.match(app, /Guard history · View-only preflight/);
  assert.match(app, /Guard history · Simulated dry run/);
});

test("mandate authorization is bound to the rendered plan and stale cards lock", () => {
  const renderStart = app.indexOf("function renderMandate(plan)");
  const renderEnd = app.indexOf("function firstIssue", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);
  assert.match(renderSource, /const planId = plan\?\.plan_id/);
  assert.match(renderSource, /"data-plan-id": planId/);
  assert.match(
    renderSource,
    /authorizePlan\(planId,\s*authorizeButton,\s*selectedMode\(\)\)/,
  );

  const authorizeStart = app.indexOf(
    "async function authorizePlan(planId, button, mode = \"dry_run\")",
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
  assert.match(
    authorizeSource,
    /body:\s*\{\s*plan_id:\s*planId,\s*mode\s*\}/,
  );
  assert.match(app, /invalidateMandateAuthorizations\("Superseded"\)/);
  assert.match(app, /button\.dataset\.guardLocked = "true"/);
  assert.match(app, /artifact\?\.classList\.add\("is-stale"\)/);
  assert.match(app, /querySelectorAll\("\[data-mandate-mode\]"\)/);
  assert.match(app, /input\.dataset\.guardLocked = "true"/);
  assert.match(
    app,
    /wasDisabled \|\| control\.dataset\.guardLocked === "true"/,
  );
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
  assert.match(
    app,
    /void cancelPendingOperation\(cancel\)/,
  );
  assert.match(app, /["']\/api\/conditional\/cancel["']/);
  assert.match(app, /USER_STOPPED_WAITING/);
  assert.match(app, /SERVER_CANCELLED/);
  assert.match(app, /COMPLETED_BEFORE_CANCEL/);
  assert.doesNotMatch(app, /USER_CANCELLED/);
  assert.match(
    app,
    /Stopping browser wait alone does not cancel server work|Stop waiting only closes the browser request/,
  );
});

test("conditional plan UI keeps authorization, evidence, and execution boundaries separate", () => {
  assert.match(html, /id=["']conditional-form["']/);
  for (const label of ["Action", "If", "Limits", "Until"]) {
    assert.match(
      html,
      new RegExp(`<legend>${label}</legend>`, "i"),
    );
  }
  assert.match(html, /Save &amp; simulate/i);
  assert.match(html, /Simulation only/i);
  assert.match(html, /Nothing is watching/i);
  assert.match(html, /Orders off/i);
  assert.match(app, /Labeled fixture/);
  assert.match(app, /One View-only check/);
  assert.match(app, /No fixture fallback/);
  assert.match(app, /Condition not met/);
  assert.match(app, /Agent exceeds limit/);
  assert.match(app, /Exact proposal fits/);
  assert.match(app, /Authorize one simulation check/);
  assert.match(app, /WOULD_TRIGGER_SIMULATION/);
  assert.match(app, /Receipt verified locally/);
  assert.match(app, /EXECUTION LOCKED/);
  assert.match(app, /EXACT SIMULATED PROPOSAL/);
  assert.match(app, /Observed \$\{reference\}/);
  assert.match(app, /Raw slippage \$\{priceBoundary\}/);
  assert.match(app, /Effective maximum price/);
  assert.match(app, /Effective minimum price/);
  assert.match(
    app,
    /tighter of the absolute condition and slippage/,
  );
  assert.match(app, /SERVER CANCELLED|CANCELLED ON SERVER/);
  assert.match(
    app,
    /Check completed before cancellation reached the server/,
  );
  assert.match(app, /Revoke this revision/);
  assert.match(app, /data-safety-action/);
  assert.match(
    app,
    /control\.dataset\.safetyAction === "true"/,
  );
  assert.match(app, /requestSafetyJson/);
  assert.doesNotMatch(
    `${html}\n${app}`,
    />\s*(?:Active|Watching|Triggered|Submitted)\s*</i,
  );
});

test("conditional evidence provenance never labels an unavailable View-only check as observed", () => {
  const renderStart = app.indexOf(
    "function renderConditionalResult",
  );
  const renderEnd = app.indexOf(
    "async function saveConditional",
    renderStart,
  );
  const source = app.slice(renderStart, renderEnd);
  assert.match(
    source,
    /evidence\?\.unavailable === true/,
  );
  assert.match(
    source,
    /Coinbase unavailable · unable to verify/,
  );
  assert.match(source, /Coinbase observed · View only/);
  assert.match(source, /Generated fixture · not Coinbase/);
  assert.ok(
    source.indexOf("Coinbase unavailable · unable to verify") <
      source.indexOf("Coinbase observed · View only"),
  );
  assert.match(
    app,
    /function conditionalEvidencePresentation\(evidence\)/,
  );
  assert.match(
    app,
    /Evidence source unavailable · unable to verify/,
  );
});

test("conditional expiry is browser-local, duration-based, and DST-explicit", () => {
  const timezone = html.match(
    /<input\b(?=[^>]*\bid=["']conditional-timezone["'])[^>]*>/i,
  )?.[0];
  assert.ok(timezone);
  assert.match(timezone, /\breadonly\b/i);
  assert.doesNotMatch(html, /type=["']datetime-local["']/i);
  for (const seconds of ["3600", "86400", "604800"]) {
    assert.match(
      html,
      new RegExp(`<option value=["']${seconds}["']`),
    );
  }
  assert.match(
    app,
    /\[3_600,\s*86_400,\s*604_800\]\.includes\(expirySeconds\)/,
  );
  assert.match(
    app,
    /Date\.now\(\) \+ expirySeconds \* 1_000/,
  );
  assert.match(
    app,
    /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/,
  );
  assert.match(app, /timeZoneName:\s*"short"/);
  assert.match(app, /local time · \$\{template\.timezone\}/);
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
  assert.doesNotMatch(
    styles,
    /html\s*\{[\s\S]*?min-width:\s*320px/,
  );
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
  assert.match(
    styles,
    /\.mandate-ribbon,[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(styles, /\.feature-card__topline\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(
    styles,
    /\.premium-badge,[\s\S]*?white-space:\s*normal/,
  );
});
