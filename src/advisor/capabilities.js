import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ADVISOR_CAPABILITIES_PATH = path.resolve(
  SOURCE_DIR,
  "../../config/advisor-capabilities.json",
);

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`Advisor capability ${label} must be boolean`);
  }
  return value;
}

const EXECUTION_FEATURES = Object.freeze([
  "post_pass_final_confirmation_readiness",
  "durable_executor",
  "live_execution",
  "autonomous_execution",
  "coinbase_create",
]);

function assertExecutionDisabled(profile) {
  requireBoolean(
    profile.features.live_readiness_preview,
    "live_readiness_preview",
  );
  for (const feature of EXECUTION_FEATURES) {
    if (requireBoolean(profile.features[feature], feature)) {
      throw new Error(
        `Advisor execution feature ${feature} must remain disabled`,
      );
    }
  }
  if (
    requireBoolean(
      profile.release_boundaries.coinbase_create_enabled,
      "coinbase_create_enabled",
    ) ||
    requireBoolean(
      profile.release_boundaries.production_delta_integrated,
      "production_delta_integrated",
    ) ||
    requireBoolean(
      profile.release_boundaries.unattended_execution,
      "unattended_execution",
    )
  ) {
    throw new Error("Advisor release boundary cannot enable execution");
  }
  return profile;
}

export function loadAdvisorCapabilities(
  capabilitiesPath = ADVISOR_CAPABILITIES_PATH,
) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(capabilitiesPath, "utf8"));
  } catch {
    throw new Error("Advisor capability contract is unavailable");
  }
  if (
    parsed?.schema_version !== "delta.coinbase.advisor_capabilities.v1" ||
    parsed?.default_mode !== "dry_run" ||
    !parsed?.modes ||
    !parsed?.features ||
    !parsed?.credentials ||
    !parsed?.release_boundaries
  ) {
    throw new Error("Advisor capability contract is invalid");
  }
  assertExecutionDisabled(parsed);
  return Object.freeze(parsed);
}

export function advisorStatusCapabilities(profile) {
  assertExecutionDisabled(profile);
  return Object.freeze({
    conversational_spot_plan: requireBoolean(
      profile.features.advisor,
      "advisor",
    ),
    credential_free_dry_run: requireBoolean(
      profile.modes.dry_run?.enabled,
      "dry_run",
    ),
    simulated_block_retry_pass_showcase: requireBoolean(
      profile.features.advisor,
      "advisor",
    ),
    simulated_review: requireBoolean(
      profile.features.advisor,
      "advisor",
    ),
    view_only_connection: requireBoolean(
      profile.modes.view_only_preflight?.enabled,
      "view_only_preflight",
    ),
    conditional_plan_simulation: requireBoolean(
      profile.features.conditional_plan_simulation,
      "conditional_plan_simulation",
    ),
    conditional_plan_monitoring: requireBoolean(
      profile.features.saved_plan_monitoring,
      "saved_plan_monitoring",
    ),
    educational_research: requireBoolean(
      profile.features.educational_research,
      "educational_research",
    ),
    portfolio_planning: requireBoolean(
      profile.features.portfolio_planning,
      "portfolio_planning",
    ),
    live_readiness_preview: requireBoolean(
      profile.features.live_readiness_preview,
      "live_readiness_preview",
    ),
    post_pass_final_confirmation_readiness: requireBoolean(
      profile.features.post_pass_final_confirmation_readiness,
      "post_pass_final_confirmation_readiness",
    ),
    production_delta: requireBoolean(
      profile.release_boundaries.production_delta_integrated,
      "production_delta_integrated",
    ),
    live_create: requireBoolean(
      profile.release_boundaries.coinbase_create_enabled,
      "coinbase_create_enabled",
    ),
  });
}
