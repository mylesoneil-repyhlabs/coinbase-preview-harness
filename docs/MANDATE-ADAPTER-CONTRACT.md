# Delta Mandate adapter contract

Delta Coinbase Guard v1.3 has one application boundary between the Coinbase
controller and Delta. Simulation and a future production integration implement
the same seven-operation port:

```js
{
  submitPolicy(source),
  authorizeIntent({ policyId, parameters, authorization }),
  prepareProposal({ actionRecord }),
  submitProposal({ intentId, solution }),
  getStatus({ intentId }),
  getVerificationOutcome({ intentId }),
  getProof({ intentId })
}
```

The shape is enforced in `src/mandate/contract.js`; the deterministic result and
receipt logic lives in `src/mandate/controller.js`.

This contract is intentionally narrower than the private Delta implementation.
The public Repyh Labs organization does not expose the code needed to confirm
actual policy syntax, endpoint paths, status vocabulary, signed-intent wire
format, or proof type. The HTTP mapping in
`src/mandate/orchestrator-adapter.js` is production-shaped integration code,
not evidence that private Delta currently exposes those exact interfaces.

## Operation semantics

| Port operation | Required application behavior |
| --- | --- |
| `submitPolicy(source)` | Compile/register the pinned Coinbase SPOT v1.3 policy and return its content-bound ID |
| `authorizeIntent(...)` | Obtain authenticated user authorization, sign the exact policy ID and typed parameters, submit it, and return the assigned intent ID |
| `prepareProposal(...)` | Store the frozen Coinbase action record in an authenticated append-only registry and return its content-addressed locator |
| `submitProposal(...)` | Submit exactly that locator for the authorized intent |
| `getStatus(...)` | Return the current evaluation state and the exact proposal when present |
| `getVerificationOutcome(...)` | Return an operationally independent verification result bound to the same intent and proposal |
| `getProof(...)` | Return proof material binding the signed intent, proposal, and required Coinbase evidence |

`authorizeIntent` and `prepareProposal` are application operations. They need
not correspond one-for-one to Delta HTTP endpoints. Production may use generated
clients or a different wire protocol while preserving this port.

## Checked-in HTTP hypothesis

The current `OrchestratorMandateAdapter` models:

```text
POST /policies
POST /intents
POST /intents/{id}/proposal
GET  /intents/{id}/status
GET  {independent-verifier}/intents/{id}
GET  {independent-verifier}/proofs/{id}
```

It requires:

- HTTPS except for loopback development;
- distinct Orchestrator and Verifier origins;
- no shared bearer-token argument;
- distinct nonempty tokens when both are configured;
- an injected signer;
- an injected action registry; and
- bounded request time and response size.

The signer result is rejected unless its intent ID, policy ID, and typed
attributes exactly match the caller's values.

Engineering must validate and, if necessary, replace the internal HTTP calls
against the actual private Delta clients. Do not weaken the surrounding
bindings to accommodate a different transport.

## Status contract

The controller recognizes:

```text
open
processing { proposal }
success    { intent_id, proposal, evidence }
failure    { intent_id, reason, proposal, evidence?, constraint_failures[] }
review     { intent_id, reason, proposal, evidence? }
expired    { intent_id }
```

`processing`, `success`, `failure`, and `review` must include the proposal.
Terminal states must carry the exact intent ID. `failure` must include a
`constraint_failures` array, which may be empty for a non-policy failure.

The current controller polls only until `success`, `failure`, `review`, or
`expired`. Unexpected status, malformed state, timeout, or transport failure
throws and stops fail-closed.

## PASS, BLOCK, and REVIEW

The v1.3 application has three decision values, but their sources are distinct:

- **PASS** — local Coinbase checks passed and Delta returned a terminal
  successful result with matching independent verification and proof.
- **BLOCK** — a deterministic proposal/Preview constraint failed, or Delta
  returned `failure` or `expired`.
- **REVIEW** — Coinbase Preview returned a warning after otherwise passing
  deterministic checks, or the Mandate adapter returned a bound terminal
  `review` state.

A Preview warning stops before Delta evaluation. The checked-in application
contract recognizes a terminal adapter `review` and emits a bound REVIEW
receipt without proof or execution eligibility. It does not claim that private
Delta currently has that native status; the mapping must be validated against
the actual runtime. Infrastructure, timeout, verifier, proof, or schema errors
are hard stops, not an authorization and not a reason to default to PASS.

## Exact success predicate

An adapter result is executable only after all of these hold:

1. the evaluation status is `success`;
2. the status intent ID matches the authorized intent;
3. the status proposal equals the submitted solution;
4. the independent verification outcome is `success`;
5. the verifier's intent ID, policy ID, and typed attributes match exactly;
6. the verifier's proposal equals the submitted solution;
7. proof material exists and its `sp1_proof` member is nonempty;
8. the proof's signed intent and proposal match the same artifacts; and
9. every required Coinbase proof-evidence binding matches the frozen action.

The binding set is exactly:

```text
product_id
action_descriptor_digest
funding_evidence_digest
preview_id
create_payload_digest
preview_request_digest
portfolio_fingerprint
credential_fingerprint
```

Any missing, extra, empty, malformed, stale, or mismatched field stops. The
local controller checks proof presence and artifact equality; it does not
cryptographically verify SP1 itself. Production requires an operationally
independent Verifier to perform the actual cryptographic check and return a
matching successful outcome.

## Action registry

`prepareProposal` computes `digest(actionRecord)`, then requires the trusted
registry to return:

```js
{
  solution: `coinbase-order://proposal/v1/${digest(actionRecord)}`,
  action_record_digest: digest(actionRecord)
}
```

The registry must be authenticated, append-only, and content-addressed. The
trusted controller is its only writer. The evidence service resolves it
read-only. The agent cannot choose a locator, replace a record, or make a
simulation envelope authoritative.

The action record is `delta.coinbase.evaluation_request.v2`; it binds the
authorized generic BUY/SELL action, held-funds evidence, one Coinbase Preview,
the exact prospective Create bytes, and all digests. See
[COINBASE-EVIDENCE-CONTRACT.md](COINBASE-EVIDENCE-CONTRACT.md).

## Decision receipt

Every structured Delta result carries
`delta.coinbase.decision_receipt.v2`, including:

- decision;
- policy and intent IDs;
- action-descriptor, exact-payload, evidence, and proof digests;
- indexed constraint failures;
- verification state; and
- a receipt digest.

The public simulator's receipt is deterministic and tamper-evident under local
SHA-256 recomputation. Its signature and proof fields are explicit placeholders.
It is not a production Delta signature, independently verified proof, Coinbase
attestation, or authenticated statement of user identity.

## Retry contract

`mandateDisposition` maps:

- verified `PASS` plus proof → `EXECUTE`;
- `BLOCK` with at least one explicit constraint failure and an attempt
  remaining → `RETRY`; and
- everything else, including `REVIEW` → `STOP`.

`runMandateAttemptLoop` enforces an integer attempt limit from 1 through 10 and
defaults to three. A production integration must select and test retry semantics
compatible with the private Delta lifecycle: local refinement before one Delta
proposal, a newly authorized intent per retry, or an explicit authenticated
proposal-window primitive. This public build does not claim any of those exists
in private Delta today.

Retry never authorizes a changed policy, different pair, side, size,
credential, portfolio, or expired action. An uncertain Coinbase submission is
reconciliation-only and cannot be retried as a new Create.

## Public production-composition lock

The only build-time seam is:

```text
src/integration/production-composition.js
```

The checked-in `loadProductionExecutionDependencies()` always throws
`ENGINEERING_INTEGRATION_REQUIRED`. It cannot be overridden by an environment
variable, path, plugin, module hash, command-line flag, or simulation adapter.

The module owns a non-exported `LIVE_EXECUTION_CAPABILITY`. Both the LIVE
pipeline and Coinbase Create transport require that exact object. Public v1.3
never returns it, so credentials alone cannot enable Create.

A reviewed internal composition must supply:

```js
{
  mandateAdapter,
  consumeGrant,
  markGrant,
  readGrant,
  executionCapability
}
```

The capability must come from the module closure, not a runtime caller.
`consumeGrant`, `markGrant`, and `readGrant` must use isolated durable storage
with transactional one-use enforcement and recovery state.

Do not replace this seam with a runtime-loaded JavaScript adapter. A module
name, path, or self-asserted security label does not prove process isolation,
evidence provenance, signer identity, or verifier independence.

## Simulation implementation

`SimulatedMandateAdapter`:

- accepts only the pinned v1.3 policy source;
- creates an in-memory intent;
- encodes the frozen record into a strict canonical simulation solution;
- deterministically extracts claimed fixture evidence;
- evaluates the pinned constraints;
- emits indexed failures or success; and
- returns explicit placeholder signature and proof material.

It performs no network request, user authentication, Coinbase attestation,
trusted evidence extraction, real Delta evaluation, cryptographic proof, or
durable one-time grant. It is a test double and must never be selectable in
LIVE composition.

## Required production tests

Before internal composition can return the live capability, contract tests must
cover:

- real private-Delta policy compilation and typed parameter mapping;
- authenticated authorization and signer binding;
- registry locator and immutable-record tampering;
- status, verifier, and proof shapes from the actual services;
- independent origins and credential scopes;
- all eight proof bindings;
- BUY and SELL across multiple pairs and decimal precisions;
- held quote funds for BUY and held base funds for SELL;
- `PASS`, constraint `BLOCK`, Preview `REVIEW`, expiry, timeout, malformed
  proof, and verifier disagreement;
- bounded retry using the selected private-Delta lifecycle;
- grant atomicity across processes and restart;
- exact serialized Create bytes and transport digest;
- uncertain-submission reconciliation by `client_order_id`; and
- proof that public builds, simulation, runtime configuration, and credentials
  cannot obtain the live capability.

Until those pass, credentialed Coinbase use ends at reads and Preview.
