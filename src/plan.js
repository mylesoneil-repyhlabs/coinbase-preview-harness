import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ROOT } from "./coinbase-cli.js";
import { digest } from "./evidence.js";
import {
  compileDeterministicIntent,
  compileIntentWithOpenAI,
} from "./intent-compiler.js";
import {
  assertPolicyWithinSafetyProfile,
  validateCompilation,
} from "./policy-validator.js";

export const PLAN_DIR = path.join(HARNESS_ROOT, "runtime", "plans");
export const SAFETY_PROFILE_PATH = path.join(
  HARNESS_ROOT,
  "config",
  "execution-safety-profile.json",
);

export async function loadSafetyProfile() {
  return JSON.parse(await readFile(SAFETY_PROFILE_PATH, "utf8"));
}

export async function createExecutionPlan(
  intent,
  { compiler = "deterministic", openAIOptions } = {},
) {
  let compilation;
  let compilerMetadata;
  if (compiler === "deterministic") {
    compilation = compileDeterministicIntent(intent);
    compilerMetadata = {
      mode: "DETERMINISTIC_V1",
      model: null,
      response_id: null,
    };
  } else if (compiler === "openai") {
    const result = await compileIntentWithOpenAI(intent, openAIOptions);
    compilation = result.compilation;
    compilerMetadata = {
      mode: "OPENAI_STRUCTURED_OUTPUTS",
      model: result.model,
      response_id: result.response_id,
    };
  } else {
    throw new Error("compiler must be deterministic or openai");
  }
  validateCompilation(compilation, intent);
  if (compilation.status !== "READY_FOR_CONFIRMATION") {
    return {
      schema_version: "delta.coinbase.execution_plan.v1",
      plan_id: randomUUID(),
      created_at: new Date().toISOString(),
      status: compilation.status,
      source_intent: {
        text: intent,
        digest: digest(intent),
      },
      compiler: {
        ...compilerMetadata,
        taxonomy_version: compilation.taxonomy_version,
      },
      compilation,
    };
  }

  const safetyProfile = await loadSafetyProfile();
  assertPolicyWithinSafetyProfile(compilation.policy, safetyProfile);
  const policyDigest = digest(compilation.policy);
  const safetyProfileDigest = digest(safetyProfile);
  return {
    schema_version: "delta.coinbase.execution_plan.v1",
    plan_id: randomUUID(),
    created_at: new Date().toISOString(),
    status: "AWAITING_HUMAN_CONFIRMATION",
    source_intent: {
      text: intent,
      digest: digest(intent),
    },
    compiler: {
      ...compilerMetadata,
      taxonomy_version: compilation.taxonomy_version,
    },
    policy: compilation.policy,
    policy_digest: policyDigest,
    safety_profile: {
      id: safetyProfile.id,
      digest: safetyProfileDigest,
    },
    confirmation: {
      required: true,
      instruction: `Review the policy, then pass --confirm-policy ${policyDigest}`,
    },
  };
}

export async function writeExecutionPlan(plan) {
  await mkdir(PLAN_DIR, { recursive: true, mode: 0o700 });
  const filePath = path.join(PLAN_DIR, `${plan.plan_id}.json`);
  await writeFile(filePath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  return filePath;
}

export async function readExecutionPlan(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await readFile(resolved, "utf8");
  const plan = JSON.parse(raw);
  if (plan.schema_version !== "delta.coinbase.execution_plan.v1") {
    throw new Error("Unsupported execution plan schema");
  }
  return plan;
}
