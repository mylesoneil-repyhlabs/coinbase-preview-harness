const INTEGRATION_ERROR =
  "ENGINEERING_INTEGRATION_REQUIRED: real Coinbase Create is disabled in public v1.4. " +
  "Delta engineering must replace src/integration/production-composition.js with the " +
  "reviewed Delta Mandate adapter and a durable one-time grant store before enabling execution.";

const REQUIRED_GRANT_METHODS = Object.freeze([
  "consumeGrant",
  "markGrant",
  "readGrant",
]);

// Module-private by design. Public v1.4 never returns this value. An internal
// engineering build can return it only from the reviewed composition function
// below, after wiring the real Delta and durable grant dependencies.
const LIVE_EXECUTION_CAPABILITY = () => undefined;

export function assertProductionExecutionCapability(capability) {
  if (capability !== LIVE_EXECUTION_CAPABILITY) {
    const error = new Error(INTEGRATION_ERROR);
    error.code = "ENGINEERING_INTEGRATION_REQUIRED";
    throw error;
  }
  return capability;
}

export function assertProductionDependencyShape(dependencies) {
  if (!dependencies || typeof dependencies !== "object") {
    throw new Error("Production execution dependencies are missing");
  }
  const requiredAdapterMethods = [
    "submitPolicy",
    "authorizeIntent",
    "prepareProposal",
    "submitProposal",
    "getStatus",
    "getVerificationOutcome",
    "getProof",
    "verifyProofArtifact",
  ];
  for (const method of requiredAdapterMethods) {
    if (typeof dependencies.mandateAdapter?.[method] !== "function") {
      throw new Error(`Production mandate adapter must implement ${method}()`);
    }
  }
  for (const method of REQUIRED_GRANT_METHODS) {
    if (typeof dependencies[method] !== "function") {
      throw new Error(`Production composition must implement ${method}()`);
    }
  }
  return Object.freeze({ ...dependencies });
}

export function assertProductionExecutionDependencies(dependencies) {
  const validated = assertProductionDependencyShape(dependencies);
  assertProductionExecutionCapability(validated.executionCapability);
  return validated;
}

/**
 * This compile-time seam is intentionally closed in public v1.4.
 *
 * Engineering should return reviewed, internally composed dependencies here:
 * - mandateAdapter: the real Delta policy/proposal/verifier lifecycle
 * - consumeGrant: a durable atomic one-time grant operation
 * - markGrant: durable post-submission state updates
 * - readGrant: read-only recovery of the same durable grant state
 * - executionCapability: LIVE_EXECUTION_CAPABILITY from this module's closure
 *
 * Do not replace this with a runtime module loader. The executor must not accept
 * arbitrary in-process code or let a plug-in self-assert that it is production.
 */
export async function loadProductionExecutionDependencies() {
  const error = new Error(INTEGRATION_ERROR);
  error.code = "ENGINEERING_INTEGRATION_REQUIRED";
  throw error;
}

export function productionExecutionStatus() {
  return {
    enabled: false,
    code: "ENGINEERING_INTEGRATION_REQUIRED",
    detail:
      "Preview probe is available; real Coinbase Create remains compile-time disabled.",
  };
}
