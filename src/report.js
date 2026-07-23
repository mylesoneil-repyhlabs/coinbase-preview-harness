import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ROOT } from "./coinbase-cli.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function labelFor(verdict) {
  if (verdict === "ALLOW") return ["Approved for preview only", "pass"];
  if (verdict === "BLOCK") return ["Blocked", "block"];
  if (verdict === "CREDENTIALS_REQUIRED_FOR_LIVE_PREVIEW") {
    return ["Credential-ready", "pending"];
  }
  return ["Preview failed closed", "block"];
}

function checkRows(record) {
  const rows = [];
  for (const [name, passed] of Object.entries(record.precheck?.checks ?? {})) {
    rows.push({ name: name.replaceAll("_", " "), value: passed === true ? "PASS" : "FAIL" });
  }
  for (const [name, passed] of Object.entries(record.postcheck?.checks ?? {})) {
    rows.push({
      name: `preview ${name.replaceAll("_", " ")}`,
      value: passed === true ? "PASS" : passed === false ? "FAIL" : String(passed),
    });
  }
  return rows;
}

export function renderHtmlReport(record) {
  const [verdictLabel, verdictClass] = labelFor(record.final_verdict);
  const checks = checkRows(record);
  const preview = record.coinbase?.preview ?? null;
  const adapterError = record.coinbase?.error ?? null;
  const isFixture = record.artifact_class !== "LIVE";
  const failures = [...(record.precheck?.failures ?? []), ...(record.postcheck?.failures ?? [])];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>delta × Coinbase — Preview verification</title>
  <style>
    :root { --ink:#151515; --muted:#6c6a64; --line:#dedbd4; --paper:#f7f5f0; --white:#fff; --blue:#0052ff; --green:#19764c; --red:#a6342b; --amber:#9a6500; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:var(--paper); font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { max-width:1080px; margin:0 auto; padding:42px 28px 64px; }
    .eyebrow { display:flex; gap:10px; align-items:center; color:var(--muted); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--blue); }
    h1 { max-width:780px; margin:16px 0 12px; font-size:48px; line-height:1.04; letter-spacing:-.04em; }
    .lede { max-width:760px; margin:0; color:var(--muted); font-size:18px; }
    .status { margin:32px 0; padding:22px 24px; display:flex; justify-content:space-between; gap:20px; align-items:center; border:1px solid var(--line); border-radius:16px; background:var(--white); }
    .pill { display:inline-flex; padding:8px 12px; border-radius:999px; font-size:12px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
    .pill.pass { color:var(--green); background:#e7f5ee; }.pill.block { color:var(--red); background:#fbeae7; }.pill.pending { color:var(--amber); background:#fff2d6; }
    .no-order { font-weight:800; }
    .flow { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin:24px 0 34px; }
    .step { padding:15px; min-height:96px; border:1px solid var(--line); border-radius:12px; background:var(--white); }
    .step b { display:block; margin-bottom:6px; font-size:13px; }.step span { color:var(--muted); font-size:12px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    .card { padding:22px; border:1px solid var(--line); border-radius:16px; background:var(--white); }
    .card h2 { margin:0 0 16px; font-size:19px; letter-spacing:-.02em; }
    dl { display:grid; grid-template-columns:1fr auto; margin:0; gap:10px 18px; }
    dt { color:var(--muted); } dd { margin:0; font-weight:700; font-variant-numeric:tabular-nums; }
    .checks { list-style:none; margin:0; padding:0; }.checks li { display:flex; justify-content:space-between; gap:16px; padding:9px 0; border-top:1px solid #eee; }
    .checks li:first-child { border-top:0; }.checks b { font-size:12px; }
    pre { overflow:auto; margin:0; padding:16px; border-radius:10px; color:#dfe6ff; background:#111827; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .wide { grid-column:1/-1; }.note { color:var(--muted); font-size:13px; }
    .fixture { margin-top:24px; padding:12px 14px; border-left:3px solid var(--amber); background:#fff8e8; color:#6d4b00; font-size:13px; }
    footer { margin-top:28px; color:var(--muted); font-size:12px; word-break:break-all; }
    @media (max-width:760px) { h1{font-size:36px}.flow{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.wide{grid-column:auto}.status{align-items:flex-start;flex-direction:column} }
  </style>
</head>
<body>
<main>
  <div class="eyebrow"><span class="dot"></span>delta × Coinbase integration preview</div>
  <h1>Verify the mandate before an agent can act.</h1>
  <p class="lede">A closed-schema order proposal is checked locally, sent only to Coinbase Preview, checked again against estimated economics, and stopped. The harness contains no execution adapter.</p>

  <section class="status">
    <div><span class="pill ${verdictClass}">${escapeHtml(verdictLabel)}</span></div>
    <div class="no-order">NO ORDER CREATED · execution adapter absent</div>
  </section>

  <section class="flow">
    <div class="step"><b>1 · Agent proposal</b><span>Exact product, side, type, and principal.</span></div>
    <div class="step"><b>2 · Pre-check</b><span>Reject pair substitution, overspend, and extra fields.</span></div>
    <div class="step"><b>3 · Coinbase Preview</b><span>Fees and fill estimate; never an order.</span></div>
    <div class="step"><b>4 · Post-check</b><span>Recheck total debit and commission.</span></div>
    <div class="step"><b>5 · Evidence</b><span>Sanitized record with deterministic digest.</span></div>
  </section>

  <section class="grid">
    <article class="card">
      <h2>Authorized mandate</h2>
      <dl>
        <dt>Product</dt><dd>${escapeHtml(record.mandate.allowed_products.join(", "))}</dd>
        <dt>Side</dt><dd>${escapeHtml(record.mandate.allowed_sides.join(", "))}</dd>
        <dt>Order type</dt><dd>${escapeHtml(record.mandate.allowed_order_types.join(", "))}</dd>
        <dt>Principal cap</dt><dd>${escapeHtml(record.mandate.max_quote_size)} USDC</dd>
        <dt>All-in cap</dt><dd>${escapeHtml(record.mandate.max_order_total)} USDC</dd>
        <dt>Commission cap</dt><dd>${escapeHtml(record.mandate.max_commission_total)} USDC</dd>
      </dl>
    </article>

    <article class="card">
      <h2>Agent proposal</h2>
      <dl>
        <dt>Product</dt><dd>${escapeHtml(record.proposal.product_id)}</dd>
        <dt>Side</dt><dd>${escapeHtml(record.proposal.side)}</dd>
        <dt>Order type</dt><dd>${escapeHtml(record.proposal.type)}</dd>
        <dt>Principal</dt><dd>${escapeHtml(record.proposal.quote_size)} USDC</dd>
      </dl>
    </article>

    <article class="card">
      <h2>Policy evaluation</h2>
      <ul class="checks">
        ${checks.map((item) => `<li><span>${escapeHtml(item.name)}</span><b>${escapeHtml(item.value)}</b></li>`).join("") || "<li><span>Preview checks</span><b>PENDING</b></li>"}
      </ul>
      ${failures.length ? `<p class="note">${escapeHtml(failures.map((item) => item.message).join(" · "))}</p>` : ""}
    </article>

    <article class="card">
      <h2>Coinbase preview economics</h2>
      ${
        preview
          ? `<dl>
        <dt>Order total</dt><dd>${escapeHtml(preview.order_total ?? "—")}</dd>
        <dt>Commission</dt><dd>${escapeHtml(preview.commission_total ?? "—")}</dd>
        <dt>Estimated fill</dt><dd>${escapeHtml(preview.est_average_filled_price ?? "—")}</dd>
        <dt>Best bid / ask</dt><dd>${escapeHtml(preview.best_bid ?? "—")} / ${escapeHtml(preview.best_ask ?? "—")}</dd>
        <dt>Slippage</dt><dd>${escapeHtml(preview.slippage ?? "—")} (observed only)</dd>
      </dl>`
          : adapterError
            ? `<p class="note"><strong>${escapeHtml(adapterError.category ?? "PREVIEW_ERROR")}</strong><br>${escapeHtml(adapterError.message ?? "Coinbase preview did not return a valid response.")}</p>`
            : `<p class="note">The official CLI request shape is verified. Live totals populate here after a view-only credential is configured.</p>`
      }
    </article>

    <article class="card wide">
      <h2>Sanitized verification record</h2>
      <pre>${escapeHtml(JSON.stringify(record, null, 2))}</pre>
    </article>
  </section>

  ${isFixture ? `<div class="fixture"><strong>FIXTURE / PRE-CREDENTIAL BUILD.</strong> This report validates request assembly, fail-closed policy behavior, and the reporting contract. It does not claim a live Coinbase response or a production delta proof.</div>` : ""}
  <footer>Record digest: ${escapeHtml(record.record_digest)} · Generated ${escapeHtml(record.generated_at)}</footer>
</main>
</body>
</html>`;
}

export async function writeReport(record, baseName) {
  const outputDir = path.join(HARNESS_ROOT, "artifacts");
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const htmlPath = path.join(outputDir, `${baseName}.html`);
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(htmlPath, renderHtmlReport(record));
  return { jsonPath, htmlPath };
}
