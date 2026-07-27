---
name: delta-coinbase-guard
description: Turn a one-off natural-language Coinbase Advanced Trade request into a closed reviewable policy, pause for exact digest confirmation, safely simulate the mandate-gated flow, run a labeled conditional-allocation partner showcase, or run a credentialed Coinbase Preview probe that cannot create an order. Use for Coinbase spot trade planning, policy review, credential-free demonstrations, Preview compatibility checks, and tests of the delta-to-Coinbase boundary. The public V1 never executes trades and must not be used for transfers, withdrawals, sends, conversions, leverage, derivatives, recurring trades, live conditional actions, or long-running strategies.
---

# Delta Coinbase Guard V1

Use the repository harness for every policy, confirmation, Preview, and
decision transition. Never recreate the enforcement logic in chat.

Invoke this workflow explicitly as `$delta-coinbase-guard`.

## Initialize

1. Resolve the executable `scripts/run` relative to this `SKILL.md` and keep
   its absolute path as `GUARD_RUN`. Do not search for or substitute another
   checkout.
2. Verify that `GUARD_RUN` is executable. It resolves the installed skill link
   back to the complete, matching repository harness.
3. Read [workflow.md](references/workflow.md).
4. For the conditional partner showcase, also read and follow
   [showcase-response.md](references/showcase-response.md).
5. Before accepting a credential path or calling Coinbase, also read
   [security-boundary.md](references/security-boundary.md).
6. Run `"$GUARD_RUN" doctor` before the first workflow in a checkout.

If the wrapper or complete checkout is unavailable, ask the user to install
the repository with its root `install` script. Do not clone, edit another
repository, or bypass the harness unless the user explicitly asks.

## Respect the V1 boundary

Choose one workflow:

- Policy draft or demo: **plan → policy confirmation → simulate**.
- Conditional-allocation partner showcase: **showcase fixture → BLOCK/RETRY
  receipt → revised exact proposal → PASS receipt → simulated eligibility**.
- Coinbase API compatibility check: **plan → policy confirmation → bind →
  execution confirmation receipt → probe**.

The public V1 is compile-time hard-disabled for Coinbase Create. It has no
runtime adapter path, environment variable, or flag that can enable execution.
If the user requests a real trade, explain that engineering integration is
required. Do not silently substitute a simulation or Preview probe; obtain a
separate user instruction before doing either.

The supported request is one `ETH-USDC` spot `BUY` for the exact amount the
user authorizes, up to `5 USDC`, using a quote-sized SOR limit IOC with at most
`50 bps` slippage, `0.50 USDC` commission, `5.50 USDC` all-in debit, a
120-second execution-confirmation window, and one use. Do not convert a maximum
into an exact spend or silently narrow a different request. These limits are a
safety ceiling, not defaults: if the user's source request omits any material
cap or term, let `plan` request clarification rather than filling it.

The partner showcase is a separate, credential-free presentation mode. It is
not a live conditional-order feature and does not expand the public V1 safety
profile. Use it only when the user explicitly asks for a simulation,
showcase, or partner demo of a conditional ETH allocation. Run:

```sh
"$GUARD_RUN" coinbase-demo --no-artifacts
```

The checked-in fixture represents a user mandate to allocate up to 3,000 USDC
to ETH only at or below 3,000 USDC, with a 35 bps slippage cap, 15 USDC fee
cap, 10,000 USDC post-trade exposure cap, fifteen-minute expiry, and one
execution. The first proposal intentionally violates the allocation, price,
slippage, fee, and exposure constraints. The external controller retries once
against a new labeled evidence fixture; the agent revises the exact proposal
but does not author market, Preview, or portfolio evidence. Report the first
evaluator `BLOCK` receipt followed by controller `RETRY`, the second evaluator
`PASS` receipt followed by controller `EXECUTE`, and equality between the
passed proposal and evidence digests and the simulated gate digests.

Always label every market, fee, exposure, delta decision, receipt, and
execution result in this showcase as fixture-based simulation. Coinbase and
production delta are not contacted, Coinbase Create is not invoked, and no
money moves. Do not use the future 5-USDC live-test ceiling as the economic
story; mention it only when discussing credentialed setup or future live-test
safety.

## Plan and review

Preserve the user's source text verbatim. Prefer an absolute intent-file path:

```sh
"$GUARD_RUN" plan \
  --intent-file <absolute-request-path> \
  --compiler deterministic
```

Use `--intent` only through a tool API that passes an argv array without a
shell. Use `--compiler openai` only when the user requests it and an approved
secret mechanism already provides `OPENAI_API_KEY`.

After `plan`:

- For `NEEDS_CLARIFICATION` or `UNSUPPORTED`, show every issue and stop. Ask for
  one complete replacement instruction; do not fill or merge terms.
- For `AWAITING_HUMAN_CONFIRMATION`, show the complete policy and digest.
- Pause until the calling host receives a new user-authored message naming the
  exact displayed digest.

The harness can compare digests; it cannot authenticate message authorship.
Never type, copy, or infer a confirmation on the user's behalf. Never treat the
source request, an earlier approval, silence, credentials, or an agent message
as authorization.

For a credential-free demonstration after policy confirmation:

```sh
"$GUARD_RUN" simulate \
  --plan <absolute-plan-path> \
  --confirm-policy <authorized-policy-digest>
```

Report `SIMULATION_ONLY`, the simulated result, and that Coinbase Create was
not invoked. Never describe the synthetic signature or proof as production
delta verification.

## Bind and probe Coinbase

Accept a Coinbase private key only by absolute local path. Never request or
display its contents. Require an isolated ECDSA/ES256 View+Trade key with
Transfer and Receive disabled.

Bind the confirmed policy:

```sh
"$GUARD_RUN" bind-execution \
  --plan <absolute-plan-path> \
  --confirm-policy <authorized-policy-digest> \
  --key-file <absolute-key-path>
```

Display the portfolio fingerprint and execution digest. Pause until the host
receives a new user-authored message naming that exact execution digest. Then
create one immutable receipt:

```sh
"$GUARD_RUN" confirm-execution \
  --bound-execution <absolute-bound-execution-path> \
  --confirm-execution <authorized-execution-digest> \
  --key-file <absolute-key-path>
```

The receipt fixes its confirmation and expiry timestamps. It cannot be
re-timestamped, and rerunning a probe cannot restart the 120-second window. If
it expires, stop and create a new bound execution plus a new user confirmation.

Use that same unexpired receipt for the non-executing probe:

```sh
"$GUARD_RUN" probe-execution \
  --bound-execution <absolute-bound-execution-path> \
  --confirmation-receipt <absolute-confirmation-receipt-path> \
  --key-file <absolute-key-path>
```

Report product, BBO, Preview, fee, amount, freshness, portfolio, and payload
checks. `PREVIEW_PROBE_PASS` means only that Preview and local checks passed.
It is not a Delta verdict, Coinbase order, or authorization to execute.

## Use alongside Coinbase MCP

Require every Coinbase tool visible to the model to be read-only. The model may
inspect products, balances, orders, and other View-permission data, but it must
not have tools that create, cancel, replace, transfer, send, withdraw, convert,
or otherwise move value.

If the tool schema advertises any mutating operation, do not test it. Stop with
`STOP_UNSAFE_TOOL_TOPOLOGY`, require the owner to remove the tool or replace
the credential/surface, rerun `"$GUARD_RUN" doctor`, and restart from `plan`.

## Report

Return:

- the exact source intent;
- the complete structured policy and displayed digest;
- whether the host obtained each new user-authored confirmation;
- the confirmation receipt expiry when applicable;
- simulation or Preview-probe status;
- Delta IDs, indexed failures, and verifier/proof presence only when emitted;
- whether Coinbase Create was reachable or invoked;
- sanitized artifact links; and
- the current blocker or next safe step.

For the conditional partner showcase, lead with the human mandate and then
separate the actors explicitly:

1. the agent proposed candidate one;
2. the simulated delta evaluator returned specific failures and a bound
   `BLOCK` receipt;
3. the external controller, not the model, allowed one retry;
4. the agent proposed candidate two;
5. the simulated evaluator returned `PASS` with a receipt bound to the exact
   payload digest; and
6. the controller marked only that canonical action and evidence eligible once
   in this simulated trace, while issuing no durable grant and leaving Coinbase
   Create unreachable.

Follow the six-section response contract in
[showcase-response.md](references/showcase-response.md) exactly. Its headings
are synchronized with the recording kit's six companion panels. Copy values
and full digests from harness output; never generate or abbreviate them.

Do not present the generated HTML report as a Coinbase or delta product UI.
The primary user experience is the Codex conversation. Use `--no-artifacts`
for the partner showcase so recording does not depend on filesystem access or
a separate report.

Never expose raw Coinbase or Delta responses, account identifiers, portfolio
labels, credential material, authorization headers, or local home-directory
paths. If the harness did not emit a sanitized artifact, report only its status
and blocker.

For an engineering handoff, point to the repository's
`docs/ENGINEERING-HANDOFF.md`. Production integration must replace
`src/integration/production-composition.js` in source with real delta Mandate
composition and isolated durable grant-store hooks; do not introduce a
runtime-loaded adapter module.
