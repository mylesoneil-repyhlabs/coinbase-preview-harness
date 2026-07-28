---
name: delta-coinbase-guard
description: Compile a natural-language Coinbase Advanced spot BUY or SELL into a closed, reviewable mandate; require explicit digest authorization; verify the exact proposal against trusted product, balance, market, and Preview evidence; surface PASS, BLOCK, or REVIEW plus a bound receipt; and keep Coinbase Create unreachable in the public build. Use for generic Coinbase spot planning, credential-free simulations, safe View-only Preview checks, and the labeled conditional-allocation partner showcase. Do not use for transfers, conversions, staking, derivatives, recurring strategies, or live order execution.
---

# Delta Coinbase Guard v1.3

Use the repository harness for every policy, authorization, proposal, Preview,
decision, and receipt transition. Never recreate enforcement logic in chat.
When the user invokes `$delta-coinbase-guard`, keep this full workflow in the
Codex conversation; do not substitute a generic trading answer.

## Initialize

1. Resolve `scripts/run` relative to this file and keep its absolute path as
   `GUARD_RUN`. Do not substitute another checkout.
2. Read [workflow.md](references/workflow.md).
3. Before any credentialed request, read
   [security-boundary.md](references/security-boundary.md).
4. Run `"$GUARD_RUN" doctor`.
5. If the complete checkout is missing, ask the user to run the repository
   `install` script. Do not clone or move it without instruction.

## Supported action inventory

Public v1.3 implements exactly one Coinbase Advanced custodial `SPOT` order:

- `BUY BASE-QUOTE`: exact `quote_size`, funded by held `QUOTE`, limit ceiling
  derived from a fresh best ask.
- `SELL BASE-QUOTE`: exact `base_size`, funded by held `BASE`, limit floor
  derived from a fresh best bid.
- Order type: price-bounded `SOR_LIMIT_IOC`; partial fill explicitly allowed;
  one use; 30–600 second authorization window.
- Pair and product limits are discovered at runtime. Require an exact online,
  enabled, non-view-only Coinbase `SPOT` product and honor its increments and
  min/max sizes. Never use a static asset allowlist or pair count.
- BUY requires a maximum quote debit and commission cap. SELL requires a
  minimum net quote-proceeds floor and commission cap.

Recognize but reject transfers, withdrawals, sends, conversions, portfolio
fund moves, staking, onchain swaps, derivatives, leverage, stop/bracket/GTC/
TWAP/scaled orders, recurring actions, balance-relative sizing, and any
conversion of a different held asset. Do not coerce them into a spot order.

The 5-USDC `ETH-USDC BUY` profile is only a future live-test safety control. It
does not limit generic planning, simulation, or View-only Preview and must not
be used as the product narrative.

## Draft and authorize

Preserve the user's text verbatim. A complete request must state one exact
pair, BUY or SELL, exact side-correct size and asset, IOC/partial-fill choice,
side-correct slippage reference, commission bound, settlement bound, one use,
and expiry. Do not invent defaults.

Run:

```sh
"$GUARD_RUN" plan \
  --intent-file <absolute-request-path> \
  --compiler deterministic
```

For `NEEDS_CLARIFICATION` or `UNSUPPORTED`, return every issue and stop. For
`AWAITING_HUMAN_CONFIRMATION`, return directly in chat:

- source request and digest;
- canonical action descriptor and descriptor digest;
- complete policy and policy digest;
- funding asset/required balance;
- price reference, slippage, fee, settlement, validity, and one-use terms; and
- `CREATE_ENABLED=false`.

Then pause. Only a new user-authored message naming the exact displayed policy
digest authorizes the draft. The harness compares digests but cannot
authenticate who typed the message. Never confirm on the user's behalf.

## Credential-free end-to-end simulation

After exact policy confirmation:

```sh
"$GUARD_RUN" simulate \
  --plan <absolute-plan-path> \
  --confirm-policy <authorized-policy-digest>
```

Return every emitted result in chat, including policy, authorization digest,
canonical action, funding evidence, proposal, Preview fixture, proposal and
Preview decisions, Delta `PASS|BLOCK|REVIEW`, receipt, proof presence/digest,
exact-PASS gate, and simulated execution result.

Always state:

- `SIMULATION_ONLY`;
- Coinbase and production Delta were not contacted;
- the receipt/signature/proof are simulated contract artifacts;
- Coinbase Create was not invoked and no money moved.

Only verified `PASS` for the exact descriptor, payload, Preview, funding
evidence, portfolio, and credential digests can reach the one-use simulated
gate. A structured retryable `BLOCK` may be retried only within the
controller's fixed budget using fresh evidence and a fresh candidate.
`REVIEW`, expiry, missing proof, or a digest mismatch stops locked.

## Optional real Coinbase reads and Preview

Use a separate View-only CDP key: `can_view=true`, `can_trade=false`, and
`can_transfer=false`. Coinbase's documented permission response omits a
separate `can_receive`; accept that documented shape, but reject an explicitly
true extension if returned. Keep the key JSON outside the repository, mode
`0600`, and pass only its absolute path. Never request, print, paste, or copy
the secret.

```sh
"$GUARD_RUN" configure-preview-credentials \
  --key-file <absolute-view-key-path>
```

Bind using `--credential-role preview`, display the portfolio fingerprint and
execution digest, then require another new user-authored message naming that
digest before recording one immutable confirmation receipt:

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

The trusted host, not the model, must normalize and bind List Accounts,
Get/List Product, best bid/ask, and Preview responses. A Preview warning is
`REVIEW`; errors, stale/malformed data, insufficient held funds, product
restrictions, or constraint failures are `BLOCK`.

`PREVIEW_PROBE_PASS` is not a Delta PASS and cannot release an order.

## Coinbase MCP topology

Coinbase publicly documents local CLI/MCP tools for product reads, balance,
and `orders_preview`, but the standard namespace also advertises mutating
tools such as `orders_create`, transfer, and conversion.

Do not give the planning agent that unrestricted namespace with a Trade key.
Use one of these safe host-controlled topologies:

1. an allowlisted proxy exposing only `products_list`, `products_get`,
   `products_ticker`/book, `balance`, and `orders_preview`, backed by the
   View-only key; or
2. the harness's direct trusted read/Preview adapter, also View-only.

The future View+Trade executor key must be isolated from the agent and MCP
context. The external controller alone may possess it after private Delta
adapter validation, one-time grant storage, and a separately authorized live
test. Public v1.3's compile-time Create seam remains locked.

## Conditional partner showcase

The separate fixed ETH showcase remains available only when the user asks for
the partner demo:

```sh
"$GUARD_RUN" coinbase-demo --no-artifacts
```

Follow [showcase-response.md](references/showcase-response.md). It illustrates
a $3,000 conditional allocation with `BLOCK → RETRY → PASS`, bound receipts,
and one simulated eligibility. It is not the generic compiler, a live
conditional-order feature, Coinbase data, or production Delta.

## Report in Codex

Always keep the important result in chat. Return:

1. action classification and supported/unsupported status;
2. closed policy, canonical action, and exact authorization digest;
3. trusted funding/product/market/Preview provenance;
4. proposal and exact Coinbase payload digest;
5. `PASS`, `BLOCK`, or `REVIEW`, all failures, receipt and proof status;
6. controller disposition and retry budget; and
7. `COINBASE_CREATE_INVOKED=false`, `MONEY_MOVED=false`, plus the next safe
   step.

Do not expose raw account IDs, portfolio labels, credentials, headers, private
responses, or home-directory paths. Artifacts are secondary; the Codex
conversation is the user experience.
