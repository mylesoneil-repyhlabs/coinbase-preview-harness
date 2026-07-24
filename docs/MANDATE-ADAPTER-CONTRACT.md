# Mandate adapter contract

This harness has one Delta boundary. Both simulation and production implement
the same application port; the execution pipeline does not know which one is
selected.

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

The port is defined and checked in `src/mandate/contract.js`. The deterministic
controller is in `src/mandate/controller.js`.

## Mapping to current delta main

| Harness operation | Delta operation |
| --- | --- |
| `submitPolicy(source)` | Orchestrator `POST /policies`, `text/plain` |
| `authorizeIntent(...)` | Sign `Intent { id, policy_id, attrs }` using Delta's JCS signature rules, then Orchestrator `POST /intents` |
| `prepareProposal(...)` | Register the frozen Coinbase action with the trusted action registry and return its opaque Delta `solution` |
| `submitProposal(...)` | Orchestrator `POST /intents/{id}/proposal` with exactly `{solution}` |
| `getStatus(...)` | Orchestrator `GET /intents/{id}/status` |
| `getVerificationOutcome(...)` | Verifier `GET /intents/{id}` |
| `getProof(...)` | Verifier `GET /proofs/{id}` |

`authorizeIntent` and `prepareProposal` are application operations, not Delta
HTTP endpoints. The production intent implementation receives an injected
signer and verifies that the returned `SignedIntent` binds the exact policy ID,
caller-assigned intent ID, and typed `attrs` before submitting it. The proposal
implementation delegates to a trusted action registry so an arbitrary action
locator cannot be supplied by the untrusted agent.

## Required status union

```text
open
processing { proposal }
success    { intent_id, proposal, evidence }
failure    { intent_id, reason, proposal, evidence?, constraint_failures[] }
expired    { intent_id }
```

A constraint failure is distinguished from infrastructure/proof failure by a
nonempty `constraint_failures` array. Only a constraint failure may be
classified as candidate-retryable by the local controller. Current Delta main
still makes that intent terminal; see `ENGINEERING-HANDOFF.md` for the required
retry decision.

## Success predicate

The adapter/controller returns an executable success only after all of these
hold:

1. Orchestrator status is `success`.
2. The Orchestrator proposal equals the submitted solution exactly.
3. The independent Verifier outcome is `success`.
4. Verifier intent ID, policy ID, and typed attributes match exactly.
5. Verifier proposal equals the submitted solution exactly.
6. A Proof with nonempty `sp1_proof` material is available.
7. Proof SignedIntent ID, policy ID, and typed attributes match exactly.
8. Proof proposal equals the submitted solution exactly.
9. The complete proof binding set—product ID, Preview ID, Create-body digest,
   Preview-request digest, portfolio fingerprint, and credential fingerprint—
   matches the frozen Coinbase action.

Any missing, open, processing-timeout, failure, expiry, malformed, mismatched,
or unverifiable state stops execution.

The local controller checks the presence of nonempty `sp1_proof` material and
all artifact bindings; it does not cryptographically verify SP1 itself. That is
the independent Verifier's responsibility, and the controller requires the
Verifier's matching successful outcome before it can execute.

## Production composition

The public V1 does not load a production adapter at runtime. Its compile-time
composition seam is:

```text
src/integration/production-composition.js
```

The checked-in export always fails with
`ENGINEERING_INTEGRATION_REQUIRED` before the execution command reads a
Coinbase key. No environment variable, path, module digest, plugin, or
command-line flag can select a different implementation. The module also owns
a non-exported `LIVE_EXECUTION_CAPABILITY`; the public LIVE pipeline and the
Coinbase Create transport each reject a caller that cannot present that exact
object.

Engineering replaces that internal composition in source with a reviewed
build-time dependency that creates:

```js
createOrchestratorMandateAdapter({
  orchestratorUrl,
  verifierUrl,
  signer,
  actionRegistry,
  orchestratorBearerToken,
  verifierBearerToken,
})
```

and injects an isolated durable implementation of the existing execution-grant
ports. The reviewed composition must also return its module-private
`LIVE_EXECUTION_CAPABILITY` as `executionCapability`. It must never export the
capability, expose a minting function, or accept a runtime-supplied substitute.
Keep secrets and the Trade credential outside the agent-facing process. Do not
turn this seam into an arbitrary runtime-loaded JavaScript module; in-process
module labels and file hashes do not establish isolation or trusted provenance.

The adapter enforces distinct Orchestrator and Verifier origins and rejects a
shared bearer token or equal configured tokens. Production must configure
independently scoped credentials and operational separation.
`prepareProposal` is the single-Preview handoff: the trusted executor freezes
one action record, the registry stores it immutably and returns an opaque
solution, and Delta evidence resolves that same record rather than issuing a
second Coinbase Preview.

The registry response is fail-closed and content-addressed:

```js
{
  solution: `coinbase-order://proposal/v1/${digest(actionRecord)}`,
  action_record_digest: digest(actionRecord)
}
```

The adapter rejects any other locator, missing digest, or mismatch. Registry
storage must be authenticated, append-only, and readable by the evidence
service using the exact locator; the model-facing process must not be able to
write or replace records.

The hand-written HTTP adapter is useful for contract testing. If the target
Delta runtime already has generated clients, engineering should keep this port
and replace the internal HTTP calls with those clients.

The production grant store must implement the injected
`consumeGrant(planId, intentId, record)`, `markGrant(planId, patch)`, and
`readGrant(planId)` ports with:

- an authenticated writer available only to the trusted executor;
- a transactional unique key that prevents two processes or hosts from
  consuming the same plan;
- binding to the exact plan, confirmation receipt, successful Delta intent,
  proposal, and Create-body digest;
- durable audit state across restart; and
- a read-only reconciliation path for an uncertain Coinbase submission.

Public V1 ships no default live grant store. Tests and the explicit simulator
use injected in-memory doubles; they are not production trust boundaries.

## Contract tests

`test/mandate-adapter.test.js` pins:

- lifecycle pass and indexed constraint failure;
- exact Orchestrator and Verifier method/path/body mapping;
- canonical solution tamper rejection;
- proof evidence binding;
- verified-proof-required execution;
- retry only on constraint failures; and
- full pipeline operation through the simulator implementation.

Production-composition tests must prove that the public V1 returns
`ENGINEERING_INTEGRATION_REQUIRED` before credentials are read, that simulation
cannot be selected for execution, and that no runtime configuration can enable
Create. The internal engineering build must add contract tests for the real
adapter, signer, registry, durable grant store, and operationally independent
Verifier.
