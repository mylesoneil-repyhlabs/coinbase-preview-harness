# Workflow and state transitions

## Trust boundaries

| Component | May do | Must not do |
| --- | --- | --- |
| User | Authorize a displayed policy or execution digest | Approve implicitly or before seeing the closed draft |
| Host/chat | Attribute a new confirmation to an authenticated user | Treat agent output, silence, or possession of a key as approval |
| Agent | Preserve the user's words, propose within policy, explain results | Authenticate the user, author evidence, choose verdict/retry, hold a Trade key, or execute |
| Coinbase read surface | Return account, product, BBO, and Preview data | Expose Create or mutation to the model-facing surface |
| Delta integration | Evaluate trusted evidence and prove the exact action | Trust agent-authored evidence |
| Proof verifier | Verify exact proof under pinned identity/program | Accept nonempty or self-asserted proof material |
| Deterministic controller | Map verified state to retry, stop, or eligibility | Override failure or alter passed bytes |
| External executor | Consume one durable grant and submit exact passed bytes | Accept free-form methods, paths, fields, or model credentials |

Coinbase MCP is topology-only in this repository. The implemented network
surface is direct REST with View-only reads and Preview. If an agent-facing MCP
advertises a mutating tool, stop with an unsafe-topology result before using it.

## Generic v1.4 sequence

1. Preserve the natural-language request verbatim and classify the action.
2. Reject unsupported actions instead of translating them into a spot trade.
3. Compile one BUY or SELL into `digital-asset-spot-order.v3`.
4. Bind `EXACT` or `MAX` sizing. BUY is quote-sized and funded by held quote
   asset; SELL is base-sized and funded by held base asset.
5. If present, bind one side-correct condition: BUY fresh best ask at or below
   an absolute quote-asset price, or SELL fresh best bid at or above one.
6. Bind SOR limit IOC, partial-fill policy, slippage, commission, settlement,
   expiry, and one use.
7. Display the complete v3 policy, v2 action descriptor, funding source,
   provenance, and digests.
8. Pause for a new user-authored policy-digest confirmation. The original
   request and the agent's draft are not authorization.
9. In credential-free mode, use only labeled account, product, market,
   Preview, Delta, and proof fixtures.
10. The trusted controller constructs a side-correct candidate, checks the
    optional condition, and evaluates product, size, price, increment, funding,
    and settlement constraints.
11. Normalize one Preview and verify its BBO, implied price, order total,
    commission, slippage, warnings/errors, and exact request binding.
12. Freeze one evaluation request and prospective Coinbase Create byte string.
13. Submit it through the replaceable Delta adapter.
14. Require exact status, verifier, proof, nine Coinbase evidence bindings,
    and proof-verification attestation.
15. Map `BLOCK` with an explicit candidate failure to bounded retry; map
    `REVIEW`, infrastructure failure, expiry, or mismatch to stop.
16. On simulated `PASS`, consume one in-memory test gate and end at
    `EXECUTION_ELIGIBLE`.
17. Report that no external executor, Coinbase endpoint, production Delta,
    Coinbase Create, fill, or money movement occurred.

`MAX` means one positive proposed size no greater than the user's cap. It does
not authorize zero, a percentage, or a different asset. The one-shot market
condition is evaluated during this attempt; it does not schedule, monitor, or
rest an order.

The local proof adapter accepts only its explicit placeholders and reports
`cryptographically_verified: false`. A local receipt digest is not a signature.

## Credentialed Preview sequence

1. Verify a dedicated View-only/no-Trade/no-Transfer key from an external
   owner-only file.
2. Bind the policy to key and portfolio fingerprints.
3. Display the execution digest and require a second new user-authored
   confirmation.
4. Fetch complete account pagination plus product and fresh BBO evidence via
   the direct REST adapter.
5. Require exact held quote funds for BUY or base funds for SELL.
6. Check product type, flags, increments, and size bounds.
7. Construct one SOR limit IOC Preview request and call Preview.
8. Bind request, Preview ID, economics, funding, descriptor, portfolio, and
   credential.
9. Map errors/constraint failures to `BLOCK`, warnings to `REVIEW`, and a clean
   result to `PREVIEW_PROBE_PASS`.
10. Stop. Preview pass is not Delta pass, and Create remains unreachable.

The CLI validates digests but does not authenticate the author of a chat
message. A production host must own that control.

## Fixed conditional showcase

`coinbase-demo --no-artifacts` is a separate presentation fixture. It includes
a post-trade exposure constraint that the generic v1.4 compiler does not
support.

1. Display the simulated mandate and its digest.
2. Let the agent fixture propose candidate one.
3. Let the controller attach separately labeled market, Preview, and portfolio
   evidence.
4. Return `BLOCK` with every failed constraint and a locally verifiable
   digest-bound receipt.
5. Let the controller allow one retry within the fixed two-attempt budget.
6. Attach a new evidence fixture and let the agent revise only its proposal.
7. Return `PASS` for candidate two and verify the local receipt.
8. Recheck proposal and evidence digests at the gate.
9. Mark one simulated eligibility and stop with the external executor false.

The showcase is not generic compiler coverage, a cryptographic proof, a
production Delta multi-proposal lifecycle, or a Coinbase order.

## Production sequence

Engineering preserves every planning, authorization, evidence, and fail-closed
invariant, then:

1. registers the frozen action in authenticated append-only storage;
2. submits the actual Delta policy and authenticated signed intent;
3. submits the registry locator;
4. waits for terminal outcome;
5. obtains independent verification and proof;
6. cryptographically verifies the exact proof with pinned verifier identity
   and proof program;
7. requires all nine Coinbase proof bindings;
8. atomically consumes a durable grant for the exact Create bytes;
9. submits those bytes once from an isolated executor; and
10. reconciles by `client_order_id`, order ID, and fills.

Never retry Create after an uncertain submission.

The checked-in production composition is hard-disabled. It must be replaced in
source after private integration review; do not add an arbitrary runtime plugin
loader.

## Retry caveat

The public generic simulator evaluates one candidate; the fixed showcase
demonstrates controller retry behavior with two fixture decisions. Neither
proves that private Delta reopens one authorized intent.

Production must explicitly choose local refinement before one Delta proposal,
a fresh authenticated intent per candidate, or an authenticated bounded
proposal window. Do not claim “retry until pass under one authorization” until
that lifecycle is implemented and tested.
