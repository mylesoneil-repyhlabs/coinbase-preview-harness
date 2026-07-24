---
name: delta-coinbase-guard
description: Turn a one-off natural-language Coinbase Advanced Trade request into a closed reviewable policy, pause for exact digest confirmation, safely simulate the mandate-gated flow, or run a credentialed Coinbase Preview probe that cannot create an order. Use for Coinbase spot trade planning, policy review, credential-free demonstrations, Preview compatibility checks, and tests of the delta-to-Coinbase boundary. The public V1 never executes trades and must not be used for transfers, withdrawals, sends, conversions, leverage, derivatives, recurring trades, conditional actions, or long-running strategies.
---

# Delta Coinbase Guard V1

Use the repository harness for every policy, confirmation, Preview, and
decision transition. Never recreate the enforcement logic in chat.

Invoke this workflow explicitly as `$delta-coinbase-guard`.

## Initialize

1. Resolve `scripts/run` relative to this `SKILL.md` and keep its absolute path
   as `GUARD_RUN`. Do not search for or substitute another checkout.
2. Verify that `GUARD_RUN` is executable. It resolves the installed skill link
   back to the complete, matching repository harness.
3. Read [workflow.md](references/workflow.md).
4. Before accepting a credential path or calling Coinbase, also read
   [security-boundary.md](references/security-boundary.md).
5. Run `"$GUARD_RUN" doctor` before the first workflow in a checkout.

If the wrapper or complete checkout is unavailable, ask the user to install
the repository with its root `install` script. Do not clone, edit another
repository, or bypass the harness unless the user explicitly asks.

## Respect the V1 boundary

Choose one workflow:

- Policy draft or demo: **plan → policy confirmation → simulate**.
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

Never expose raw Coinbase or Delta responses, account identifiers, portfolio
labels, credential material, authorization headers, or local home-directory
paths. If the harness did not emit a sanitized artifact, report only its status
and blocker.

For an engineering handoff, point to the repository's
`docs/ENGINEERING-HANDOFF.md`. Production integration must replace
`src/integration/production-composition.js` in source with real delta Mandate
composition and isolated durable grant-store hooks; do not introduce a
runtime-loaded adapter module.
