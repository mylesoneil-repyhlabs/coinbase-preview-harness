import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProductionDependencyShape,
  assertProductionExecutionDependencies,
  loadProductionExecutionDependencies,
  productionExecutionStatus,
} from "../src/integration/production-composition.js";

function fakeDependencies() {
  const noop = async () => {};
  return {
    mandateAdapter: {
      submitPolicy: noop,
      authorizeIntent: noop,
      prepareProposal: noop,
      submitProposal: noop,
      getStatus: noop,
      getVerificationOutcome: noop,
      getProof: noop,
    },
    consumeGrant: noop,
    markGrant: noop,
    readGrant: noop,
  };
}

test("public V1 hard-disables real Coinbase Create at the compile-time seam", async () => {
  assert.deepEqual(productionExecutionStatus(), {
    enabled: false,
    code: "ENGINEERING_INTEGRATION_REQUIRED",
    detail:
      "Preview probe is available; real Coinbase Create remains compile-time disabled.",
  });
  await assert.rejects(
    () => loadProductionExecutionDependencies(),
    (error) =>
      error?.code === "ENGINEERING_INTEGRATION_REQUIRED" &&
      /real Coinbase Create is disabled/.test(error.message),
  );
});

test("engineering composition must provide both Delta and durable grant ports", () => {
  const complete = fakeDependencies();
  assert.equal(
    assertProductionDependencyShape(complete).mandateAdapter,
    complete.mandateAdapter,
  );
  assert.throws(
    () =>
      assertProductionExecutionDependencies({
        ...complete,
        executionCapability: Symbol("forged"),
      }),
    /ENGINEERING_INTEGRATION_REQUIRED/,
  );
  for (const missing of ["consumeGrant", "markGrant", "readGrant"]) {
    const invalid = { ...complete };
    delete invalid[missing];
    assert.throws(
      () => assertProductionDependencyShape(invalid),
      new RegExp(`${missing}\\(\\)`),
    );
  }
  assert.throws(
    () =>
      assertProductionDependencyShape({
        ...complete,
        mandateAdapter: {},
      }),
    /submitPolicy/,
  );
});
