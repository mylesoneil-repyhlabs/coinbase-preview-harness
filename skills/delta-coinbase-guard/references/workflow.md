# Workflow and state transitions

## Trust boundaries

| Component | May do | Must not do |
| --- | --- | --- |
| User | Authorize a displayed policy or execution digest | Delegate approval implicitly |
| Host or chat interface | Attribute a new confirmation to an authenticated user and pass the exact digest | Treat agent output, silence, or credentials as user approval |
| Agent | Preserve the user's words, invoke the harness, explain results | Authenticate the user, manufacture confirmation/evidence, hold a Trade key, or choose execute/retry |
| Coinbase read surface | Return product, market, account, order, and Preview data | Create or mutate orders from the model-facing surface |
| Delta Mandate integration | Derive trusted evidence, evaluate constraints, prove, and independently verify success | Trust agent-authored evidence |
| Deterministic controller | Map verified state to retry, stop, or execute; bind exact bytes; reconcile uncertainty | Override a failure or execute an unverified candidate |
| Coinbase executor | Submit the exact verified Create body once | Accept free-form methods, paths, fields, or model-authored credentials |

If a mutating Coinbase tool is advertised to the model, transition to
`STOP_UNSAFE_TOOL_TOPOLOGY` without calling it. Remove the tool or replace the
surface with a verified View-only credential, rerun `doctor`, and restart at
`plan`.

## Checked-in V1 sequence

1. Preserve the natural-language instruction verbatim.
2. Compile it into the closed `digital-asset-spot-order.v1` policy.
3. Display every material field and the policy digest.
4. Pause for a new user-authored policy-digest confirmation supplied by the
   host.
5. For a credentialed probe, verify a View+Trade/no-Transfer/no-Receive key and
   bind the policy to its key and portfolio fingerprints.
6. Display the execution digest and pause for a second new user-authored
   confirmation supplied by the host.
7. Record one immutable confirmation receipt with fixed `confirmed_at` and
   `expires_at`. The receipt cannot be re-timestamped or renewed.
8. Fetch fresh Coinbase product and best-bid/ask data, construct the fixed V1
   candidate, and call Coinbase Preview.
9. Run the local fee, amount, freshness, portfolio, and Preview checks.
10. Stop with `PREVIEW_PROBE_PASS` or a fail-closed probe result. Production
    composition and Coinbase Create are never invoked.

The CLI verifies digest equality and receipt integrity; it does not
authenticate the author of a chat message. The calling host owns that control.
Production should use an authenticated Delta-native authorization UX and
signer session.

When clarification is required, request one complete replacement instruction
and compile it as a new source intent. Do not merge fragments on the user's
behalf. If the original request was for execution, obtain separate permission
before substituting simulation or Preview-only testing.

## Post-integration sequence

Engineering retains steps 1–9 and adds:

1. Freeze the exact prospective Create bytes and register that action in an
   authenticated, append-only,
   content-addressed registry.
2. Submit the pinned policy and an authenticated Delta-native `SignedIntent`.
3. Submit the registry locator as the exact proposal solution.
4. Wait for a terminal Orchestrator outcome.
5. Independently require the Verifier outcome and Proof to match the policy,
   intent, proposal, evidence, and exact Coinbase Create bytes.
6. Let the deterministic controller map the result:
   - verified success → atomically consume a durable one-time grant and submit
     the exact bytes;
   - supported constraint failure with remaining attempt budget → retry;
   - anything else → stop.
7. Reconcile by `client_order_id`, order ID, and fills. Never retry Create after
   a timeout or malformed response.

The production composition seam is
`src/integration/production-composition.js`. The public export is deliberately
hard-disabled. Engineering replaces it in source with the real Delta adapter
and isolated durable grant-store hooks; do not add an arbitrary runtime plugin
loader.

## Retry caveat

Current Delta main treats a constraint failure as terminal for an intent. The
controller can classify such a result as retryable, but the checked-in V1 does
not claim a multi-attempt authoritative workflow. One authorization spanning
multiple failed proposals requires one explicit design:

1. local candidate iteration followed by one authoritative Delta proposal;
2. a fresh authenticated `SignedIntent` for each candidate; or
3. a Delta core attempt-history/reopen change with a signed attempt cap.

Do not describe “retry until pass under one authorization” as implemented
until engineering selects and tests one of these semantics.
