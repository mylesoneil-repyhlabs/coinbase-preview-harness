# Delta Guard Advisor v1.6 demo

This is the shortest truthful path through the actual local product. It uses
generated facts, no credential, no Coinbase network call, no private Delta,
and no order.

## Start

From an installed release or checkout:

```sh
./run advisor
```

Open the loopback URL printed by the launcher. The default is
`http://127.0.0.1:4173`.

The persistent safety bar must say that the default is a dry run, Coinbase is
off unless the user explicitly connects View-only data, and orders are off.

[Open the credential-free v1.6 first-run capture](https://raw.githubusercontent.com/mylesoneil-repyhlabs/coinbase-preview-harness/v1.6.0/docs/images/advisor-v1.6/01-first-run.png).
It is generated from the actual loopback Advisor by
`pnpm visuals`, contains no credential, and is kept in the repository rather
than the text-only release archive.

## Primary protected-trade path

1. Choose **Try a protected trade**.
2. Use the complete ETH example or replace it with one supported Coinbase
   Advanced spot BUY or SELL request.
3. Choose **Prepare mandate**.
4. Read the compact mandate in this order: Action, Maximum or exact amount,
   Trigger, Expiry, protections, funding.
5. Choose **Confirm this protected check**.
6. Read the exact proposal, `PASS`, `BLOCK`, or `REVIEW`, one plain-English
   reason, Observed versus Allowed comparison, evidence source/time, local
   receipt status, and **No order submitted**.

The decision is terminal. A read-only **What remains** disclosure may explain
future missing controls after an eligible View-only PASS, but it never advances
the product to confirmation and has no interactive order control.

### Recommended dry-run prompt

```text
Using held USDC, buy up to 3,000 USDC of ETH on ETH-USDC once with a
price-bounded IOC limit order and allow partial fills. Only if the fresh best
ask is at or below 3,000 USDC. Do not pay more than 35 bps above the fresh
best ask, more than 15 USDC in fees, or more than 3,015 USDC total. The
authorization expires 10 minutes after I confirm it.
```

### What to point out

- The agent expresses intent; deterministic Guard code compiles, validates,
  prices, decides, binds, and records.
- Confirmation covers one displayed mandate and one check, not an order.
- A verified violation is `BLOCK`; unavailable or stale evidence is `REVIEW`.
- Any proposal, Preview, evidence, payload, receipt, expiry, or replay mismatch
  invalidates the old decision.
- `PASS` cannot reach Coinbase Create because the route, Trade credential, and
  executor are absent.

## Deliberate BLOCK and REVIEW

Use the provided result controls or generated scenarios to show all three
meanings:

- `PASS` — exact proposal fits the mandate.
- `BLOCK` — verified proposal facts are outside the authorized boundary.
- `REVIEW` — current complete evidence cannot be verified; refresh or repair
  the source and run a new check.

Never describe provider failure as a policy block or a dry-run fixture as
Coinbase-observed.

## Conditional check planner

Open **Explore condition checks and educational planning**, then choose the
conditional planner.

1. Review the Action / If / Limits / Until ribbon.
2. Choose fixture or View-only source explicitly.
3. Save the non-executable plan and authorize one 30–600 second simulation
   check.
4. Rehearse condition-not-met, blocked, passed, and unable-to-verify outcomes.
5. Inspect the exact proposal and three-price explanation: observed BBO, raw
   slippage bound, and effective bound after intersecting the absolute
   condition.
6. Revoke to demonstrate the irreversible session tombstone.

Always keep this line visible:

```text
Simulation only · nothing is watching · orders off
```

## Educational planning

Open the same **Explore** disclosure and choose educational planning.

1. Start from the blank canvas, or deliberately load the mechanical example
   labeled not a recommendation.
2. Select BTC, ETH, or SOL, enter weights, and explicitly acknowledge scenario
   assumptions.
3. Choose generated fixture or connected View-only market source.
4. Inspect separate provenance for market facts, locally curated summaries,
   local calculations, and user inputs.
5. Select exactly one leg and explicit BUY or SELL to create a new editable
   draft.
6. Return to the Advisor and review that draft as a new mandate.

The handoff is not authorization. It performs no Preview or Guard decision and
cannot submit a portfolio, batch, rebalance, or automatic trade.

## Optional View-only connection

Do not use or reveal a real key in a public recording. For a private local
check, the user may open **Connection** and provide a dedicated normal-user
CDP ECDSA key with View on and Trade, Transfer, and Receive off.

The interface must explain:

- material exists briefly in the form, page JavaScript, and one loopback
  request;
- after receipt it is retained only in server-process memory;
- it is never stored in browser storage, a URL, logs, analytics, history, or
  the repository;
- disconnect, idle expiry, absolute expiry, failure, or server exit clears the
  server reference; and
- JavaScript strings cannot be promised cryptographic zeroization.

View-only may read permissions, balances, exact product, BBO, and Preview for
the protected-trade flow. It cannot Create an order.

## Recording checklist

- Record the real local Advisor, not a screenshot mock.
- Keep the first composer and primary path visible without scrolling on the
  target viewport.
- Show 320-pixel reflow, keyboard focus, and no clipped PASS artifact.
- Keep **No order submitted** above technical receipt detail.
- Show conditional and education only through progressive disclosure.
- Never show a credential, key path, account identifier, raw Coinbase body,
  receipt internals, or personal browser data.
- Never claim Coinbase partnership, production Delta, autonomous trading,
  financial advice, a live confirmation, order submission, fill, or price
  guarantee.
