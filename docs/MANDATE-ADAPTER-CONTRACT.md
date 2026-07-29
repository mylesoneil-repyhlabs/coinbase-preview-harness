# Delta Mandate adapter contract

Delta Coinbase Guard v1.4 has one application boundary between the Coinbase
controller and Delta. The simulation adapter and a future production adapter
implement the same eight-operation port:

```js
{
  submitPolicy(source),
  authorizeIntent({ policyId, parameters, authorization }),
  prepareProposal({ actionRecord }),
  submitProposal({ intentId, solution }),
  getStatus({ intentId }),
  getVerificationOutcome({ intentId }),
  getProof({ intentId }),
  verifyProofArtifact({ proof, intentId, policyId, solution, expectedAttrs, evidenceBindings })
}
```

The shape is enforced in `src/mandate/contract.js`. Deterministic result,
receipt, and controller logic live in `src/mandate/controller.js`.

This is intentionally narrower than the private Delta implementation. The
public Repyh Labs organization does not expose the code needed to confirm its
policy syntax, endpoints, status vocabulary, signed-intent format, verifier, or
proof program. The checked-in HTTP adapter is a production-shaped integration
hypothesis, not evidence that private Delta exposes those exact interfaces.

## Operation semantics

| Operation | Required application behavior |
| --- | --- |
| `submitPolicy` | Compile or register the pinned Coinbase SPOT v3 policy and return its content-bound ID |
| `authorizeIntent` | Obtain authenticated user authorization, sign the exact policy and typed parameters, and return the assigned intent ID |
| `prepareProposal` | Store the frozen action record in an authenticated append-only registry and return its content-addressed locator |
| `submitProposal` | Submit exactly that locator for the authorized intent |
| `getStatus` | Return evaluation state and the exact proposal when required |
| `getVerificationOutcome` | Return an operationally independent outcome bound to the same intent and proposal |
| `getProof` | Return proof material binding signed intent, proposal, and required Coinbase evidence |
| `verifyProofArtifact` | Cryptographically verify the exact proof with a pinned verifier identity and proof program, then return a bound attestation |

`authorizeIntent` and `prepareProposal` are application operations and need not
map one-for-one to Delta HTTP endpoints.

## Checked-in HTTP hypothesis

`OrchestratorMandateAdapter` models:

```text
POST /policies
POST /intents
POST /intents/{id}/proposal
GET  /intents/{id}/status
GET  {independent-verifier}/intents/{id}
GET  {independent-verifier}/proofs/{id}
```

It requires HTTPS except for loopback development, distinct Orchestrator and
Verifier origins, separate credentials, an injected signer, an authenticated
action registry, an injected cryptographic proof verifier, a pinned verifier
identity, a pinned proof program ID, and bounded response time and size.

The adapter rejects a proof-verifier response unless it says all of:

- `verified: true`;
- `cryptographically_verified: true`;
- the exact configured verifier identity;
- the exact configured program ID; and
- the digest of the exact proof object supplied by the controller.

Engineering must validate or replace the wire mapping against private Delta
clients. Do not weaken the surrounding bindings to fit a different transport.

## Status and decision contract

The controller recognizes:

```text
open
processing { proposal }
success    { intent_id, proposal, evidence }
failure    { intent_id, reason, proposal, evidence?, constraint_failures[] }
review     { intent_id, reason, proposal, evidence? }
expired    { intent_id }
```

Unexpected status, malformed state, timeout, or transport failure stops
fail-closed.

- `PASS` requires local Coinbase checks plus terminal Delta success, matching
  independent outcome, exact proof bindings, and a successful proof-verifier
  attestation.
- `BLOCK` represents a deterministic constraint failure, Preview error,
  terminal Delta failure, or expiry.
- `REVIEW` represents a Preview warning or a bound terminal adapter review.

A Preview warning stops before Delta. Infrastructure, verifier, cryptography,
schema, and binding errors are hard stops, not `REVIEW` and never `PASS`.

The adapter `review` state is an application-contract state. It is not a claim
that private Delta currently exposes that native vocabulary.

## Exact PASS predicate

Execution disposition is possible only after all of these hold:

1. evaluation status is `success`;
2. status intent ID and proposal match the authorized intent and submitted
   solution;
3. independent verification outcome is `success`;
4. verifier intent ID, policy ID, typed attributes, and proposal match;
5. proof material exists and its signed intent and proposal match;
6. every required Coinbase proof-evidence binding matches the frozen record;
7. `verifyProofArtifact` verifies the exact proof digest; and
8. for production, its attestation is cryptographic and matches the pinned
   verifier identity and program ID.

The proof binding set is exactly:

```text
product_id
action_descriptor_digest
authorized_limit_price
funding_evidence_digest
preview_id
create_payload_digest
preview_request_digest
portfolio_fingerprint
credential_fingerprint
```

Any missing, extra, empty, malformed, or mismatched binding stops.

## Simulation proof boundary

`SimulatedMandateAdapter` has `securityClass: "simulation-only"`. It emits only
the explicit placeholders:

```text
sp1_proof = SIMULATED_NO_SP1_PROOF
signature = NOT_A_REAL_DELTA_SIGNATURE
```

Its `verifyProofArtifact` method rejects arbitrary proof content and returns:

```text
verified: true
cryptographically_verified: false
method: SIMULATED_BINDING_CHECK_ONLY
verifier_identity: SIMULATED_LOCAL_TEST_DOUBLE
program_id: null
```

That attestation means the local test double checked its exact placeholder and
artifact bindings. It is not SP1 verification, a trusted identity, a Coinbase
attestation, or a production Delta proof.

## Action registry and receipt

Production `prepareProposal` requires:

```text
coinbase-order://proposal/v1/{sha256-of-canonical-action-record}
```

The trusted registry must recompute the record digest, store the record
append-only, and return that same digest and locator. The controller is the only
writer; the evidence service resolves it read-only. The agent cannot choose or
replace the locator.

The frozen action record is `delta.coinbase.evaluation_request.v2`. The
authorization-level action is `delta.coinbase.spot_action.v2`, and the policy
is `coinbase_spot_v3`.

Every structured result carries `delta.coinbase.decision_receipt.v3`, binding:

- decision, policy ID, and intent ID;
- action-descriptor and exact-payload digests;
- Preview request digest and Preview ID;
- funding, portfolio, credential, and full evidence bindings;
- indexed constraint failures;
- proof digest and proof-verification attestation; and
- a local receipt-integrity digest.

The simulation receipt is tamper-evident under local SHA-256 recomputation. It
is not signed and does not establish production source authenticity or
liability.

## Retry contract

`mandateDisposition` maps:

- verified `PASS` with proof attestation → internal `EXECUTE` branch;
- `BLOCK` with an explicit constraint failure and attempt remaining → `RETRY`;
  and
- everything else, including `REVIEW` → `STOP`.

In the public simulation, the internal `EXECUTE` branch consumes a one-use
in-memory gate and ends at `EXECUTION_ELIGIBLE`. It does not call an executor.

The checked-in controller supports bounded candidate attempts, but this
repository does not claim private Delta can reopen one authorized intent for
multiple proposals. Production must choose and test one lifecycle:

1. local refinement followed by one authoritative Delta proposal;
2. a fresh authenticated intent per candidate; or
3. an authenticated bounded-proposal window in Delta.

Uncertain Coinbase submission is reconciliation-only and is never retried as a
new Create.

## Public production-composition lock

`src/integration/production-composition.js` is the only build-time seam. The
public `loadProductionExecutionDependencies()` always throws
`ENGINEERING_INTEGRATION_REQUIRED`. No environment variable, plugin path,
command flag, credential, or simulation adapter can return the private
execution capability.

A reviewed internal composition must supply the real mandate adapter, pinned
proof verifier, durable grant operations, and the closure-held execution
capability. Do not replace that seam with an arbitrary runtime JavaScript
loader.

## Production acceptance tests

Before Create can be enabled, tests must cover:

- private-Delta v3 policy and typed parameter mapping, including `EXACT`,
  `MAX`, and optional market condition;
- authenticated user signing and immutable registry behavior;
- actual status, verifier, proof, verifier identity, and proof program shapes;
- all nine proof bindings and intentional tampering;
- BUY and SELL across multiple pairs and decimal precisions;
- held quote funds for BUY and held base funds for SELL;
- `PASS`, constraint `BLOCK`, Preview `REVIEW`, expiry, timeout, malformed
  proof, and verifier disagreement;
- selected bounded-retry semantics;
- transactional grant atomicity across processes and restart;
- exact serialized Create bytes and transport digest;
- uncertain-submission recovery by `client_order_id`; and
- proof that public builds and credentials cannot obtain the live capability.

Until those pass, credentialed Coinbase use ends at reads and Preview.
