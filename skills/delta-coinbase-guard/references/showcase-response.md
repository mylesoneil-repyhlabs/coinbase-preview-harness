# Fixed conditional showcase response contract

Use this contract only for `coinbase-demo --no-artifacts`. Keep the complete
result in Codex; do not open a browser or ask the user to inspect another UI.

Start with:

> **SIMULATION ONLY.** Coinbase and production Delta were not contacted.
> Coinbase Create was unreachable. No credentials were used, no external
> executor ran, no order was placed, and no money moved.

Use these six headings in order. They align with the six companion panels.

## 1. Authorized simulated mandate

State that the prompt requested a simulation and did not authorize a live
trade. Show:

- maximum allocation;
- market and order-limit thresholds;
- slippage and fee caps;
- post-trade exposure cap;
- validity and maximum executions;
- complete mandate and authorization-instance digests; and
- authorization and expiry times.

Use only emitted values. State that portfolio exposure is a fixed showcase
fixture, not a generic v1.4 compiler constraint.

## 2. Control separation

Use four short lines:

- **Agent:** proposes a closed Coinbase-shaped prospective Create object.
- **Simulated evaluator:** compares it and labeled evidence with the fixed
  mandate.
- **External controller:** maps `BLOCK` to at most one retry and `PASS` to
  eligibility.
- **Executor:** would accept only the exact passed payload, but no external
  executor runs in this public build.

State that the agent cannot author market, Preview, portfolio evidence, the
decision, or retry budget.

## 3. Attempt 1 — BLOCK, then controller RETRY

Show `AGENT_PROPOSAL_1` as JSON and fixture economics as a compact table. List
every emitted failure ID and reason. Show complete proposal and evidence
digests and the evidence source.

Explain that the prospective Create body includes its `client_order_id`,
`preview_id`, and fixed SOR limit IOC configuration but is never submitted.

State that the simulated evaluator returned `BLOCK` and the controller selected
one retry within the two-attempt budget.

## 4. Bound evidence and local receipt

Show, for attempt one:

- artifact class and evaluator identity;
- verdict;
- mandate and authorization-instance digests;
- authorization expiry;
- exact payload and evidence digests;
- complete failures;
- receipt digest; and
- receipt verification result.

Explain that local verification recomputes the mandate, canonical proposal,
evidence, complete reasons, authorization window, and receipt digest. This is a
local SHA-256 integrity receipt, not a production Delta signature, trusted
signer, or cryptographic proof.

Show controller disposition separately because it occurs after evaluation.

## 5. Attempt 2 — PASS

State that the controller supplied a new labeled evidence fixture and the agent
revised only its proposal. Show `AGENT_PROPOSAL_2` as JSON, fixture economics,
proposal/evidence/receipt digests, evidence source, and local receipt
verification.

State that every fixed-showcase check passed and the simulated evaluator
returned `PASS`.

## 6. Deterministic execution boundary

Show:

- PASS receipt verified locally;
- passed proposal digest equals execution payload digest;
- passed evidence digest equals execution evidence digest;
- fixed retry budget respected;
- one eligibility in the simulated trace;
- durable one-time grant issued: false;
- external executor invoked: false;
- production Delta invoked: false;
- Coinbase contacted: false;
- Coinbase Create invoked: false; and
- artifacts written: false.

End with:

> The agent planned both proposals. It did not decide the mandate result,
> choose its retry budget, manufacture the evidence, or unlock execution.

If explaining `PASS → EXECUTE`, call `EXECUTE` the controller's internal gate
branch. The externally truthful terminal meaning is simulated eligibility,
not execution.

Never:

- describe fixture prices, fees, exposure, or Preview values as live;
- describe the exposure check as generic v1.4 functionality;
- describe `BLOCK → RETRY` as established production Delta lifecycle;
- call the receipt signed or cryptographically verified;
- imply that an eligible payload was submitted or filled;
- mention the 5-USDC future live-test cap in this narrative;
- shorten required digests with ellipses; or
- expose local paths.
