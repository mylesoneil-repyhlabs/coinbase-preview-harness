---
name: delta-coinbase-guard
description: Turn a natural-language Coinbase Advanced spot BUY or SELL into a closed, reviewable mandate; ask only for missing material constraints; wait for explicit authorization; and run one protected credential-free dry run or optional ephemeral View-only Coinbase preflight. Use for chat-native Coinbase spot planning, mandate verification, PASS/BLOCK/REVIEW explanations, local receipts, and dry-run history. Coinbase Create and all money movement are unavailable.
---

# Delta Coinbase Guard v1.6

When `$delta-coinbase-guard` is invoked, keep the experience chat-native and
start with the protected dry-run path unless the user explicitly chooses
View-only facts.

v1.6 also ships the local Delta Guard Advisor through `./run advisor`. Do not
open it during the ordinary chat-native flow. Mention or launch it only when
the user explicitly asks for the visual local product.

Use the installed harness for policy compilation, canonicalization, evidence
checks, arithmetic, decisions, receipts, replay handling, and history. Limit
model work to extracting the user's words, asking clarifying questions, and
explaining deterministic output. Never recreate guard logic in chat.

Keep the ordinary experience inside the conversation. Do not open a browser.
Do not show raw payloads or expose hashes and local paths unless the user asks.

## Start simply

Resolve `scripts/run` relative to this file as the absolute `GUARD_RUN` path.
Run `"$GUARD_RUN" doctor` quietly before the first plan.

If the user has not supplied an intent, say:

> You can try a protected Coinbase spot-trade dry run with no credential, or
> optionally use a View-only Coinbase key to check current balances, the exact
> product, market data, and Preview. No order can be sent. What BUY or SELL do
> you want?

Dry run is the default: a credential-free dry run and optional View-only facts
are the two available modes. If the user already supplied an intent,
acknowledge the no-order boundary briefly and begin; do not ask them to choose
a mode.

If doctor fails, stop and ask the user to reinstall the verified v1.6 release.
Read [workflow.md](references/workflow.md) before planning. Read
[security-boundary.md](references/security-boundary.md) before accepting a
View-only key path or explaining proof.

## Keep scope closed

Support one Coinbase Advanced custodial `SPOT` action:

- BUY one exact `BASE-QUOTE` pair using held `QUOTE`, with exact or maximum
  quote size.
- SELL one exact `BASE-QUOTE` pair using held `BASE`, with exact or maximum
  base size.
- One price-bounded SOR limit IOC attempt, an explicit partial-fill choice,
  side-correct slippage, commission and debit/proceeds bounds, one use, a
  30–600 second expiry, and optionally one absolute best-ask/best-bid
  condition.

Do not translate transfers, sends, withdrawals, conversions, staking, swaps,
derivatives, leverage, resting orders, recurring strategies, background
monitoring, balance-relative sizing, or multi-leg actions into a spot order.

## Capture the mandate

Preserve the user's text and accumulated clarifications verbatim in an
owner-only temporary intent file. Use a safe file-writing operation; never
interpolate user text into a shell command. Run:

```sh
"$GUARD_RUN" plan --intent-file <absolute-private-intent-path> --compiler deterministic --json
```

Treat the returned plan path and policy digest as private workflow state. The
skill keeps the saved exact policy digest internally.

- For `NEEDS_CLARIFICATION`, translate only the unresolved material issues
  into one short question. Preserve known facts, do not repeat answered
  questions, do not ask for configuration, and do not invent defaults. Append
  the answer to the preserved intent and plan again.
- For `UNSUPPORTED`, state the unsupported action or constraint and stop. Never
  substitute another product, pair, side, asset, order type, or amount.
- For `AWAITING_HUMAN_CONFIRMATION`, display this compact hierarchy:

```text
Mandate captured
<one plain-English sentence containing the exact side, pair, sizing,
condition, price/order behavior, fee and settlement bounds, expiry and one use>

Dry run is ready. No Coinbase order can be sent.
Reply “Authorize this mandate” to check this exact policy.
```

Do not show the policy digest, plan path, canonical JSON, or descriptor digest
by default. Pause. The initial request is not authorization; neither are
silence, possession of a credential, or agent-authored text.

Only a new user-authored `Authorize this mandate` message authorizes the most
recent unchanged mandate. If the user changes any term, compile and display a
new mandate first. The harness checks the exact saved policy digest
internally; it does not authenticate who typed the chat message.

## Run one preflight

After authorization, generate and retain one opaque retry nonce in workflow
state. Run exactly one ordinary command:

```sh
"$GUARD_RUN" preflight \
  --plan <saved-plan-path> \
  --confirm-policy <saved-policy-digest> \
  --nonce <opaque-retry-nonce>
```

If the user explicitly chose View-only preflight, add:

```sh
--view-key-file <absolute-external-key-path>
```

Never use the legacy configure/bind/confirm/probe sequence for this experience.
Do not call Coinbase MCP, Create, execute, or reconcile.

For View-only mode, first state that this one session reads only permission
status, balances, the exact product, BBO, and Preview. Ask for an absolute path
to an external owner-only View key file—never the credential text.
Do not persist a key or permission attestation. Reject Trade or Transfer
authority and any explicitly reported Receive authority. The documented
permission response currently omits Receive, so require it disabled in setup
but never claim an omitted value was API-verified.

Return the harness's compact result directly:

1. mode banner: `DRY RUN` or `VIEW ONLY`, plus no-order status;
2. human mandate;
3. exact proposal;
4. `PASS`, `BLOCK`, or `REVIEW` and one plain-English reason;
5. compact impact and evidence freshness/provenance;
6. recovery action when needed; and
7. execution boundary and local-receipt status.

Keep additional failures, hashes, normalized metadata, and private artifact
paths behind an explicit details request. Read the matching owner-only report
and show only what was requested; do not rerun a View-only Preview merely to
display details.

Explain decisions precisely:

- Dry-run `PASS` means labeled fixtures satisfied deterministic checks and the
  local simulated Delta contract. Coinbase and production Delta were not
  contacted. Simulated eligibility is not an execution grant.
- View-only `PASS` means held funds, product availability, fresh BBO, and
  Coinbase Preview matched the exact proposal. It is not a Delta authorization,
  execution, fill, or price guarantee.
- `BLOCK` means verified facts violated the mandate. The proposal stays locked.
- `REVIEW` means the guard could not obtain fresh, complete, matching evidence.
  It is not a policy failure; follow the emitted recovery action and fail
  closed.

Always end with the accurate mode-specific boundary: no Coinbase Create, no
order submitted, no external executor, and no money moved.

## Retry and history

Reuse the nonce only after an interrupted identical command. Exact nonce plus
identical semantics may return the prior result. View-only retry rechecks key
permissions but does not reread account, product, BBO, or Preview evidence;
nonce reuse with changed semantics must fail closed. A new evidence attempt
uses a new nonce and must not reuse an old receipt.

On request, run `"$GUARD_RUN" history --limit <1-100>`. Explain that history is
local, bounded, redacted, and contains no credential or raw Coinbase response.
Run `history --clear` only after a new, explicit user confirmation to delete
the local history. Never treat history as fresh evidence.

## Optional fixed showcase

Use `"$GUARD_RUN" coinbase-demo --no-artifacts` only when the user explicitly
asks for the fixed conditional `BLOCK → RETRY → PASS` presentation fixture.
Then read [showcase-response.md](references/showcase-response.md). It is not
the ordinary protected-check path, live Coinbase data, or production Delta.
