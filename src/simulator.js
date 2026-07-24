import { runBuiltInSimulation } from "./execution-pipeline.js";

export function simulateExecution(plan, confirmPolicyDigest) {
  return runBuiltInSimulation(plan, confirmPolicyDigest);
}
