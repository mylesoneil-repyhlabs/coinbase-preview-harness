---
name: delta-coinbase-guard
description: Compile a natural-language Coinbase Advanced spot BUY or SELL, including exact or maximum sizing and an optional one-shot price condition, into a closed reviewable mandate; require explicit digest authorization; verify the exact proposal against trusted product, balance, market, and Preview evidence; surface PASS, BLOCK, or REVIEW plus a bound receipt; and keep Coinbase Create unreachable in the public build. Use for Coinbase spot planning, credential-free simulations, safe View-only Preview checks, and the labeled conditional-allocation partner showcase. Do not use for transfers, conversions, staking, derivatives, resting or recurring strategies, or live order execution.
---

# Delta Coinbase Guard v1.4

Use the installed harness for every policy, authorization, proposal, Preview,
decision, and receipt transition. Never recreate enforcement logic in chat.
Keep the complete user-facing result in the Codex conversation; a browser or
separate UI is not required. When the user invokes `$delta-coinbase-guard`,
follow this workflow rather than giving generic trading guidance.

## Initialize

1. Resolve `scripts/run` relative to this file and keep its absolute path as
   `GUARD_RUN`. Never substitute another checkout.
2. Read [workflow.md](references/workflow.md).
3. Before a credentialed request, read
   [security-boundary.md](references/security-boundary.md).
4. Run `"$GUARD_RUN" doctor`.
5. If the managed harness is incomplete or its integrity check fails, stop and
   ask the user to reinstall from the pinned v1.4.0 release.

## Supported action

Public v1.4 supports one Coinbase Advanced custodial `SPOT` action per
authorization:

- `BUY BASE-QUOTE`: exact or maximum `quote_size`, funded by held `QUOTE`,
  with a limit ceiling derived from a fresh best ask.
- `SELL BASE-QUOTE`: exact or maximum `base_size`, funded by held `BASE`,
  with a limit floor derived from a fresh best bid.
- Optional one-shot condition: BUY only when the fresh best ask is at or below
  an absolute quote-asset threshold; SELL only when the fresh best bid is at or
  above one. The guard rechecks the condition using trusted BBO and Preview.
- Price-bounded SOR limit IOC; partial fill explicitly allowed; one use;
  30–600 second authorization window.
- Runtime Coinbase product evidence determines whether a pair is available.
  Require an exact, online, enabled, non-view-only `SPOT` product and honor its
  increments and size limits.
- BUY requires a maximum quote debit and commission cap. SELL requires a
  minimum net quote-proceeds floor and commission cap.

Reject transfers, withdrawals, sends, conversions, portfolio movement,
staking, onchain swaps, derivatives, leverage, stop/bracket/GTC/TWAP/scaled
orders, resting or background monitoring, recurring actions, balance-relative
sizing, and conversion of another held asset. Never coerce these into a spot
order.

The 5-USDC `ETH-USDC BUY` profile is only a future live-test safety control.
It does not limit planning, simulation, View-only Preview, or the product
narrative.

## Draft and authorize

Preserve the user's complete text verbatim. A supported request must state:

- one exact pair and BUY or SELL;
- `exactly` or `up to` with the side-correct amount and asset;
- price-bounded IOC and partial-fill choice;
- side-correct slippage reference;
- commission and debit/proceeds bounds;
- one execution and expiry; and
- optionally, one side-correct absolute BBO threshold.

Do not invent defaults. Store the text in a private temporary intent file using
a safe filesystem operation; never interpolate untrusted request text into a
shell command. Run:

```sh
"$GUARD_RUN" plan \
  --intent-file <absolute-private-intent-path> \
  --compiler deterministic
```

For `NEEDS_CLARIFICATION` or `UNSUPPORTED`, return every issue and stop. For
`AWAITING_HUMAN_CONFIRMATION`, return directly in chat:

- source request and digest;
- complete policy and policy digest;
- canonical action and descriptor digest;
- size operator, optional condition, funding asset and required balance;
- price, slippage, fee, settlement, validity, and one-use terms; and
- `CREATE_ENABLED=false`.

Then pause. Only a new user-authored message naming the full displayed policy
digest authorizes the draft. The harness compares digests but cannot
authenticate who sent the message. Never confirm on the user's behalf.

## Credential-free simulation

After exact policy confirmation:

```sh
"$GUARD_RUN" simulate \
  --plan <absolute-plan-path> \
  --confirm-policy <authorized-policy-digest> \
  --no-artifacts
```

Return all emitted results in chat: policy, authorization digest, action,
funding evidence, proposal, Preview fixture, proposal and Preview decisions,
Delta-contract decision, receipt, proof verification, controller disposition,
and gate state.

Always state:

- `SIMULATION_ONLY`;
- Coinbase and production Delta were not contacted;
- the receipt is local SHA-256 integrity evidence, not a signature;
- the placeholder proof received a non-cryptographic binding check only;
- the exact payload became `EXECUTION_ELIGIBLE` in this test only;
- no external executor ran, Coinbase Create was not invoked, no exchange
  outcome was observed, and no money moved.

Only `PASS` for the exact descriptor, payload, Preview, funding, portfolio, and
credential bindings can reach the one-use in-memory gate. A structured
retryable `BLOCK` may be retried only inside the fixed controller budget using
fresh evidence and a fresh candidate. `REVIEW`, expiry, missing proof, or any
binding mismatch stops locked.

## Optional real Coinbase reads and Preview

Use a separate View-only CDP key: `can_view=true`, `can_trade=false`, and
`can_transfer=false`. Keep its JSON outside the repository, mode `0600`, and
pass only an absolute path. Never request, print, paste, or copy a secret.

```sh
"$GUARD_RUN" configure-preview-credentials \
  --key-file <absolute-view-key-path>
```

Bind with role `preview`, display the portfolio fingerprint and execution
digest, then require a second new user-authored message naming that digest:

```sh
"$GUARD_RUN" bind-execution \
  --plan <absolute-plan-path> \
  --confirm-policy <authorized-policy-digest> \
  --credential-role preview \
  --key-file <absolute-view-key-path>

"$GUARD_RUN" confirm-execution \
  --bound-execution <absolute-bound-path> \
  --confirm-execution <authorized-execution-digest> \
  --key-file <absolute-view-key-path>

"$GUARD_RUN" probe-execution \
  --bound-execution <absolute-bound-path> \
  --confirmation-receipt <absolute-receipt-path> \
  --key-file <absolute-view-key-path>
```

The host—not the model—must normalize and bind complete Accounts and Products
pagination, exact Product, BBO, and Preview responses. A Preview warning is
`REVIEW`; errors, incoherent economics, stale or divergent books, insufficient
held funds, product restrictions, or constraint failures are `BLOCK`.

`PREVIEW_PROBE_PASS` is not a Delta `PASS` and cannot release an order.

## Coinbase MCP topology

The implemented path is direct View-only REST. Coinbase's documented local
CLI/MCP namespace includes useful reads and `orders_preview`, but also
mutations such as `orders_create`, transfers, and conversions. Do not give the
planning agent that unrestricted namespace with a Trade key.

A future host may expose an allowlisted read/Preview-only MCP proxy. The future
View+Trade executor key must remain outside the model and MCP context, behind
private Delta validation, pinned cryptographic proof verification,
authenticated external user authorization, and durable one-time consumption.
Public v1.4's compile-time Create seam remains locked.

## Conditional retry showcase

When the user asks to demonstrate `BLOCK → RETRY → PASS`, run:

```sh
"$GUARD_RUN" coinbase-demo --no-artifacts
```

Then follow [showcase-response.md](references/showcase-response.md). This fixed
$3,000 ETH trace uses labeled market, Preview, and portfolio fixtures. The
generic compiler supports its maximum-size and price-threshold concepts;
portfolio exposure remains specific to the showcase fixture. It is not a live
conditional order, Coinbase data, or production Delta.

## Report in Codex

Always include:

1. action classification and supported/unsupported status;
2. closed policy, canonical action, and authorization digest;
3. funding, product, market, and Preview provenance;
4. exact prospective Coinbase payload digest;
5. `PASS`, `BLOCK`, or `REVIEW`, every failure, receipt integrity, proof
   verifier class, and whether cryptographic verification occurred;
6. controller disposition, retry budget, and one-time gate state; and
7. `EXTERNAL_EXECUTOR_INVOKED=false`,
   `COINBASE_CREATE_INVOKED=false`, `MONEY_MOVED=false`, plus the next safe
   step.

Do not expose account IDs, portfolio labels, credentials, headers, private
responses, or home-directory paths. Artifacts are secondary; the chat is the
user experience.
