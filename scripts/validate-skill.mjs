#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
const SKILL_NAME = "delta-coinbase-guard";
const SKILL_DIR = path.join(ROOT, "skills", SKILL_NAME);

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error("SKILL.md is missing YAML frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return fields;
}

const skill = await readFile(path.join(SKILL_DIR, "SKILL.md"), "utf8");
const frontmatter = parseFrontmatter(skill);
if (frontmatter.name !== SKILL_NAME) {
  throw new Error(
    `Skill name must equal its folder: expected ${SKILL_NAME}, got ${frontmatter.name}`,
  );
}
if (
  typeof frontmatter.description !== "string" ||
  frontmatter.description.length < 40 ||
  frontmatter.description.length > 1_024
) {
  throw new Error("Skill description must be between 40 and 1,024 characters");
}
if (!/\$delta-coinbase-guard\b/.test(skill)) {
  throw new Error("SKILL.md must contain its explicit trigger name");
}
for (const reference of [
  "references/workflow.md",
  "references/security-boundary.md",
  "references/showcase-response.md",
]) {
  if (!skill.includes(reference)) {
    throw new Error(`SKILL.md must link ${reference}`);
  }
  await readFile(path.join(SKILL_DIR, reference), "utf8");
}

const openAiYaml = await readFile(
  path.join(SKILL_DIR, "agents", "openai.yaml"),
  "utf8",
);
for (const field of ["display_name:", "short_description:", "default_prompt:"]) {
  if (!openAiYaml.includes(field)) {
    throw new Error(`agents/openai.yaml is missing ${field.slice(0, -1)}`);
  }
}
if (!openAiYaml.includes("$delta-coinbase-guard")) {
  throw new Error("Default prompt must explicitly invoke $delta-coinbase-guard");
}

process.stdout.write("Delta Coinbase Guard skill metadata is valid.\n");
