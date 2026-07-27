import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output", "coinbase-demo-panels");

const panels = [
  {
    id: "01",
    duration: 15,
    eyebrow: "THE HUMAN AUTHORIZES",
    title: "A bounded $3,000 ETH allocation",
    accent: "#0052ff",
    items: [
      ["Allocation", "Up to 3,000 USDC"],
      ["Entry", "ETH at or below 3,000 USDC"],
      ["Costs", "≤35 bps slippage · ≤15 USDC fee"],
      ["Exposure", "≤10,000 USDC after the trade"],
      ["Validity", "15 minutes · one execution"],
    ],
    footer: "SIMULATED MANDATE · NOT A LIVE TRADE AUTHORIZATION",
  },
  {
    id: "02",
    duration: 12,
    eyebrow: "SEPARATION OF CONTROL",
    title: "The agent proposes. Delta decides.",
    accent: "#0052ff",
    items: [
      ["1 · Agent", "Creates a candidate action"],
      ["2 · Delta", "Evaluates exact action vs mandate"],
      ["3 · Controller", "Maps BLOCK / PASS to retry or eligibility"],
      ["4 · Executor", "Can receive only passed exact bytes"],
    ],
    footer: "THE MODEL NEVER OWNS THE EXECUTION DECISION",
  },
  {
    id: "03",
    duration: 18,
    eyebrow: "ATTEMPT 1",
    title: "BLOCK — five constraints fail",
    accent: "#b42318",
    items: [
      ["Allocation", "3,300 > 3,000 USDC"],
      ["Reference price", "3,035 > 3,000 USDC"],
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
    title: "The decision is bound to exact bytes",
    accent: "#7a5af8",
    items: [
      ["Mandate digest", "What the human authorized"],
      ["Proposal digest", "Exactly what the agent proposed"],
      ["Decision", "BLOCK or PASS plus reasons"],
      ["Receipt digest", "Content-addressed and re-verifiable"],
    ],
    footer: "ANY PAYLOAD CHANGE INVALIDATES THE EVIDENCE",
  },
  {
    id: "05",
    duration: 17,
    eyebrow: "ATTEMPT 2",
    title: "PASS — the revised action fits",
    accent: "#067647",
    items: [
      ["Allocation", "2,700 USDC"],
      ["Reference / limit", "2,995 / 3,000 USDC"],
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
    accent: "#067647",
    items: [
      ["Gate", "PASS + verified receipt"],
      ["Payload check", "Passed digest == execution digest"],
      ["Use", "One simulated execution only"],
      ["Coinbase", "Not contacted · Create unreachable"],
      ["Production delta", "Not contacted"],
    ],
    footer: "SIMULATION COMPLETE · NO MONEY MOVED",
  },
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function panelSvg(panel, index) {
  const rows = panel.items
    .map(([label, value], row) => {
      const y = 330 + row * 112;
      return `<g transform="translate(54 ${y})" font-family="Inter,Arial,sans-serif">
  <rect width="612" height="88" rx="16" fill="#ffffff" stroke="#d0d5dd"/>
  <text x="22" y="30" fill="#667085" font-size="17" font-weight="650">${escapeXml(label)}</text>
  <text x="22" y="62" fill="#101828" font-size="22" font-weight="760">${escapeXml(value)}</text>
</g>`;
    })
    .join("\n");
  const dots = panels
    .map(
      (_item, dot) =>
        `<circle cx="${282 + dot * 31}" cy="1018" r="${dot === index ? 7 : 5}" fill="${dot === index ? panel.accent : "#d0d5dd"}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080" viewBox="0 0 720 1080">
<rect width="720" height="1080" fill="#f8fafc"/>
<rect width="12" height="1080" fill="${panel.accent}"/>
<text x="54" y="72" fill="${panel.accent}" font-family="Inter,Arial,sans-serif" font-size="17" font-weight="800" letter-spacing="2">${escapeXml(panel.eyebrow)}</text>
<text x="54" y="137" fill="#101828" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="800">
  <tspan x="54" dy="0">${escapeXml(panel.title.split(" ").slice(0, 5).join(" "))}</tspan>
  <tspan x="54" dy="52">${escapeXml(panel.title.split(" ").slice(5).join(" "))}</tspan>
</text>
<rect x="54" y="259" width="74" height="7" rx="3.5" fill="${panel.accent}"/>
${rows}
<text x="54" y="958" fill="#475467" font-family="Inter,Arial,sans-serif" font-size="15" font-weight="800" letter-spacing="1">${escapeXml(panel.footer)}</text>
<text x="666" y="72" text-anchor="end" fill="#98a2b3" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="700">${panel.id} / 06</text>
${dots}
</svg>`;
}

await mkdir(output, { recursive: true });
await Promise.all(
  panels.map((panel, index) =>
    writeFile(
      path.join(output, `${panel.id}-${panel.eyebrow.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.svg`),
      panelSvg(panel, index),
      "utf8",
    ),
  ),
);
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

process.stdout.write(`Generated ${panels.length} Coinbase companion panels in ${output}\n`);
