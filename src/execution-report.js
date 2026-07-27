import { chmod, lstat, mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { HARNESS_ROOT } from "./paths.js";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderExecutionHtml(record) {
  const simulated = record.artifact_class === "SIMULATED";
  const submitted = record.execution?.order_submitted === true;
  const submissionUnknown = record.execution?.order_submitted == null;
  const probePassed = record.status === "PREVIEW_PROBE_PASS";
  const completed = ["FILLED", "PARTIAL_FILL", "NO_FILL"].includes(record.status);
  const statusClass = completed || probePassed
    ? "pass"
    : submitted
      ? "warn"
      : "block";
  const statusLabel =
    simulated && record.status === "FILLED"
      ? "SIMULATED FULL-FILL PASS"
      : record.status;
  const policy = record.policy ?? {};
  const proposal = record.proposal?.action ?? {};
  const preview = record.preview?.evidence ?? {};
  const execution = record.execution ?? {};
  const reconciliation = record.reconciliation ?? {};
  const actual = reconciliation.order ?? {};
  const retry = record.demo?.bounded_retry ?? null;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>delta × Coinbase — Gated execution record</title>
  <style>
    :root{--ink:#171717;--muted:#686761;--line:#ddd9d0;--paper:#f6f3ed;--white:#fff;--blue:#0052ff;--green:#176a46;--red:#a12e28;--amber:#8c5b00}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1120px;margin:auto;padding:42px 28px 64px}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--blue)}
    h1{max-width:820px;margin:14px 0 10px;font-size:48px;line-height:1.03;letter-spacing:-.045em}.lede{max-width:800px;color:var(--muted);font-size:18px}
    .status{display:flex;justify-content:space-between;gap:18px;align-items:center;margin:30px 0;padding:22px;border:1px solid var(--line);border-radius:16px;background:var(--white)}
    .pill{padding:8px 12px;border-radius:999px;font-size:12px;font-weight:900;letter-spacing:.05em}.pass{color:var(--green);background:#e8f5ee}.warn{color:var(--amber);background:#fff6df}.block{color:var(--red);background:#fbe9e7}
    .flow{display:grid;grid-template-columns:repeat(7,1fr);gap:9px;margin:24px 0}.step,.card{border:1px solid var(--line);border-radius:14px;background:var(--white)}
    .step{min-height:105px;padding:14px}.step b{display:block;margin-bottom:6px;font-size:12px}.step span{font-size:12px;color:var(--muted)}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}.card{padding:21px}.card h2{margin:0 0 14px;font-size:18px}
    dl{display:grid;grid-template-columns:1fr auto;gap:9px 16px;margin:0}dt{color:var(--muted)}dd{margin:0;font-weight:750;font-variant-numeric:tabular-nums}
    .wide{grid-column:1/-1}details summary{cursor:pointer;font-weight:800}pre{overflow:auto;margin:14px 0 0;padding:16px;border-radius:10px;background:#101827;color:#e7ecff;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
    .simulation-banner{padding:14px 24px;background:#7d210e;color:#fff;text-align:center;font-size:14px;font-weight:900;letter-spacing:.08em}
    .notice{margin-top:22px;padding:13px 15px;border-left:4px solid var(--amber);background:#fff6df;color:#694600;font-size:13px}footer{margin-top:22px;color:var(--muted);font-size:12px;word-break:break-all}
    @media(max-width:820px){h1{font-size:36px}.flow{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.wide{grid-column:auto}.status{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
${simulated ? '<div class="simulation-banner" role="alert">SIMULATION_ONLY · NO REAL ORDER · COINBASE AND PRODUCTION DELTA NOT CONTACTED</div>' : ""}
<main>
  <div class="eyebrow">delta × Coinbase · mandate-gated execution</div>
  <h1>From human intent to one authorized action.</h1>
  <p class="lede">Natural language is compiled into a reviewable policy; a human confirms its digest; an agent proposes one bounded order; Coinbase supplies fresh evidence; delta evaluates it and an independent verifier confirms the proof; only then can the executor submit the exact bytes.</p>
  <section class="status">
    <span class="pill ${statusClass}">${escapeHtml(statusLabel)}</span>
    <strong>${simulated ? "NO REAL ORDER CREATED · SIMULATED RESPONSE" : probePassed ? "COINBASE PREVIEW VERIFIED · CREATE NOT CALLED" : completed ? "COINBASE OUTCOME RECONCILED" : submitted ? "ORDER SUBMITTED · OUTCOME NEEDS ATTENTION" : submissionUnknown ? "SUBMISSION STATUS UNKNOWN · RECONCILE BEFORE ANY RETRY" : "NO ORDER SUBMITTED"}</strong>
  </section>
  <section class="flow">
    <div class="step"><b>1 · Compile</b><span>NL intent → closed policy.</span></div>
    <div class="step"><b>2 · Confirm</b><span>Human confirms policy digest.</span></div>
    <div class="step"><b>3 · Propose</b><span>Price-bounded IOC action.</span></div>
    <div class="step"><b>4 · Preview</b><span>Fresh fees, fill and preview ID.</span></div>
    <div class="step"><b>5 · delta verify</b><span>Orchestrator success + independently verified proof.</span></div>
    <div class="step"><b>6 · Submit</b><span>One-time idempotent Create Order.</span></div>
    <div class="step"><b>7 · Reconcile</b><span>Read actual fill, fees and terminal status.</span></div>
  </section>
  <section class="grid">
    <article class="card"><h2>Human-confirmed policy</h2><dl>
      <dt>Product</dt><dd>${escapeHtml(policy.product_id ?? "—")}</dd>
      <dt>Side</dt><dd>${escapeHtml(policy.side ?? "—")}</dd>
      <dt>Exact size</dt><dd>${escapeHtml(policy.size?.value ?? "—")} ${escapeHtml(policy.size?.asset ?? "")}</dd>
      <dt>Order</dt><dd>${escapeHtml(policy.order_type ?? "—")}</dd>
      <dt>Slippage cap</dt><dd>${escapeHtml(policy.limits?.max_slippage_bps ?? "—")} bps</dd>
      <dt>All-in cap</dt><dd>${escapeHtml(policy.limits?.max_all_in_debit?.value ?? "—")} ${escapeHtml(policy.quote_asset ?? "")}</dd>
    </dl></article>
    <article class="card"><h2>Agent proposal</h2><dl>
      <dt>Product</dt><dd>${escapeHtml(proposal.product_id ?? "—")}</dd>
      <dt>Side</dt><dd>${escapeHtml(proposal.side ?? "—")}</dd>
      <dt>Limit price</dt><dd>${escapeHtml(proposal.limit_price ?? "—")}</dd>
      <dt>Time in force</dt><dd>${escapeHtml(proposal.time_in_force ?? "—")}</dd>
      <dt>Proposal check</dt><dd>${escapeHtml(record.proposal_check?.verdict ?? "—")}</dd>
    </dl></article>
    <article class="card"><h2>Coinbase preview evidence</h2><dl>
      <dt>Best ask</dt><dd>${escapeHtml(record.market?.best_ask ?? "—")}</dd>
      <dt>Estimated fill</dt><dd>${escapeHtml(preview.est_average_filled_price ?? "—")}</dd>
      <dt>Commission</dt><dd>${escapeHtml(preview.commission_total ?? "—")}</dd>
      <dt>Order total</dt><dd>${escapeHtml(preview.order_total ?? "—")}</dd>
      <dt>Preview check</dt><dd>${escapeHtml(record.preview_check?.verdict ?? "—")}</dd>
    </dl></article>
    <article class="card"><h2>Authorization and outcome</h2><dl>
      <dt>delta status</dt><dd>${escapeHtml(record.delta?.status ?? record.delta?.decision ?? "—")}</dd>
      <dt>Intent ID</dt><dd>${escapeHtml(record.delta?.intent_id ?? record.delta?.decision_id ?? "—")}</dd>
      <dt>Verifier confirmed</dt><dd>${escapeHtml(record.delta?.verifier_confirmed === true ? "YES" : "NO")}</dd>
      <dt>Proof digest</dt><dd>${escapeHtml(record.delta?.proof_digest ?? "—")}</dd>
      <dt>Create invoked</dt><dd>${escapeHtml(execution.adapter_invoked === true ? "YES" : "NO")}</dd>
      <dt>Order submitted</dt><dd>${escapeHtml(execution.order_submitted === true ? "YES" : execution.order_submitted == null ? "UNKNOWN" : "NO")}</dd>
      <dt>Order ID</dt><dd>${escapeHtml(execution.order_id ?? "—")}</dd>
      <dt>Actual outcome</dt><dd>${escapeHtml(reconciliation.outcome ?? "—")}</dd>
      <dt>Actual fill</dt><dd>${escapeHtml(actual.filled_value ?? "—")} ${escapeHtml(policy.quote_asset ?? "")}</dd>
      <dt>Actual fees</dt><dd>${escapeHtml(actual.total_fees ?? "—")} ${escapeHtml(policy.quote_asset ?? "")}</dd>
      <dt>Actual all-in</dt><dd>${escapeHtml(reconciliation.checks?.actual_all_in_debit ?? "—")} ${escapeHtml(policy.quote_asset ?? "")}</dd>
      <dt>Actual average</dt><dd>${escapeHtml(actual.average_filled_price ?? "—")}</dd>
      <dt>Post-trade check</dt><dd>${escapeHtml(reconciliation.checks?.verdict ?? "—")}</dd>
    </dl></article>
    ${retry ? `<article class="card wide"><h2>Bounded deterministic retry</h2><dl>
      <dt>Maximum attempts</dt><dd>${escapeHtml(retry.max_attempts)}</dd>
      <dt>Simulated mandate</dt><dd>Up to 3,000 USDC · price, cost, exposure and expiry bounded</dd>
      <dt>Attempt 1</dt><dd>BLOCK → ${escapeHtml(retry.attempts?.[0]?.disposition ?? "—")} · specific violations</dd>
      <dt>Attempt 2</dt><dd>PASS → ${escapeHtml(retry.attempts?.[1]?.disposition ?? "—")} · exact payload verified</dd>
      <dt>Controller outcome</dt><dd>${escapeHtml(retry.terminal_status ?? "—")}</dd>
      <dt>Real Coinbase Create</dt><dd>NOT INVOKED</dd>
    </dl><div class="notice">${escapeHtml(retry.note ?? "")}</div></article>` : ""}
    <article class="card wide"><details><summary>Sanitized execution record</summary><pre>${escapeHtml(JSON.stringify(record, null, 2))}</pre></details></article>
  </section>
  ${simulated ? '<div class="notice"><strong>SIMULATION.</strong> Coinbase, OpenAI, and the production delta verifier were not contacted. The artifact proves orchestration, binding, fail-closed behavior, and the single-use execution seam—not a real transaction.</div>' : ""}
  <footer>Record digest: ${escapeHtml(record.record_digest)} · Generated ${escapeHtml(record.generated_at)}</footer>
</main>
</body>
</html>`;
}

function safeBaseName(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return normalized || "execution-record";
}

async function ensurePrivateDirectory(directoryPath) {
  try {
    const existing = await lstat(directoryPath);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error(`Refusing unsafe report directory: ${directoryPath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    await mkdir(directoryPath, {
      mode: PRIVATE_DIRECTORY_MODE,
      recursive: false,
    });
  }
  await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
}

function reportStem(baseName, now, uniqueId) {
  const timestamp = now
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "");
  const nonce = String(uniqueId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  if (!nonce) {
    throw new Error("Report unique ID must contain an alphanumeric character");
  }
  return `${safeBaseName(baseName)}-${timestamp}-${nonce}`;
}

export async function writeExecutionReport(
  record,
  baseName,
  {
    harnessRoot = HARNESS_ROOT,
    now = () => new Date(),
    uniqueId = randomUUID,
  } = {},
) {
  const runtimeDir = path.join(harnessRoot, "runtime");
  const outputDir = path.join(runtimeDir, "artifacts");
  await ensurePrivateDirectory(runtimeDir);
  await ensurePrivateDirectory(outputDir);

  const stem = reportStem(baseName, now(), uniqueId());
  const jsonPath = path.join(outputDir, `${stem}.json`);
  const htmlPath = path.join(outputDir, `${stem}.html`);
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
    mode: PRIVATE_FILE_MODE,
  });
  try {
    await writeFile(htmlPath, renderExecutionHtml(record), {
      flag: "wx",
      mode: PRIVATE_FILE_MODE,
    });
  } catch (error) {
    await unlink(jsonPath).catch(() => {});
    throw error;
  }

  // Some platforms apply a permissive umask to pre-existing files. `wx`
  // prevents replacement; explicit chmod makes the privacy invariant visible.
  await chmod(jsonPath, PRIVATE_FILE_MODE);
  await chmod(htmlPath, PRIVATE_FILE_MODE);

  return { jsonPath, htmlPath };
}
