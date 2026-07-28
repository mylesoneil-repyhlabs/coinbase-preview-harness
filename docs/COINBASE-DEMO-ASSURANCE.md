# Coinbase Guard v1.3 assurance and claim ledger

This page is the truth boundary for demos, partner conversations, and screen
recordings. It separates what can be verified in this repository from what
still requires Coinbase credentials, private Delta services, and an explicitly
approved live execution integration.

## The short version

v1.2 was functionally centered on one `ETH-USDC` BUY allocation. v1.3 replaces
that assumption with a side- and pair-aware SPOT action model:

- exact-size BUY, funded by held quote asset;
- exact-size SELL, funded by held base asset;
- a pair accepted only when fresh Coinbase product metadata says it is an
  online tradable SPOT product;
- side-specific Coinbase increments, size bounds, bid/ask references, and
  settlement economics; and
- exact policy, action, funding, Preview, payload, and receipt binding.

The generic flow is still a simulation unless a user separately configures a
View-only key for the read/Preview probe. The probe has not been exercised with
credentials in this public release. Coinbase Create is locked in every public
path.

## Claim ledger

| Claim | Status | Verifiable implementation |
| --- | --- | --- |
| A normal Codex user can install and invoke the guard | Implemented locally | Release bundle, installer, skill-local runner, cold-install validation |
| Natural language becomes a closed, action-specific policy | Implemented | v1.3 compiler, strict grounding, clarification/unsupported results, policy digest |
| The user sees and explicitly authorizes the policy before proposal | Implemented procedural UX | Policy/action display and a required new-message digest pause; host identity authentication remains future work |
| BUY and SELL are both modeled | Implemented | BUY `quote_size`; SELL `base_size`; side-specific price and settlement rules |
| The guard supports more than ETH | Implemented as dynamic SPOT logic | Pair and asset values are not hardcoded; multi-pair tests exercise BTC, ETH, SOL, USD, and USDC examples |
| Every Coinbase pair is guaranteed available | Not claimed | Runtime product metadata, account holdings, geographic eligibility, and product flags decide availability |
| The agent may silently convert another asset to fund the trade | Explicitly prohibited | Funding descriptor sets `conversion_allowed: false`; exact held asset is required |
| The agent can inspect account/product/market data and request Preview | Implemented adapter, not live-exercised here | View-only List Accounts, Get Product, Best Bid/Ask, Preview path |
| A bad proposal or Preview is blocked for specific reasons | Implemented | Schema, pair, side, size, increment, funding, price, slippage, commission, settlement, product-state, and binding failures |
| Coinbase Preview warnings cannot slip through | Implemented | Any nonempty warning becomes `REVIEW` and stops |
| Delta evaluates the exact prepared action | Implemented simulation contract | Frozen v2 action record, strict solution, simulated policy and indexed constraints |
| A production Delta evaluation occurred | Not claimed | The private Delta code and services were not available or invoked |
| A receipt binds authorization, action, evidence, and result | Implemented simulation | v2 decision receipt plus policy, action, funding, Preview, payload, evidence, and proof digests |
| The receipt is a production signature or SP1 proof | Not claimed | Public simulator uses explicit placeholder signature/proof material and SHA-256 integrity |
| Retry is bounded outside model logic | Implemented | Deterministic controller; only constraint `BLOCK` with attempts remaining may retry; `REVIEW` stops |
| Only exact verified PASS reaches the execution disposition | Implemented in pipeline/tests | Controller requires PASS, verification, proof, and exact proof bindings |
| A real order can be submitted | Deliberately not implemented | Compile-time production-composition capability and Coinbase Create lock |

## What appears in Codex

For a generic v1.3 flow, the skill keeps the important artifacts in chat:

1. source request and compilation status;
2. complete closed policy;
3. canonical Coinbase action descriptor;
4. policy digest and explicit authorization instruction;
5. side-specific proposal;
6. held-funds evidence;
7. Coinbase market and Preview evidence;
8. local `PASS`, `BLOCK`, or `REVIEW`;
9. simulated Delta decision, indexed failures, proof presence, and receipt;
10. deterministic controller disposition and bounded-retry status; and
11. `SIMULATION_ONLY`, no production Delta, no Coinbase Create, and no money
    moved.

The recording should show those artifacts in the actual Codex chat. Companion
panels may explain them, but must not be presented as a standalone product UI.

## Generic simulation

`simulate` runs the full architecture with:

- a human-authorized v1.3 plan;
- generated but clearly labeled account, product, market, and Preview fixtures;
- side-specific proposal and exact prospective Create bytes;
- the simulated Delta adapter;
- proof and decision-receipt placeholders; and
- a simulated execution adapter behind the PASS gate.

No Coinbase endpoint or private Delta service is contacted. The simulated
executor invocation demonstrates control flow; it is not a Coinbase order.

Multi-pair tests establish that the schemas and deterministic logic are not
ETH-specific. They do not establish that a particular pair is presently
available to a particular Coinbase account. Only a fresh authenticated product
response and account evidence can establish that.

## Fixed conditional-allocation showcase

The existing 3,000-USDC ETH conditional-allocation showcase remains a separate
storytelling fixture. It demonstrates:

- an intentionally noncompliant first candidate;
- specific allocation, price, slippage, fee, and exposure failures;
- deterministic `BLOCK → RETRY`;
- a corrected exact candidate;
- `PASS`; and
- a self-verifying simulation receipt.

The 3,000-USDC amount, ETH prices, fees, exposure, `preview_id`, and timestamps
are labeled fixtures. They do not come from Coinbase, a real portfolio, or
production Delta.

That fixed showcase must not be described as the only v1.3 action. Conversely,
its portfolio-exposure and conditional-allocation narrative must not be
mistaken for a capability of the generic v1.3 natural-language compiler, which
currently accepts one explicit exact-size SPOT BUY or SELL with closed price,
fee, settlement, expiry, and one-use constraints. Conditional strategies and
percent-of-balance sizing remain unsupported in the generic compiler.

## Credentialed Preview probe

The optional probe uses a dedicated View-only CDP key and the public Coinbase
Advanced Trade API to:

- verify key permissions and portfolio binding;
- list complete account balances;
- verify the exact held funding asset and amount;
- fetch fresh product metadata and tradability flags;
- fetch best bid/ask;
- construct one exact side-specific SOR limit IOC candidate; and
- call Coinbase Preview.

The official [Advanced Trade permission matrix](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api)
documents those reads and Preview as View operations, while Create requires
Trade. The probe stops at `PREVIEW_PROBE_PASS`; it does not invoke production
Delta and cannot call Create.

Until credentialed shadow validation occurs, do not claim that the public
release has demonstrated live Coinbase response compatibility. In particular,
the live key-permission response fields, Preview semantics for BUY and SELL,
and Preview ID behavior remain acceptance items.

## Decision meanings

| Decision | Meaning in v1.3 | Gate result |
| --- | --- | --- |
| `PASS` | All deterministic checks passed; in the Delta stage, matching verification and proof also exist | Eligible only for the external deterministic execution disposition |
| `BLOCK` | At least one closed constraint failed, Coinbase Preview returned an error, funding was insufficient, or Delta returned failure/expiry | No execution; only explicit candidate-level constraint failures may retry |
| `REVIEW` | Coinbase Preview returned a warning after otherwise passing, or the application adapter returned a bound terminal `review` | Stop for human review; no proof, execution, or auto-retry |

`PASS` does not mean a live order occurred. In a public v1.3 run it means either
the local simulated contract passed or the View-only Preview probe passed and
stopped.

The terminal adapter `review` is an implemented application-contract state with
a digest-bound simulated receipt. It is not a claim that private Delta
currently exposes a native REVIEW status.

## What the receipt proves

The v1.3 simulation receipt lets a reviewer recompute that the recorded result
is bound to:

- policy and intent IDs;
- canonical action descriptor;
- held-funds evidence;
- Preview and normalized market evidence;
- exact prospective Coinbase Create bytes;
- proposal, evidence, and proof digests;
- constraint failures and decision; and
- receipt digest.

This proves internal artifact integrity under the checked-in deterministic
logic. It does not independently authenticate Coinbase as the source of fixture
data, authenticate the human who typed a digest, prove a private Delta
evaluation, verify a real SP1 proof, or assign production liability.

Production source authenticity requires trusted Coinbase collection,
authenticated action registration, actual Delta signing/evaluation, an
independent Verifier, and an isolated executor.

## Retry qualification

The fixed showcase's `BLOCK → RETRY → PASS` demonstrates controller policy, not
a claim about private Delta's current multi-proposal lifecycle. Production must
choose and test one explicit design:

1. refine locally, then submit one final candidate for one Delta decision;
2. authorize a fresh signed intent per candidate; or
3. add an authenticated bounded-proposal window to Delta.

Any retry stays within the same authorized pair, side, exact size, limits,
portfolio, credential, and expiry. `REVIEW`, infrastructure failure, proof
mismatch, successful execution, or uncertain Coinbase submission is never
auto-retryable.

## Credential and execution boundary

- Planning and simulation read no credential.
- The supported optional planner key is View-only and stored outside the
  repository.
- The key path and secret are not persisted; only non-secret fingerprints and
  permissions are attested.
- The standard Coinbase MCP includes mutating tools, so the safe agent surface
  must be allowlisted to reads and Preview.
- A future View + Trade key belongs only in an isolated executor; it is not
  needed for the demo or Preview probe.
- Coinbase Create is compile-time locked in this public build.
- The independent 5-USDC, one-order profile is only future live-test
  blast-radius control. It is not the generic v1.3 product policy and should
  not appear as the main demo's economic logic.
- The first live order requires private Delta acceptance, durable one-time
  execution, recovery validation, security review, and a new explicit user
  decision.

## Unsupported claims

Do not say or imply that v1.3:

- integrates with a live or private Delta deployment;
- has placed, submitted, or attempted a Coinbase order;
- has exercised a live Coinbase MCP session;
- supports every Coinbase action or every listed product;
- supports transfers, Convert, staking, recurring trades, GTC, leverage,
  derivatives, on-chain execution, or portfolio rebalancing;
- cryptographically authenticates fixture data;
- issues a production-signed liability receipt; or
- makes the agent itself a trusted enforcement boundary.

The production seams and acceptance work are documented in
[ENGINEERING-HANDOFF.md](ENGINEERING-HANDOFF.md),
[COINBASE-EVIDENCE-CONTRACT.md](COINBASE-EVIDENCE-CONTRACT.md), and
[COINBASE-CREDENTIAL-SETUP.md](COINBASE-CREDENTIAL-SETUP.md).
