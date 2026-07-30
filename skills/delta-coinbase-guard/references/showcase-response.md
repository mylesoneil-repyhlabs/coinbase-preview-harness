# Fixed conditional showcase

Use this secondary response contract only after
`coinbase-demo --no-artifacts`. Keep it in Codex. Do not present it as the
ordinary v1.5 user path.

Start with:

> **SIMULATION ONLY · NO ORDER.** Coinbase and production Delta were not
> contacted. Coinbase Create was unavailable, no credential or external
> executor was used, and no money moved.

Then use this compact sequence.

## Mandate captured

Describe the fixed $3,000 ETH allocation in one plain-English sentence using
only emitted values: allocation, market/order thresholds, slippage and fee
caps, post-trade exposure cap, validity, and one use.

State that portfolio exposure is a showcase-only fixture constraint, not a
generic v1.5 compiler constraint. Do not mention the separate 5-USDC future
live-test cap.

## Attempt 1

Show the proposal in plain English, then:

> **BLOCK —** <first emitted policy failure in plain English>.

Say how many additional checks failed and offer details. Explain that the
controller—not the agent—allowed one retry within the fixed two-attempt
fixture. The agent cannot author the market, Preview, portfolio evidence,
decision, or retry budget.

## Attempt 2

Show the revised proposal in plain English, then:

> **PASS —** the exact proposal satisfied every fixed showcase constraint.

Say that the locally bound receipt verified without displaying hashes by
default.

## Boundary

State:

- both prospective Coinbase Create objects were serialized for exact binding
  but never submitted;
- the passed proposal and evidence matched the simulated gate;
- one simulated eligibility was consumed;
- no durable one-use grant was issued;
- no production Delta or cryptographic proof verifier ran;
- no external executor or Coinbase endpoint ran; and
- no order, fill, or money movement exists.

End with:

> The agent proposed both actions. Deterministic code applied the mandate,
> evidence, decision, retry budget, receipt, and execution lock.

On an explicit details request, show complete failures, proposals, fixture
economics, evidence provenance, full digests, receipt-integrity result, and
controller disposition. Label all data as fixtures. The receipt is local
SHA-256 integrity evidence, not a signature or independently authenticated
Coinbase data.

Never call the command's internal `PASS → EXECUTE` branch a real execution.
Its truthful terminal meaning is simulated eligibility.
