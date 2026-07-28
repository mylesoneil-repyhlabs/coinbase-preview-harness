import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output", "coinbase-demo-panels");
const capabilityOutput = path.join(
  root,
  "output",
  "coinbase-v1.3-capability-panels",
);

const panels = [
  {
    id: "01",
    duration: 15,
    eyebrow: "THE HUMAN AUTHORIZES",
    title: "A bounded $3,000 ETH allocation",
    titleLines: ["A bounded $3,000", "ETH allocation"],
    accent: "#0052ff",
    items: [
      ["Allocation", "Up to 3,000 USDC"],
      ["Entry", "ETH at or below 3,000 USDC"],
      ["Costs", "≤35 bps slippage · ≤15 USDC fee"],
      ["Exposure", "≤10,000 USDC after the trade"],
      ["Validity", "15 minutes · one eligible action in this trace"],
    ],
    footer: "SIMULATED MANDATE · NOT A LIVE TRADE AUTHORIZATION",
  },
  {
    id: "02",
    duration: 12,
    eyebrow: "SEPARATION OF CONTROL",
    title: "Agent proposes. Simulated evaluator decides.",
    titleLines: ["Agent proposes.", "Simulated evaluator decides."],
    accent: "#0052ff",
    items: [
      ["1 · Agent", "Creates a candidate action"],
      ["2 · Simulated evaluator", "Checks canonical action vs mandate"],
      ["3 · Controller", "Maps BLOCK / PASS to retry or eligibility"],
      ["4 · Executor", "Can receive only the passed canonical action"],
    ],
    footer: "THE MODEL NEVER OWNS THE EXECUTION DECISION",
  },
  {
    id: "03",
    duration: 18,
    eyebrow: "ATTEMPT 1",
    title: "BLOCK — six checks fail",
    titleLines: ["BLOCK — six checks fail"],
    accent: "#b42318",
    items: [
      ["Allocation", "3,300 > 3,000 USDC"],
      ["Market price", "3,035 > 3,000 USDC"],
      ["Order limit", "3,060 > 3,000 USDC"],
      ["Slippage", "60 > 35 bps"],
      ["Fee", "18 > 15 USDC"],
      ["Exposure", "10,500 > 10,000 USDC"],
    ],
    footer: "BOUND RECEIPT · CONTROLLER ALLOWS ONE RETRY",
  },
  {
    id: "04",
    duration: 14,
    eyebrow: "EVIDENCE",
    title: "Decision bound to canonical action and evidence",
    titleLines: ["Decision bound to", "canonical action + evidence"],
    accent: "#7a5af8",
    items: [
      ["Mandate digest", "What the human authorized"],
      ["Proposal digest", "Exactly what the agent proposed"],
      ["Evidence digest", "Market, Preview and portfolio fixture"],
      ["Decision", "BLOCK or PASS plus reasons"],
      ["Verification", "Recomputes every binding"],
    ],
    footer: "ANY ACTION CHANGE INVALIDATES THE RECEIPT AND GATE BINDING",
  },
  {
    id: "05",
    duration: 17,
    eyebrow: "ATTEMPT 2",
    title: "PASS — the revised action fits",
    titleLines: ["PASS — revised action fits"],
    accent: "#067647",
    items: [
      ["Allocation", "2,700 USDC"],
      ["Market / limit", "2,994 / 3,000 USDC"],
      ["Slippage", "20 bps"],
      ["Fee", "9 USDC"],
      ["Exposure", "9,900 USDC"],
    ],
    footer: "PASS RECEIPT BINDS THIS REVISED PAYLOAD ONLY",
  },
  {
    id: "06",
    duration: 15,
    eyebrow: "EXECUTION BOUNDARY",
    title: "Only a verified PASS unlocks eligibility",
    titleLines: ["Only a verified PASS", "reaches eligibility"],
    accent: "#067647",
    items: [
      ["Gate", "PASS + verified receipt"],
      ["Payload check", "Passed digest == execution digest"],
      ["Evidence check", "Passed digest == gate evidence digest"],
      ["Use", "One eligibility in this simulated trace"],
      ["External systems", "Coinbase + production delta not contacted"],
    ],
    footer: "COINBASE CREATE UNREACHABLE · NO MONEY MOVED",
  },
];

const capabilityPanels = [
  {
    id: "01",
    duration: 15,
    eyebrow: "V1.3 ACTION INVENTORY",
    title: "One generic spot action, two sides",
    titleLines: ["One generic spot action,", "two sides"],
    accent: "#0052ff",
    items: [
      ["BUY", "Exact quote_size · fund with held quote"],
      ["SELL", "Exact base_size · fund with held base"],
      ["Pairs", "Validated from runtime SPOT metadata"],
      ["Evidence", "Funds · market · Preview"],
      ["Boundary", "Coinbase Create disabled"],
    ],
    footer: "THIS RECORDING USES FIXTURES · PRODUCT AVAILABILITY IS NOT CLAIMED",
  },
  {
    id: "02",
    duration: 18,
    eyebrow: "GENERIC BUY · DRAFT",
    title: "SOL-USDC becomes a closed BUY action",
    titleLines: ["SOL-USDC becomes", "a closed BUY action"],
    accent: "#0052ff",
    items: [
      ["Size", "quote_size = 250 USDC"],
      ["Funding", "held USDC · required 252"],
      ["Price", "fresh best ask · ≤25 bps above"],
      ["Costs", "≤2 fee · ≤252 total debit"],
      ["Authorization", "Pause on exact policy digest"],
    ],
    footer: "THE HARNESS DOES NOT AUTHORIZE ITS OWN DRAFT",
  },
  {
    id: "03",
    duration: 18,
    eyebrow: "GENERIC BUY · RESULT",
    title: "The exact BUY reaches a simulated PASS",
    titleLines: ["The exact BUY reaches", "a simulated PASS"],
    accent: "#067647",
    items: [
      ["Proposal", "SOL-USDC · BUY · quote_size"],
      ["Funding", "USDC balance fixture bound"],
      ["Preview", "Labeled fixture · not Coinbase data"],
      ["Receipt", "Action + payload + evidence digests"],
      ["Gate", "Verified PASS for this payload only"],
    ],
    footer: "COINBASE CONTACTED: FALSE · PRODUCTION DELTA: FALSE",
  },
  {
    id: "04",
    duration: 18,
    eyebrow: "GENERIC SELL · DRAFT",
    title: "BTC-USD becomes a closed SELL action",
    titleLines: ["BTC-USD becomes", "a closed SELL action"],
    accent: "#7a5af8",
    items: [
      ["Size", "base_size = 0.05 BTC"],
      ["Funding", "held BTC · required 0.05"],
      ["Price", "fresh best bid · ≤30 bps below"],
      ["Settlement", "≤12 fee · ≥4,990 USD net"],
      ["Authorization", "Pause on a new policy digest"],
    ],
    footer: "SELL USES BASE FUNDS; NO SILENT ASSET CONVERSION",
  },
  {
    id: "05",
    duration: 18,
    eyebrow: "GENERIC SELL · RESULT",
    title: "The exact SELL reaches a simulated PASS",
    titleLines: ["The exact SELL reaches", "a simulated PASS"],
    accent: "#067647",
    items: [
      ["Proposal", "BTC-USD · SELL · base_size"],
      ["Funding", "BTC balance fixture bound"],
      ["Preview", "Labeled fixture · not Coinbase data"],
      ["Receipt", "Action + payload + evidence digests"],
      ["Gate", "Verified PASS for this payload only"],
    ],
    footer: "COINBASE CREATE INVOKED: FALSE · NO MONEY MOVED",
  },
  {
    id: "06",
    duration: 15,
    eyebrow: "SCOPE CONTROL",
    title: "Unsupported actions stop; Create stays locked",
    titleLines: ["Unsupported actions stop;", "Create stays locked"],
    accent: "#b42318",
    items: [
      ["No coercion", "Transfer ≠ spot trade"],
      ["Funding", "Different held asset cannot substitute"],
      ["Preview warning", "REVIEW · gate remains locked"],
      ["Payload change", "Invalidates the PASS binding"],
      ["Execution", "Compile-time Create seam disabled"],
    ],
    footer: "TRANSFERS · STAKING · DERIVATIVES · RECURRING ORDERS: FUTURE",
  },
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function panelSvg(panel, index, sequence = panels) {
  const compactRows = panel.items.length > 5;
  const rowStep = compactRows ? 94 : 112;
  const rowHeight = compactRows ? 76 : 88;
  const rows = panel.items
    .map(([label, value], row) => {
      const y = 330 + row * rowStep;
      return `<g transform="translate(54 ${y})" font-family="Inter,Arial,sans-serif">
  <rect width="612" height="${rowHeight}" rx="16" fill="#ffffff" stroke="#d0d5dd"/>
  <text x="22" y="${compactRows ? 26 : 30}" fill="#667085" font-size="${compactRows ? 15 : 17}" font-weight="650">${escapeXml(label)}</text>
  <text x="22" y="${compactRows ? 55 : 62}" fill="#101828" font-size="${compactRows ? 20 : 22}" font-weight="760">${escapeXml(value)}</text>
</g>`;
    })
    .join("\n");
  const dots = sequence
    .map(
      (_item, dot) =>
        `<circle cx="${282 + dot * 31}" cy="1018" r="${dot === index ? 7 : 5}" fill="${dot === index ? panel.accent : "#d0d5dd"}"/>`,
    )
    .join("");
  const titleLineTwo = panel.titleLines[1]
    ? `\n  <tspan x="54" dy="50">${escapeXml(panel.titleLines[1])}</tspan>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080" viewBox="0 0 720 1080">
<rect width="720" height="1080" fill="#f8fafc"/>
<rect width="12" height="1080" fill="${panel.accent}"/>
<text x="54" y="72" fill="${panel.accent}" font-family="Inter,Arial,sans-serif" font-size="17" font-weight="800" letter-spacing="2">${escapeXml(panel.eyebrow)}</text>
<text x="54" y="137" fill="#101828" font-family="Inter,Arial,sans-serif" font-size="40" font-weight="800">
  <tspan x="54" dy="0">${escapeXml(panel.titleLines[0])}</tspan>${titleLineTwo}
</text>
<text x="54" y="224" fill="#667085" font-family="Inter,Arial,sans-serif" font-size="14" font-weight="800" letter-spacing="1">SIMULATION ONLY · FIXTURE DATA · NO LIVE ORDER</text>
<rect x="54" y="259" width="74" height="7" rx="3.5" fill="${panel.accent}"/>
${rows}
<text x="54" y="958" fill="#475467" font-family="Inter,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="1">${escapeXml(panel.footer)}</text>
<text x="666" y="72" text-anchor="end" fill="#98a2b3" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="700">${panel.id} / ${String(sequence.length).padStart(2, "0")}</text>
${dots}
</svg>`;
}

function overviewSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900" role="img" aria-labelledby="title desc">
<title id="title">Delta Coinbase Guard conditional mandate showcase</title>
<desc id="desc">A simulated agent proposal is blocked against six mandate checks, retried once, passed, and bound to a locked Coinbase execution boundary.</desc>
<defs>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#101828" flood-opacity=".10"/></filter>
  <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0 0L12 6L0 12Z" fill="#667085"/></marker>
  <style>
    .sans{font-family:Inter,Arial,sans-serif}.eyebrow{font-size:18px;font-weight:800;letter-spacing:2px}.title{font-size:48px;font-weight:850;letter-spacing:-1.5px}.subtitle{font-size:23px;fill:#667085}.card-title{font-size:27px;font-weight:800;fill:#101828}.body{font-size:18px;fill:#475467}.pill{font-size:17px;font-weight:850}.small{font-size:15px;font-weight:750;fill:#667085}
  </style>
</defs>
<rect width="1440" height="900" fill="#f8fafc"/>
<rect width="14" height="900" fill="#0052ff"/>
<g class="sans">
  <text x="72" y="72" class="eyebrow" fill="#0052ff">DELTA GUARD FOR COINBASE · CREDENTIAL-FREE SIMULATION</text>
  <text x="72" y="142" class="title" fill="#101828">One mandate. Two proposals. One canonical action eligible.</text>
  <text x="72" y="185" class="subtitle">The agent proposes; the simulated evaluator decides; the external controller owns retry and execution.</text>

  <rect x="72" y="225" width="1296" height="92" rx="18" fill="#eef4ff" stroke="#b2ccff"/>
  <text x="98" y="261" class="small" fill="#0052ff">SIMULATED HUMAN MANDATE</text>
  <text x="98" y="293" class="body" fill="#101828">≤3,000 USDC · ETH ≤3,000 · ≤35 bps · ≤15 USDC fee · exposure ≤10,000 · 15 minutes · one use</text>

  <g filter="url(#shadow)">
    <rect x="72" y="378" width="360" height="300" rx="24" fill="#fff" stroke="#f4b4ae"/>
    <rect x="540" y="378" width="360" height="300" rx="24" fill="#fff" stroke="#b2ccff"/>
    <rect x="1008" y="378" width="360" height="300" rx="24" fill="#fff" stroke="#a6f4c5"/>
  </g>

  <rect x="100" y="408" width="104" height="36" rx="18" fill="#fee4e2"/>
  <text x="126" y="432" class="pill" fill="#b42318">BLOCK</text>
  <text x="100" y="486" class="card-title">Attempt 1</text>
  <text x="100" y="530" class="body">3,300 USDC at a 3,060 limit</text>
  <text x="100" y="560" class="body">Six checks fail with reasons</text>
  <text x="100" y="590" class="body">Proposal + evidence bound to receipt</text>
  <text x="100" y="635" class="small">CONTROLLER: RETRY ONCE</text>

  <rect x="568" y="408" width="124" height="36" rx="18" fill="#eef4ff"/>
  <text x="590" y="432" class="pill" fill="#0052ff">RETRY</text>
  <text x="568" y="486" class="card-title">New fixture + proposal</text>
  <text x="568" y="530" class="body">Agent revises canonical action</text>
  <text x="568" y="560" class="body">Controller supplies new evidence</text>
  <text x="568" y="590" class="body">Agent cannot author market data</text>
  <text x="568" y="635" class="small">FIXED TWO-ATTEMPT BUDGET</text>

  <rect x="1036" y="408" width="88" height="36" rx="18" fill="#d1fadf"/>
  <text x="1058" y="432" class="pill" fill="#067647">PASS</text>
  <text x="1036" y="486" class="card-title">Attempt 2</text>
  <text x="1036" y="530" class="body">2,700 USDC at a 3,000 limit</text>
  <text x="1036" y="560" class="body">Receipt bindings recompute</text>
  <text x="1036" y="590" class="body">Exact digest reaches gate</text>
  <text x="1036" y="635" class="small">SIMULATED ELIGIBILITY ONLY</text>

  <path d="M432 528H526" stroke="#667085" stroke-width="3" fill="none" marker-end="url(#arrow)"/>
  <path d="M900 528H994" stroke="#667085" stroke-width="3" fill="none" marker-end="url(#arrow)"/>

  <rect x="72" y="738" width="1296" height="82" rx="18" fill="#101828"/>
  <text x="98" y="771" class="small" style="fill:#84adff">EXECUTION BOUNDARY</text>
  <text x="98" y="801" class="body" style="fill:#fff">PASS + verified receipt + proposal digest match + evidence digest match → one eligibility in this trace</text>
  <text x="1368" y="801" text-anchor="end" class="small" style="fill:#fdb022">COINBASE CREATE UNREACHABLE</text>
  <text x="72" y="865" class="small">Fixtures only · Coinbase and production delta not contacted · no credentials · no order · no money moved</text>
</g>
</svg>`;
}

await Promise.all([
  mkdir(output, { recursive: true }),
  mkdir(capabilityOutput, { recursive: true }),
]);
await Promise.all(
  panels.map((panel, index) =>
    writeFile(
      path.join(output, `${panel.id}-${panel.eyebrow.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.svg`),
      panelSvg(panel, index),
      "utf8",
    ),
  ),
);
await Promise.all(
  capabilityPanels.map((panel, index) =>
    writeFile(
      path.join(
        capabilityOutput,
        `${panel.id}-${panel.eyebrow.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.svg`,
      ),
      panelSvg(panel, index, capabilityPanels),
      "utf8",
    ),
  ),
);
await writeFile(path.join(output, "00-overview.svg"), overviewSvg(), "utf8");
await writeFile(
  path.join(output, "timeline.json"),
  `${JSON.stringify(
    panels.map(({ id, duration, title }) => ({
      panel: id,
      suggested_duration_seconds: duration,
      title,
    })),
    null,
    2,
  )}\n`,
  "utf8",
);
await writeFile(
  path.join(capabilityOutput, "timeline.json"),
  `${JSON.stringify(
    capabilityPanels.map(({ id, duration, title }) => ({
      panel: id,
      suggested_duration_seconds: duration,
      title,
    })),
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `Generated one overview and ${panels.length} conditional-showcase panels in ${output}\nGenerated ${capabilityPanels.length} v1.3 capability panels in ${capabilityOutput}\n`,
);
