# Conditional showcase response contract

Use this response contract only for `coinbase-demo --no-artifacts`. Return the
complete result in the Codex conversation. Do not open, render, or ask the user
to inspect a browser artifact.

Start with this exact truth label:

> **SIMULATION ONLY.** Coinbase and production delta were not contacted.
> Coinbase Create was unreachable. No credentials were used, no order was
> placed, and no money moved.

Then use exactly these six headings, in order. They align with the six
right-side recording panels.

## 1. Authorized simulated mandate

State that the user's prompt requested this simulation but did not authorize a
live trade. Show a compact table containing:

- maximum allocation;
- market-price threshold;
- order-limit threshold;
- slippage cap;
- fee cap;
- post-trade exposure cap;
- validity;
- maximum executions; and
- the complete mandate digest;
- the authorization-instance digest; and
- authorization and expiry timestamps.

Use only values emitted by `HUMAN_MANDATE`, `AUTHORIZED_POLICY`,
`AUTHORIZATION_STATUS`, `MANDATE_DIGEST`, `AUTHORIZATION_DIGEST`,
`AUTHORIZED_AT`, and `MANDATE_EXPIRES_AT`.

## 2. Control separation

Use four short lines:

- **Agent:** proposes a closed, canonical Coinbase-shaped Create object.
- **Simulated delta evaluator:** compares the proposal and labeled fixture
  evidence with the mandate.
- **External controller:** maps `BLOCK` to at most one retry and `PASS` to
  eligibility; the model does not choose either transition.
- **Executor:** can receive only the exact passed payload and remains unable to
  call Coinbase Create in this public build.

Explicitly state that the agent cannot author market, Preview, or portfolio
evidence.

## 3. Attempt 1 — BLOCK, then controller RETRY

Show `AGENT_PROPOSAL_1` as a JSON code block. Show the fixture economics in a
compact table. List every emitted failure ID and reason; do not collapse the
market-price and order-limit failures into one check. Show the complete
proposal and evidence digests and the emitted evidence source.

Point out that the prospective Create body includes its `client_order_id`,
`preview_id`, and fixed SOR limit IOC configuration, but is never submitted.

State: the simulated evaluator returned `BLOCK`; the external controller
selected `RETRY` within a fixed two-attempt budget.

## 4. Bound evidence and receipt

For the first receipt, show:

- artifact class and evaluator identity;
- verdict;
- mandate digest;
- authorization-instance digest and expiry;
- exact payload digest;
- evidence digest;
- complete failure IDs and reasons;
- receipt digest; and
- full-attempt verification result.

Explain in one sentence that verification recomputes the mandate, canonical
proposal, evidence, decision, complete failure reasons, authorization window,
and receipt digest. Show the controller disposition separately because the
controller acts after evaluation. Do not call the receipt a production delta
signature or trusted signer identity.

## 5. Attempt 2 — PASS

State that the controller supplied a new labeled evidence fixture and the
agent revised only its proposal. Show `AGENT_PROPOSAL_2` as a JSON code block
and its fixture economics as a compact table. Show the proposal, evidence, and
receipt digests, evidence source, and the full-attempt verification result.

State: every mandate check passed; the simulated evaluator returned `PASS`.

## 6. Deterministic execution boundary

Show this checklist using the emitted values:

- PASS receipt verified;
- passed proposal digest equals execution payload digest;
- passed evidence digest equals execution evidence digest;
- fixed retry budget respected;
- one eligibility in this simulated trace;
- durable one-time grant issued: false;
- external executor invoked: false;
- production delta invoked: false;
- Coinbase contacted: false;
- Coinbase Create invoked: false; and
- artifacts written: false.

End with:

> The agent planned both proposals. It did not decide the mandate result,
> choose its retry budget, manufacture the evidence, or unlock execution.

If explaining `PASS → EXECUTE`, call `EXECUTE` the controller's internal gate
branch. The emitted `EXTERNAL_EXECUTOR_INVOKED=false` confirms that no Coinbase
or other external executor ran.

Never:

- describe fixture prices, fees, exposure, or Preview data as live;
- describe `BLOCK → RETRY` as current production-delta multi-proposal
  semantics;
- imply that an eligible simulated payload was submitted;
- mention the separate 5-USDC future live-test safety cap in this narrative;
- omit a digest by shortening it with an ellipsis; or
- expose local paths.
