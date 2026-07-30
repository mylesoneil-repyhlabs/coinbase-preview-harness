import { runBuiltInSimulation } from "./execution-pipeline.js";

export function simulateExecution(plan, confirmPolicyDigest, options) {
  return runBuiltInSimulation(plan, confirmPolicyDigest, options);
}
