# Coinbase Guard v1.4 assurance and claim ledger

This is the truth boundary for demos, recordings, and partner conversations.
It separates what can be reproduced from this repository from what still
requires Coinbase credentials, private Delta services, and a separately
approved live execution integration.

## The short version

v1.4 compiles one natural-language Coinbase Advanced SPOT request into a closed
v3 policy and a canonical v2 action descriptor. The implemented action family
is:

- BUY any runtime-supported SPOT pair, quote-sized and funded by held quote
  asset;
- SELL any runtime-supported SPOT pair, base-sized and funded by held base
  asset;
- `EXACT` sizing or a positive agent-selected size no greater than a `MAX`
  authorization;
- an optional one-shot condition: BUY only when fresh best ask is at or below
  an absolute quote-asset price, or SELL only when fresh best bid is at or
  above one; and
- SOR limit IOC, bounded slippage, commission, side-correct settlement,
  expiry, and one use.

The condition is checked during one proposal/Preview evaluation. It is not a
resting order, recurring strategy, price watcher, or background agent.

The credential-free flow uses labeled Coinbase and Delta fixtures. A clean run
ends at `EXECUTION_ELIGIBLE`: the exact evaluated payload passed the
deterministic gate in that simulation. No external executor runs, no fill or
exchange outcome is fabricated, Coinbase Create remains locked, and no money
moves.

## Claim ledger

| Claim | Status | Verifiable implementation |
| --- | --- | --- |
| A normal Codex user can install and invoke the guard | Implemented | Managed-copy installer, skill-local runner, doctor, cold-install tests |
| The install survives deleting the download or clone | Implemented | Versioned managed copy under the user's data directory and a verified skill symlink |
| Natural language becomes a closed action-specific policy | Implemented | Strict v3 compiler, grounding, clarification/unsupported results, policy digest |
| The user sees the complete draft before authorization | Implemented procedural UX | Policy, canonical action, and digest are printed before a required new-message pause |
| BUY and SELL both work | Implemented | BUY `quote_size`; SELL `base_size`; side-specific funding, BBO, and settlement |
| `EXACT` and `MAX` sizing work | Implemented | `EXACT` requires equality; `MAX` permits one positive size at or below the authorized cap |
| One-shot price conditions work | Implemented | BUY best-ask `AT_OR_BELOW`; SELL best-bid `AT_OR_ABOVE` |
| Pair support is dynamic rather than ETH-specific | Implemented logic | Fresh Coinbase product metadata is authoritative; multi-pair fixture tests do not guarantee current account availability |
| Another asset may silently fund the trade | Prohibited | BUY requires held quote asset; SELL requires held base asset; conversion is false |
| Account, product, market, and Preview reads exist | Implemented direct REST adapter | View-only List Accounts, List/Get Product, Best Bid/Ask, and Preview |
| A live Coinbase MCP session was exercised | Not claimed | MCP is documented as a possible topology only; the implemented adapter is direct REST |
| Bad proposals and incoherent Preview economics fail closed | Implemented | Strict schema, BBO freshness/coherence, size, funds, price, fee, slippage, settlement, and payload-binding checks |
| Preview warnings are safe to ignore | Prohibited | A nonempty warning becomes `REVIEW` and stops |
| Delta evaluates the exact prepared record | Implemented simulation contract | Frozen v2 evaluation request, v3 policy, strict solution and evidence bindings |
| A production Delta evaluation occurred | Not claimed | The private Delta runtime was unavailable and was not invoked |
| A receipt binds the decision and exact action | Implemented simulation | v3 decision receipt binds policy, action, Preview, funding, payload, evidence, proof, and verifier-attestation digests |
| The local proof is cryptographic | Not claimed | It is an explicit simulation placeholder with binding-only verification and `cryptographically_verified: false` |
| Production can accept an arbitrary proof string | Prohibited by adapter contract | Production adapter requires an injected verifier, pinned verifier identity and pinned proof program ID, plus `cryptographically_verified: true` |
| Retry is bounded outside the model | Implemented controller behavior | Only an explicit constraint `BLOCK` with attempts remaining may retry; `REVIEW` and proof failures stop |
| A real order can be submitted | Deliberately unavailable | Public production composition and Coinbase Create are compile-time locked |

The CLI checks digest equality but does not authenticate the person who typed a
confirmation. A production host must provide authenticated user attribution or
a Delta-native signer session.

## What a generic simulation shows

The Codex response should keep these artifacts in chat:

1. preserved source request and compilation status;
2. complete v3 policy and v2 canonical action descriptor;
3. funding asset and required available amount;
4. policy digest and the explicit authorization pause;
5. agent proposal and labeled product, account, market, and Preview fixtures;
6. deterministic proposal and Preview decisions;
7. simulated Delta `PASS`, `BLOCK`, or `REVIEW`;
8. proof-verification attestation and v3 decision receipt;
9. controller disposition and bounded-retry state; and
10. `SIMULATION_ONLY`, `EXECUTION_ELIGIBLE` or a stop state, no external
    executor, no Coinbase contact, no Create, and no money moved.

`EXECUTION_ELIGIBLE` means only that the exact evaluated payload reached the
one-use in-memory simulation gate. It is not `FILLED`, `SUBMITTED`, or proof of
an exchange outcome.

## Generic policy versus fixed showcase

The generic v1.4 compiler supports `EXACT` or `MAX` BUY/SELL and the optional
side-correct one-shot BBO condition. It does **not** support a portfolio-value
or post-trade exposure cap.

The separate fixed 3,000-USDC ETH showcase includes an exposure fixture because
it is a presentation scenario for `BLOCK → bounded RETRY → PASS`. Its values,
evidence, evaluator, and receipts are deterministic local fixtures. Do not
describe that exposure check as a generic compiler capability or as production
Delta multi-proposal behavior.

Conversely, do not describe the fixed showcase as the only supported action.
The generic implementation is pair-aware and covers conditional and
unconditional BUY/SELL actions across runtime-supported SPOT products.

## Credentialed Preview boundary

With a separately supplied View-only CDP key, the direct REST probe can:

- verify key permissions and portfolio binding;
- obtain the complete account set and exact held funding asset;
- resolve product type, status, flags, increments, and size bounds;
- read fresh best bid and ask;
- prepare one side-specific SOR limit IOC request; and
- call Coinbase Preview.

It stops at `PREVIEW_PROBE_PASS`, `BLOCK`, or `REVIEW`. It does not invoke the
Delta adapter or Coinbase Create. The public build has not been validated with
the user's credential, so live response compatibility remains a shadow-test
acceptance item.

Coinbase's public [Advanced Trade permission matrix](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api)
documents the relevant reads and Preview as View operations and Create as a
Trade operation.

## Decision meanings

| Decision | Meaning | Gate result |
| --- | --- | --- |
| `PASS` | All local checks passed and, at the Delta stage, the exact result and proof attestation matched | Eligible only for the external deterministic gate |
| `BLOCK` | A closed constraint, funding requirement, product rule, Preview check, expiry, or Delta constraint failed | No execution; bounded retry only for explicit candidate-level failures |
| `REVIEW` | Preview returned a warning after otherwise passing, or the adapter returned a bound terminal review | Stop for human review; no proof or execution eligibility |

Infrastructure errors, malformed responses, proof mismatches, verifier
disagreement, and unknown states are fail-closed errors. They never default to
`PASS`.

## What the simulation receipt proves

The v3 receipt lets a reviewer recompute local integrity bindings for:

- policy and intent IDs;
- canonical action descriptor;
- authorized limit price;
- held-funds evidence;
- Preview request, Preview ID, and normalized market evidence;
- exact prospective Coinbase Create bytes;
- proposal, evidence, proof, and proof-verification attestation; and
- decision, complete failure set, and receipt digest.

It does not authenticate Coinbase as the source of fixture data, authenticate
the user, prove a private Delta evaluation, cryptographically verify the local
placeholder, or assign production liability.

Production requires authenticated Coinbase collection, an authenticated
action registry, actual Delta signing and evaluation, a pinned cryptographic
Verifier, an isolated durable one-use executor, and recovery.

## Unsupported claims

Do not say or imply that v1.4:

- placed, submitted, attempted, or filled a Coinbase order;
- integrated with or invoked private Delta;
- exercised a live Coinbase MCP session;
- supports every Coinbase product or every Coinbase action;
- supports transfers, Convert, staking, recurring strategies, GTC, balance
  percentages, leverage, derivatives, on-chain execution, multi-action
  strategies, or generic portfolio-exposure constraints;
- cryptographically authenticates fixtures or the simulation proof;
- issues a production-signed liability receipt; or
- trusts the agent as the authorization, evidence, or execution boundary.

The independent 5-USDC, one-order profile is future live-test blast-radius
control only. It is not the v1.4 economic policy or demo story.

For the production seams, see
[ENGINEERING-HANDOFF.md](ENGINEERING-HANDOFF.md),
[COINBASE-EVIDENCE-CONTRACT.md](COINBASE-EVIDENCE-CONTRACT.md), and
[COINBASE-CREDENTIAL-SETUP.md](COINBASE-CREDENTIAL-SETUP.md).
