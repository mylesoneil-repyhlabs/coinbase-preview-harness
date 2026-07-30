import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoinbaseSolution,
  COINBASE_SPOT_POLICY_SOURCE,
  createOrchestratorMandateAdapter,
  createSimulatedMandateAdapter,
  evaluateMandateCandidate,
  parseCoinbaseSolution,
  runMandateAttemptLoop,
  toDeltaWireAttributes,
} from "../src/mandate/index.js";
import { canonicalize, digest, digestBytes } from "../src/evidence.js";
import { createExecutionPlan } from "../src/plan.js";
import { simulateExecution } from "../src/simulator.js";
import { compileDeterministicIntent } from "../src/intent-compiler.js";
import { createCanonicalSpotAction } from "../src/spot-action.js";

const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization expires 2 minutes after I confirm it.";
const FIXED_NOW = new Date("2026-07-23T18:00:00.000Z");
const TEST_VERIFIER_OPTIONS = {
  verifierIdentity: "test-verifier-key-1",
  proofProgramId: "test-sp1-program-1",
  proofVerifier: {
    verifyProofArtifact: async ({
      proof,
      verifierIdentity,
      proofProgramId,
    }) => ({
      verified: true,
      cryptographically_verified: true,
      method: "TEST_PINNED_SP1_VERIFIER",
      verifier_identity: verifierIdentity,
      program_id: proofProgramId,
      proof_digest: digest(proof),
    }),
  },
};

function mandateFixture() {
  const policy = compileDeterministicIntent(INTENT).policy;
  const actionDescriptor = createCanonicalSpotAction(policy);
  const previewRequest = {
    product_id: "ETH-USDC",
    side: "BUY",
    order_configuration: {
      sor_limit_ioc: {
        quote_size: "5.00",
        limit_price: "3015.00",
      },
    },
  };
  const createPayload = {
    client_order_id: "client-1",
    ...previewRequest,
    preview_id: "preview-1",
  };
  const createPayloadSerialized = JSON.stringify(createPayload);
  const market = {
    product_id: "ETH-USDC",
    product_type: "SPOT",
    status: "online",
    base_asset: "ETH",
    quote_asset: "USDC",
    base_increment: "0.00000001",
    quote_increment: "0.01",
    price_increment: "0.01",
    base_min_size: "0.00000001",
    base_max_size: "1000000",
    quote_min_size: "0.01",
    quote_max_size: "10000000",
    best_bid: "2999.00",
    best_ask: "3000.00",
    observed_at: FIXED_NOW.toISOString(),
    product_flags: {
      trading_disabled: false,
      is_disabled: false,
      view_only: false,
      cancel_only: false,
      limit_only: false,
      post_only: false,
      auction_mode: false,
    },
  };
  const preview = {
    preview_id: "preview-1",
    est_average_filled_price: "3010.00",
    commission_total: "0.25",
    order_total: "5.25",
    quote_size: "5.00",
    base_size: "0.00166113",
    best_bid: "2999.00",
    best_ask: "3000.00",
    errs: [],
    warning: [],
  };
  const collectedAt = FIXED_NOW.toISOString();
  const fundingUnsigned = {
    schema_version: "delta.coinbase.funding_evidence.v2",
    portfolio_fingerprint: "portfolio-1",
    funding_asset: "USDC",
    required_available: "5.50",
    available_balance: "10",
    account_fingerprints: [digest("account-usdc")],
    complete: true,
  };
  const funding = {
    ...fundingUnsigned,
    evidence_digest: digest(fundingUnsigned),
  };
  const evaluationRequest = {
    schema_version: "delta.coinbase.evaluation_request.v2",
    action_descriptor: actionDescriptor,
    create_payload: createPayload,
    create_payload_serialized: createPayloadSerialized,
    create_payload_digest: digestBytes(createPayloadSerialized),
    preview_request: previewRequest,
    preview_request_digest: digest(previewRequest),
    evidence: {
      market,
      preview,
      funding,
      collected_at: collectedAt,
    },
    evidence_digest: digest({
      market,
      preview,
      funding,
      collected_at: collectedAt,
    }),
    credential_binding: {
      portfolio_fingerprint: "portfolio-1",
      credential_fingerprint: "credential-1",
    },
  };
  const parameters = {
    product_id: "ETH-USDC",
    base_asset: "ETH",
    quote_asset: "USDC",
    side: "BUY",
    size_field: "quote_size",
    size_operator: "EXACT",
    size_value: "5.00",
    funding_asset: "USDC",
    max_slippage_bps: 50,
    max_commission_value: "0.50",
    settlement_kind: "MAX_QUOTE_DEBIT",
    settlement_value: "5.50",
    market_condition_reference: "NONE",
    market_condition_operator: "NONE",
    market_condition_value: "0",
    action_descriptor_digest: actionDescriptor.descriptor_digest,
    portfolio_fingerprint: "portfolio-1",
    credential_fingerprint: "credential-1",
    expires_at_epoch_ms: FIXED_NOW.getTime() + 120_000,
  };
  const proofEvidenceBindings = {
    product_id: parameters.product_id,
    action_descriptor_digest: actionDescriptor.descriptor_digest,
    authorized_limit_price: "3015.00",
    funding_evidence_digest: funding.evidence_digest,
    preview_id: preview.preview_id,
    create_payload_digest: evaluationRequest.create_payload_digest,
    preview_request_digest: evaluationRequest.preview_request_digest,
    portfolio_fingerprint: parameters.portfolio_fingerprint,
    credential_fingerprint: parameters.credential_fingerprint,
  };
  return {
    evaluationRequest,
    parameters,
    proofEvidenceBindings,
    solution: buildCoinbaseSolution(evaluationRequest),
  };
}

function createPreparedSimulatedAdapter(options) {
  const adapter = createSimulatedMandateAdapter(options);
  adapter.prepareProposal = async ({ actionRecord }) => ({
    solution: buildCoinbaseSolution(actionRecord),
  });
  return adapter;
}

test("simulated adapter follows the policy-intent-proposal-verifier lifecycle", async () => {
  const {
    evaluationRequest,
    parameters,
    proofEvidenceBindings,
    solution,
  } = mandateFixture();
  const result = await evaluateMandateCandidate({
    adapter: createPreparedSimulatedAdapter({ now: () => FIXED_NOW }),
    policySource: COINBASE_SPOT_POLICY_SOURCE,
    parameters,
    actionRecord: evaluationRequest,
    authorization: { confirmed: true },
    proofEvidenceBindings,
    pollIntervalMs: 1,
  });

  assert.equal(result.status, "success");
  assert.equal(result.verified, true);
  assert.equal(result.proposal.solution, solution);
  assert.equal(result.proof.proposal.solution, solution);
  assert.equal(result.proof.signed_intent.intent.id, result.intent_id);
  assert.equal(result.proof.signed_intent.intent.policy_id, result.policy_id);
  assert.deepEqual(
    result.proof.signed_intent.intent.attrs,
    toDeltaWireAttributes(parameters),
  );
  assert.equal(result.proof_verification.cryptographically_verified, false);
  assert.equal(result.receipt.receipt_integrity, "LOCAL_SHA256_DIGEST");
});

test("simulated adapter returns indexed terminal constraint failures", async () => {
  const {
    evaluationRequest,
    parameters,
    proofEvidenceBindings,
  } = mandateFixture();
  const result = await evaluateMandateCandidate({
    adapter: createPreparedSimulatedAdapter({ now: () => FIXED_NOW }),
    policySource: COINBASE_SPOT_POLICY_SOURCE,
    parameters: { ...parameters, product_id: "BTC-USDC" },
    actionRecord: evaluationRequest,
    authorization: { confirmed: true },
    proofEvidenceBindings,
    pollIntervalMs: 1,
  });

  assert.equal(result.status, "failure");
  assert.equal(result.verified, false);
  assert.equal(result.proof, null);
  assert.deepEqual(
    result.constraint_failures.map(({ index }) => index),
    [3],
  );
  assert.match(result.constraint_failures[0].pretty_expr, /product_id/);
});

test("Delta REVIEW is terminal, bound, and never carries an execution proof", async () => {
  const {
    evaluationRequest,
    parameters,
    proofEvidenceBindings,
  } = mandateFixture();
  const adapter = createPreparedSimulatedAdapter({ now: () => FIXED_NOW });
  const getStatus = adapter.getStatus.bind(adapter);
  adapter.getStatus = async (input) => {
    const status = await getStatus(input);
    return {
      status: "review",
      intent_id: input.intentId,
      proposal: status.proposal,
      reason: "trusted evidence requires human review",
      constraint_failures: [],
    };
  };

  const result = await evaluateMandateCandidate({
    adapter,
    policySource: COINBASE_SPOT_POLICY_SOURCE,
    parameters,
    actionRecord: evaluationRequest,
    authorization: { confirmed: true },
    proofEvidenceBindings,
    pollIntervalMs: 1,
  });

  assert.equal(result.status, "review");
  assert.equal(result.decision, "REVIEW");
  assert.equal(result.verified, false);
  assert.equal(result.proof, null);
  assert.equal(result.receipt.decision, "REVIEW");
  assert.equal(
    result.receipt.exact_payload_digest,
    evaluationRequest.create_payload_digest,
  );
});

test("verified success still fails closed when proof evidence is not bound to the outgoing bytes", async () => {
  const {
    parameters,
    evaluationRequest,
    proofEvidenceBindings,
  } = mandateFixture();
  const adapter = createPreparedSimulatedAdapter({ now: () => FIXED_NOW });
  const getProof = adapter.getProof.bind(adapter);
  adapter.getProof = async (input) => {
    const proof = await getProof(input);
    proof.evidence.fields.create_payload_digest = { String: "tampered" };
    return proof;
  };

  await assert.rejects(
    () =>
      evaluateMandateCandidate({
        adapter,
        policySource: COINBASE_SPOT_POLICY_SOURCE,
        parameters,
        actionRecord: evaluationRequest,
        authorization: { confirmed: true },
        proofEvidenceBindings: {
          ...proofEvidenceBindings,
        },
        pollIntervalMs: 1,
      }),
    /proof evidence create_payload_digest/,
  );
});

test("production success requires the complete Coinbase proof binding set", async () => {
  const { evaluationRequest, parameters, proofEvidenceBindings } =
    mandateFixture();
  const { credential_fingerprint: _omitted, ...incomplete } =
    proofEvidenceBindings;

  await assert.rejects(
    () =>
      evaluateMandateCandidate({
        adapter: createPreparedSimulatedAdapter({ now: () => FIXED_NOW }),
        policySource: COINBASE_SPOT_POLICY_SOURCE,
        parameters,
        actionRecord: evaluationRequest,
        authorization: { confirmed: true },
        proofEvidenceBindings: incomplete,
        pollIntervalMs: 1,
      }),
    /must contain exactly/,
  );
});

test("production success requires nonempty SP1 proof material", async () => {
  const { evaluationRequest, parameters, proofEvidenceBindings } =
    mandateFixture();
  const adapter = createPreparedSimulatedAdapter({ now: () => FIXED_NOW });
  const getProof = adapter.getProof.bind(adapter);
  adapter.getProof = async (input) => {
    const proof = await getProof(input);
    proof.sp1_proof = "";
    return proof;
  };

  await assert.rejects(
    () =>
      evaluateMandateCandidate({
        adapter,
        policySource: COINBASE_SPOT_POLICY_SOURCE,
        parameters,
        actionRecord: evaluationRequest,
        authorization: { confirmed: true },
        proofEvidenceBindings,
        pollIntervalMs: 1,
      }),
    /nonempty sp1_proof/,
  );
});

test("verifier outcome attrs must match the exact authorized wire attrs", async () => {
  const { evaluationRequest, parameters, proofEvidenceBindings } =
    mandateFixture();
  const adapter = createPreparedSimulatedAdapter({ now: () => FIXED_NOW });
  const getVerificationOutcome =
    adapter.getVerificationOutcome.bind(adapter);
  adapter.getVerificationOutcome = async (input) => {
    const verification = await getVerificationOutcome(input);
    verification.intent.attrs.fields.product_id = { String: "BTC-USDC" };
    return verification;
  };

  await assert.rejects(
    () =>
      evaluateMandateCandidate({
        adapter,
        policySource: COINBASE_SPOT_POLICY_SOURCE,
        parameters,
        actionRecord: evaluationRequest,
        authorization: { confirmed: true },
        proofEvidenceBindings,
        pollIntervalMs: 1,
      }),
    /outcome intent attributes/,
  );
});

test("Proof SignedIntent attrs must match the exact authorized wire attrs", async () => {
  const { evaluationRequest, parameters, proofEvidenceBindings } =
    mandateFixture();
  const adapter = createPreparedSimulatedAdapter({ now: () => FIXED_NOW });
  const getProof = adapter.getProof.bind(adapter);
  adapter.getProof = async (input) => {
    const proof = await getProof(input);
    proof.signed_intent.intent.attrs.fields.product_id = {
      String: "BTC-USDC",
    };
    return proof;
  };

  await assert.rejects(
    () =>
      evaluateMandateCandidate({
        adapter,
        policySource: COINBASE_SPOT_POLICY_SOURCE,
        parameters,
        actionRecord: evaluationRequest,
        authorization: { confirmed: true },
        proofEvidenceBindings,
        pollIntervalMs: 1,
      }),
    /proof SignedIntent attributes/i,
  );
});

test("Coinbase solution parsing rejects a canonical envelope with tampered action bytes", () => {
  const { solution } = mandateFixture();
  const marker = "?envelope=";
  const markerAt = solution.indexOf(marker);
  const prefix = solution.slice(0, markerAt + marker.length);
  const encoded = solution.slice(markerAt + marker.length);
  const envelope = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  );
  envelope.create_payload.side = "SELL";
  const tampered = `${prefix}${Buffer.from(canonicalize(envelope)).toString("base64url")}`;

  assert.throws(
    () => parseCoinbaseSolution(tampered),
    /Create payload bytes mismatch/,
  );
});

test("deterministic controller retries only constraint failures and executes once on verified success", async () => {
  let executions = 0;
  const result = await runMandateAttemptLoop({
    maxAttempts: 3,
    propose: async ({ attempt }) => ({ id: `candidate-${attempt}` }),
    evaluate: async (_candidate, attempt) =>
      attempt === 1
        ? {
            status: "failure",
            verified: false,
            constraint_failures: [{ index: 9, reason: "wrong size" }],
          }
        : {
            status: "success",
            verified: true,
            constraint_failures: [],
            proof: { verified: true },
            proof_verification: { verified: true },
          },
    execute: async (candidate) => {
      executions += 1;
      return { order: candidate.id };
    },
  });

  assert.equal(result.status, "EXECUTED");
  assert.equal(executions, 1);
  assert.deepEqual(
    result.attempts.map(({ disposition }) => disposition),
    ["RETRY", "EXECUTE"],
  );
  assert.deepEqual(result.execution, { order: "candidate-2" });
});

test("deterministic controller collects evidence outside the proposal callback", async () => {
  let proposalSeenByCollector;
  const result = await runMandateAttemptLoop({
    maxAttempts: 1,
    propose: async () => ({ id: "candidate-1", exact_action: { amount: "1" } }),
    collectEvidence: async ({ proposal }) => {
      proposalSeenByCollector = structuredClone(proposal);
      return {
        ...proposal,
        evidence: { source: "controller-owned" },
      };
    },
    evaluate: async (candidate) => ({
      status: "success",
      verified: true,
      constraint_failures: [],
      proof: { evidence_source: candidate.evidence.source },
      proof_verification: { verified: true },
    }),
    execute: async (candidate) => ({ evidence: candidate.evidence }),
  });

  assert.deepEqual(proposalSeenByCollector, {
    id: "candidate-1",
    exact_action: { amount: "1" },
  });
  assert.equal(Object.hasOwn(proposalSeenByCollector, "evidence"), false);
  assert.deepEqual(result.execution, {
    evidence: { source: "controller-owned" },
  });
});

test("deterministic controller maps a failed final attempt to STOP, not RETRY", async () => {
  const result = await runMandateAttemptLoop({
    maxAttempts: 2,
    propose: async ({ attempt }) => ({ id: `candidate-${attempt}` }),
    evaluate: async () => ({
      status: "failure",
      verified: false,
      constraint_failures: [{ index: 0, reason: "still outside mandate" }],
    }),
    execute: async () => {
      throw new Error("must remain locked");
    },
  });

  assert.equal(result.status, "STOPPED");
  assert.deepEqual(
    result.attempts.map(({ disposition }) => disposition),
    ["RETRY", "STOP"],
  );
  assert.equal(result.execution, null);
});

test("deterministic controller stops without execution on a non-constraint failure", async () => {
  let executions = 0;
  const result = await runMandateAttemptLoop({
    propose: async () => ({ id: "candidate-1" }),
    evaluate: async () => ({
      status: "expired",
      verified: false,
      constraint_failures: [],
    }),
    execute: async () => {
      executions += 1;
    },
  });

  assert.equal(result.status, "STOPPED");
  assert.equal(executions, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].disposition, "STOP");
});

test("deterministic controller cannot execute a claimed success without a proof", async () => {
  let executions = 0;
  const result = await runMandateAttemptLoop({
    propose: async () => ({ id: "candidate-1" }),
    evaluate: async () => ({
      status: "success",
      verified: true,
      constraint_failures: [],
      proof: null,
    }),
    execute: async () => {
      executions += 1;
    },
  });

  assert.equal(result.status, "STOPPED");
  assert.equal(executions, 0);
  assert.equal(result.attempts[0].disposition, "STOP");
});

test("Orchestrator adapter maps the exact policy, intent, proposal, status, verifier, and proof APIs", async () => {
  const {
    evaluationRequest,
    parameters,
    proofEvidenceBindings,
  } = mandateFixture();
  const actionRecordDigest = digest(evaluationRequest);
  const solution =
    `coinbase-order://proposal/v1/${actionRecordDigest}`;
  const policyId = "policy-1";
  const intentId = "intent/with spaces";
  const signedIntent = {
    intent: {
      id: intentId,
      policy_id: policyId,
      attrs: toDeltaWireAttributes(parameters),
    },
    signature: { Delta: "signed" },
  };
  const calls = [];
  const respond = (value, status = 200) =>
    new Response(value == null ? null : JSON.stringify(value), { status });
  const fetchImpl = async (url, options) => {
    calls.push({
      url,
      method: options.method,
      headers: options.headers,
      body: options.body,
    });
    const parsed = new URL(url);
    if (parsed.pathname === "/policies") return respond(policyId);
    if (parsed.pathname === "/intents" && options.method === "POST") {
      return respond(null, 204);
    }
    if (parsed.pathname.endsWith("/proposal")) return respond(null, 204);
    if (
      parsed.origin === "https://orchestrator.example" &&
      parsed.pathname.endsWith("/status")
    ) {
      return respond({
        status: "success",
        intent_id: intentId,
        proposal: { solution },
        evidence: { fields: {} },
      });
    }
    if (
      parsed.origin === "https://verifier.example" &&
      parsed.pathname.startsWith("/intents/")
    ) {
      return respond({
        outcome: "success",
        intent: signedIntent.intent,
        proposal: { solution },
      });
    }
    if (
      parsed.origin === "https://verifier.example" &&
      parsed.pathname.startsWith("/proofs/")
    ) {
      return respond({
        sp1_proof: "proof",
        evidence: toDeltaWireAttributes(proofEvidenceBindings),
        signed_intent: signedIntent,
        proposal: { solution },
      });
    }
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };
  let signerInput;
  let registeredActionRecord;
  const adapter = createOrchestratorMandateAdapter({
    orchestratorUrl: "https://orchestrator.example",
    verifierUrl: "https://verifier.example",
    orchestratorBearerToken: "orchestrator-test-token",
    verifierBearerToken: "verifier-test-token",
    signer: {
      signIntent: async (input) => {
        signerInput = input;
        return { intentId, signedIntent };
      },
    },
    actionRegistry: {
      registerAction: async (actionRecord) => {
        registeredActionRecord = actionRecord;
        return {
          solution,
          action_record_digest: actionRecordDigest,
        };
      },
    },
    ...TEST_VERIFIER_OPTIONS,
    fetchImpl,
  });

  const result = await evaluateMandateCandidate({
    adapter,
    policySource: COINBASE_SPOT_POLICY_SOURCE,
    parameters,
    actionRecord: evaluationRequest,
    authorization: { approved_by: "test" },
    proofEvidenceBindings,
    pollIntervalMs: 1,
  });

  assert.equal(result.verified, true);
  assert.equal(result.proof_verification.cryptographically_verified, true);
  assert.equal(
    result.receipt.artifact_class,
    "DELTA_VERIFIER_ATTESTED_CONTRACT",
  );
  assert.deepEqual(signerInput, {
    policyId,
    parameters,
    authorization: { approved_by: "test" },
  });
  assert.deepEqual(registeredActionRecord, evaluationRequest);
  assert.deepEqual(
    calls.map(({ method, url }) => [method, url]),
    [
      ["POST", "https://orchestrator.example/policies"],
      ["POST", "https://orchestrator.example/intents"],
      [
        "POST",
        "https://orchestrator.example/intents/intent%2Fwith%20spaces/proposal",
      ],
      [
        "GET",
        "https://orchestrator.example/intents/intent%2Fwith%20spaces/status",
      ],
      [
        "GET",
        "https://verifier.example/intents/intent%2Fwith%20spaces",
      ],
      [
        "GET",
        "https://verifier.example/proofs/intent%2Fwith%20spaces",
      ],
    ],
  );
  assert.equal(calls[0].headers["Content-Type"], "text/plain");
  assert.equal(calls[0].body, COINBASE_SPOT_POLICY_SOURCE);
  assert.equal(calls[1].body, JSON.stringify(signedIntent));
  assert.equal(calls[2].body, JSON.stringify({ solution }));
  assert.ok(
    calls
      .slice(0, 4)
      .every(
        ({ headers }) =>
          headers.Authorization === "Bearer orchestrator-test-token",
      ),
  );
  assert.ok(
    calls
      .slice(4)
      .every(
        ({ headers }) =>
          headers.Authorization === "Bearer verifier-test-token",
      ),
  );
});

test("Orchestrator adapter requires independent origins and credentials", () => {
  const signer = { signIntent: async () => null };
  const actionRegistry = {
    registerAction: async () => ({ solution: "coinbase-order://proposal/1" }),
  };
  assert.throws(
    () =>
      createOrchestratorMandateAdapter({
        orchestratorUrl: "https://delta.example/orchestrator",
        verifierUrl: "https://delta.example/verifier",
        signer,
        actionRegistry,
        ...TEST_VERIFIER_OPTIONS,
      }),
    /distinct origins/,
  );
  assert.throws(
    () =>
      createOrchestratorMandateAdapter({
        orchestratorUrl: "https://orchestrator.example",
        verifierUrl: "https://verifier.example",
        signer,
        actionRegistry,
        ...TEST_VERIFIER_OPTIONS,
        bearerToken: "shared-token",
      }),
    /shared bearerToken/,
  );
  assert.throws(
    () =>
      createOrchestratorMandateAdapter({
        orchestratorUrl: "https://orchestrator.example",
        verifierUrl: "https://verifier.example",
        signer,
        actionRegistry,
        ...TEST_VERIFIER_OPTIONS,
        orchestratorBearerToken: "same-token",
        verifierBearerToken: "same-token",
      }),
    /must be distinct/,
  );
});

test("Orchestrator adapter rejects an action registry without an opaque solution", async () => {
  const adapter = createOrchestratorMandateAdapter({
    orchestratorUrl: "https://orchestrator.example",
    verifierUrl: "https://verifier.example",
    signer: { signIntent: async () => null },
    actionRegistry: {
      registerAction: async () => ({ solution: "" }),
    },
    ...TEST_VERIFIER_OPTIONS,
  });

  await assert.rejects(
    () => adapter.prepareProposal({ actionRecord: { id: "frozen-action" } }),
    /content-addressed proposal solution/,
  );
});

test("Orchestrator adapter requires a pinned cryptographic proof verifier", () => {
  assert.throws(
    () =>
      createOrchestratorMandateAdapter({
        orchestratorUrl: "https://orchestrator.example",
        verifierUrl: "https://verifier.example",
        signer: { signIntent: async () => null },
        actionRegistry: {
          registerAction: async () => ({
            solution: "coinbase-order://proposal/v1/test",
          }),
        },
      }),
    /cryptographic proof verifier/,
  );
});

test("simulation proof verifier rejects arbitrary nonempty proof material", async () => {
  const adapter = createSimulatedMandateAdapter();
  await assert.rejects(
    adapter.verifyProofArtifact({
      proof: {
        sp1_proof: "arbitrary-nonempty-text",
        signed_intent: {
          signature: { Simulated: "NOT_A_REAL_DELTA_SIGNATURE" },
        },
      },
    }),
    /explicit placeholder proof/,
  );
});

test("production proof verification is pinned to verifier identity and program", async () => {
  const adapter = createOrchestratorMandateAdapter({
    orchestratorUrl: "https://orchestrator.example",
    verifierUrl: "https://verifier.example",
    signer: { signIntent: async () => null },
    actionRegistry: { registerAction: async () => null },
    verifierIdentity: "pinned-verifier",
    proofProgramId: "pinned-program",
    proofVerifier: {
      verifyProofArtifact: async ({ proof }) => ({
        verified: true,
        cryptographically_verified: true,
        method: "TEST_VERIFIER",
        verifier_identity: "attacker-verifier",
        program_id: "attacker-program",
        proof_digest: digest(proof),
      }),
    },
  });
  await assert.rejects(
    adapter.verifyProofArtifact({ proof: { sp1_proof: "proof" } }),
    /misbound the proof artifact/,
  );
});

test("full simulator uses the replaceable Orchestrator-and-Verifier mandate surface", async () => {
  const plan = await createExecutionPlan(INTENT);
  const record = await simulateExecution(plan, plan.policy_digest);

  assert.equal(record.artifact_class, "SIMULATED");
  assert.equal(record.status, "EXECUTION_ELIGIBLE");
  assert.equal(record.delta.surface, "delta_orchestrator_and_verifier");
  assert.equal(record.delta.adapter, "simulated-delta-mandate");
  assert.equal(record.delta.status, "success");
  assert.equal(record.delta.verifier_confirmed, true);
  assert.equal(record.delta.proof_present, true);
  assert.match(record.delta.policy_id, /^sim-policy-/);
  assert.match(record.delta.intent_id, /^[0-9a-f-]{36}$/);
});
