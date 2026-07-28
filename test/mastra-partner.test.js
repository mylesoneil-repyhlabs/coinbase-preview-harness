import test from "node:test";
import assert from "node:assert/strict";
import {
  createMastraVendorPaymentHandler,
  runMastraPartnerBundle,
  runMastraPartnerDemo,
} from "../src/mastra-partner.js";

const FIXED = new Date("2026-07-27T16:00:00.000Z");

const PASS_INPUT = Object.freeze({
  vendor_id: "vendor-approved-017",
  vendor_name: "Northstar Cloud Services",
  amount_cents: 240_000,
  currency: "USD",
  destination_account_id: "operating-usd-001",
  purchase_order_id: "PO-2026-1042",
  invoice_id: "INV-7741",
  cost_center: "infrastructure",
  memo: "July managed infrastructure",
});

function context() {
  return {
    requestContext: {
      get: (name) =>
        ({
          tenantId: "tenant-1",
          userId: "user-1",
          workflowRunId: "run-1",
        })[name],
    },
  };
}

test("Mastra-shaped boundary returns a signed PASS and owns exact-payload submission", async () => {
  const calls = [];
  const handler = createMastraVendorPaymentHandler({
    now: () => new Date(FIXED),
    executePayment: async (executionPayload) => {
      calls.push(executionPayload);
      return {
        execution_id: "mastra-sim-1",
        status: "SIMULATED_ACCEPTED",
        private_adapter_response: "do-not-return",
      };
    },
  });
  const result = await handler(structuredClone(PASS_INPUT), context());

  assert.equal(result.status, "PASS");
  assert.equal(result.receipt_verification.artifact_verified, true);
  assert.equal(result.receipt_verification.execution_authorized, true);
  assert.equal(result.execution.adapter_invoked, true);
  assert.equal(result.execution.grant_consumed, true);
  assert.equal(result.execution.money_moved, false);
  assert.equal(calls.length, 1);
  assert.equal(
    JSON.stringify(result).includes("private_adapter_response"),
    false,
  );
  assert.equal(
    result.bound_artifacts.execution_payload_digest.length,
    64,
  );
});

test("repeated and concurrent identical PASS calls consume one deterministic grant", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const handler = createMastraVendorPaymentHandler({
    now: () => new Date(FIXED),
    executePayment: async () => {
      calls += 1;
      await pending;
      return {
        execution_id: "mastra-sim-once",
        status: "SIMULATED_ACCEPTED",
      };
    },
  });

  const firstPromise = handler(structuredClone(PASS_INPUT), context());
  const replay = await handler(structuredClone(PASS_INPUT), context());
  release();
  const first = await firstPromise;
  const sequentialReplay = await handler(
    structuredClone(PASS_INPUT),
    context(),
  );

  assert.equal(calls, 1);
  assert.equal(first.execution.grant_consumed, true);
  assert.equal(replay.execution.replay_blocked, true);
  assert.equal(replay.execution.eligibility, "REPLAY_BLOCKED");
  assert.equal(sequentialReplay.execution.replay_blocked, true);
});

test("handler-level schema rejects negative amounts and trusted-field overrides", async () => {
  let calls = 0;
  const handler = createMastraVendorPaymentHandler({
    now: () => new Date(FIXED),
    executePayment: async () => {
      calls += 1;
    },
  });
  await assert.rejects(
    () =>
      handler(
        {
          ...structuredClone(PASS_INPUT),
          amount_cents: -1,
        },
        context(),
      ),
    /positive safe integer/,
  );
  await assert.rejects(
    () =>
      handler(
        {
          ...structuredClone(PASS_INPUT),
          execution_target: "attacker-controlled-adapter",
        },
        context(),
      ),
    /closed schema/,
  );
  await assert.rejects(
    () =>
      handler(
        {
          ...structuredClone(PASS_INPUT),
          authorization_context: {
            tenant_id: "attacker",
          },
        },
        context(),
      ),
    /closed schema/,
  );
  assert.equal(calls, 0);
});

test("Mastra-shaped boundary fails closed without trusted request identity", async () => {
  const handler = createMastraVendorPaymentHandler({
    now: () => new Date(FIXED),
  });
  await assert.rejects(
    () => handler(structuredClone(PASS_INPUT)),
    /Authenticated tenant, user, and workflow run context/,
  );
});

test("handler binds the first authenticated subject into the authorization instance", async () => {
  let calls = 0;
  const handler = createMastraVendorPaymentHandler({
    now: () => new Date(FIXED),
    executePayment: async () => {
      calls += 1;
      return {
        execution_id: "subject-bound-1",
        status: "SIMULATED_ACCEPTED",
      };
    },
  });
  const first = await handler(structuredClone(PASS_INPUT), context());
  const differentTenant = await handler(structuredClone(PASS_INPUT), {
    requestContext: {
      get: (name) =>
        ({
          tenantId: "tenant-attacker",
          userId: "user-1",
          workflowRunId: "run-2",
        })[name],
    },
  });
  assert.equal(first.status, "PASS");
  assert.equal(differentTenant.status, "BLOCK");
  assert.equal(
    differentTenant.blocking_failures.some(
      ({ id }) => id === "authorization_subject",
    ),
    true,
  );
  assert.equal(calls, 1);
});

test("forged bank-detail evidence produces BLOCK and never reaches submission", async () => {
  let calls = 0;
  const handler = createMastraVendorPaymentHandler({
    now: () => new Date(FIXED),
    collectEvidence: async (proposal, options) => {
      const { collectPartnerDemoEvidence } = await import(
        "../src/partner-demo.js"
      );
      return {
        ...collectPartnerDemoEvidence(proposal, options),
        bank_account_fingerprint: "sha256:attacker-bank",
        bank_details_changed: true,
      };
    },
    executePayment: async () => {
      calls += 1;
    },
  });
  const result = await handler(structuredClone(PASS_INPUT), context());
  assert.equal(result.status, "BLOCK");
  assert.equal(
    result.blocking_failures.some(
      ({ id }) => id === "bank_details_unchanged",
    ),
    true,
  );
  assert.equal(result.execution.adapter_invoked, false);
  assert.equal(calls, 0);
});

test("stale server evidence blocks before payment submission", async () => {
  let calls = 0;
  const handler = createMastraVendorPaymentHandler({
    now: () => new Date(FIXED),
    collectEvidence: async (proposal, options) => {
      const { collectPartnerDemoEvidence } = await import(
        "../src/partner-demo.js"
      );
      return {
        ...collectPartnerDemoEvidence(proposal, options),
        collected_at: new Date(
          FIXED.getTime() - 10 * 60 * 1000,
        ).toISOString(),
      };
    },
    executePayment: async () => {
      calls += 1;
    },
  });
  const result = await handler(structuredClone(PASS_INPUT), context());
  assert.equal(result.status, "BLOCK");
  assert.equal(
    result.blocking_failures.some(
      ({ id }) => id === "evidence_freshness",
    ),
    true,
  );
  assert.equal(calls, 0);
});

test("ambiguous adapter failure consumes grant and requires reconciliation instead of retry", async () => {
  let calls = 0;
  const handler = createMastraVendorPaymentHandler({
    now: () => new Date(FIXED),
    executePayment: async () => {
      calls += 1;
      throw new Error("timeout after unknown submission");
    },
  });
  const first = await handler(structuredClone(PASS_INPUT), context());
  const replay = await handler(structuredClone(PASS_INPUT), context());
  assert.equal(calls, 1);
  assert.equal(
    first.execution.submission_state,
    "UNKNOWN_REQUIRES_RECONCILIATION",
  );
  assert.equal(replay.execution.replay_blocked, true);
});

test("Mastra demo keeps BLOCK and REVIEW outside the executor and labels runtime honestly", async () => {
  let calls = 0;
  for (const scenario of ["block", "review"]) {
    const record = await runMastraPartnerDemo({
      scenario,
      now: () => new Date(FIXED),
      executePayment: async () => {
        calls += 1;
      },
    });
    assert.equal(record.decision.decision, scenario.toUpperCase());
    assert.equal(record.receipt_verification.artifact_verified, true);
    assert.equal(record.execution.adapter_invoked, false);
    assert.equal(record.agent.model_controls_execution, false);
    assert.equal(record.mastra.runtime_exercised, false);
  }
  assert.equal(calls, 0);
});

test("one bundle presents PASS, BLOCK, and REVIEW with explicit non-integration claims", async () => {
  const bundle = await runMastraPartnerBundle({
    now: () => new Date(FIXED),
  });
  assert.deepEqual(
    bundle.outcomes.map(({ decision }) => decision),
    ["PASS", "BLOCK", "REVIEW"],
  );
  assert.equal(bundle.claims.mastra_runtime_exercised, false);
  assert.equal(bundle.claims.brex_contacted, false);
  assert.equal(bundle.claims.money_moved, false);
});

test("Mastra demo rejects unknown scenarios before boundary execution", async () => {
  await assert.rejects(
    () => runMastraPartnerDemo({ scenario: "maybe" }),
    /exactly pass, block, or review/,
  );
});
