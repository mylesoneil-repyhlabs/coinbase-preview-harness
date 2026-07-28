import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMastraPartnerBundle } from "../src/mastra-partner.js";
import { renderMastraPartnerBundleHtml } from "../src/partner-demo.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(root, "output", "mastra");
const fixed = new Date("2026-07-27T20:00:00.000Z");
const bundle = await runMastraPartnerBundle({
  now: () => new Date(fixed),
});

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    path.join(outputDirectory, "mastra-delta-partner-proof.json"),
    `${JSON.stringify(bundle, null, 2)}\n`,
  ),
  writeFile(
    path.join(outputDirectory, "mastra-delta-partner-proof.html"),
    renderMastraPartnerBundleHtml(bundle),
  ),
]);

process.stdout.write(
  `Generated ${path.join(outputDirectory, "mastra-delta-partner-proof.html")}\n`,
);
