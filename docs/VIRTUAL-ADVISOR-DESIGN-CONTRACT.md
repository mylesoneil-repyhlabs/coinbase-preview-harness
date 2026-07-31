# Delta Guard Advisor design contract

## Experience

The advisor should feel like a private consultation room: calm, precise, and
immediately useful. It must not resemble a generic dashboard, market terminal,
fake bank account, or co-branded Coinbase product.

The first screen is one concise natural-language composer and one primary
**Try a protected trade** start. A native **Explore** disclosure contains the
conditional check planner, BTC/ETH/SOL comparison, and allocation canvas.

Dry run is the implicit default. No credential wall appears before value.

## Information hierarchy

A persistent trust strip always answers:

```text
Mode: Dry run or View only
Connection: Not connected or View-only session
Orders: Off
```

The advisor conversation dominates. A contextual Delta rail shows the current
state, policy boundary, exact proposal, decision, freshness, and no-order
status. Primary destinations are limited to Advisor, Connection, and Activity;
condition and education planning open through the first-screen disclosure.

The user journey is:

```text
human instruction
  -> editable Mandate captured
  -> Confirm this protected check
  -> exact Proposal
  -> PASS / BLOCK / REVIEW
  -> impact + provenance + recovery
  -> receipt details on demand
```

Hashes, schemas, file paths, BBO/IOC/bps terminology, and normalized metadata
stay behind progressive disclosure or are translated into plain English.

## Decision language

- `PASS — Fits this mandate`
- `BLOCK — Does not fit this mandate`
- `REVIEW — Could not verify safely`

`PASS` never looks like a fill, submission, or trade confirmation.

`BLOCK` shows actual versus allowed and offers **Revise proposal** or
**Edit mandate**. `REVIEW` names the unavailable or stale fact and offers
**Refresh facts** or **Reconnect**. The app never silently retries,
substitutes a product, or changes the mandate.

## Credential consent

The control is **Connect Coinbase — View only**, never “Log in” or “OAuth”
unless a future verified OAuth flow is implemented.

Before input, the user sees:

- reads: permissions, balances, exact product, best market quote, and Preview;
- cannot do: Trade, Transfer, Create, submit, or move money;
- transit: the key exists briefly in the form, page JavaScript, and one
  same-origin loopback request;
- retention: no browser persistence; after receipt, server-process memory only;
- clearing: disconnect, expiry, process exit, or failed connection;
- limitation: Preview is point-in-time evidence, not execution or a price
  guarantee.

Local entry may use an external key file or an advanced paste flow. The paste
flow must disclose that browser and server memory cannot be cryptographically
zeroized, even though no storage API or persistence is used.

The open page receives a separate high-entropy session capability. It is held
only in page memory and sent as a header on stateful requests. No cookie is
issued or accepted as authority, and a page reload starts a fresh session.

## Conditional plans

Truthful states are `Ready for simulation authorization`,
`Authorized for simulation`, `Checking once`, `Condition not met`,
`Would trigger simulation`, `Blocked`, `Review`, `Expired`, `Superseded`, and
`Revoked`. Never use `Active`, `Watching`, `Triggered`, `Submitted`, or
`Monitoring` without a trusted durable executor.

The saved plan shows trigger, amount, cost limits, absolute expiry, one-shot
scope, revoke, and the resolved read-only browser timezone. Its absolute
expiry is derived from a fixed 1-hour, 24-hour, or 7-day duration; there is no
editable zone or ambiguous `datetime-local` input. A later authorization
separately shows the selected source and its 30–600-second one-use expiry.
Provenance is exactly one of **Generated fixture**, **Coinbase observed at
time**, or **Coinbase unavailable · unable to verify**.

When a proposal exists, the exact-proposal card shows order type, size, limit,
maximum fee, observed BBO reference, raw slippage ceiling/floor, and the
effective price bound after applying the absolute trigger. Its timeline ends:

```text
one fresh observation
  -> exact simulated proposal
  -> local Delta simulation + verified receipt
  -> execution locked / no order submitted
```

The long-wait action cancels the one-check attempt on the local server; it does
not merely hide a browser request. A confirmed cancellation consumes the
grant and discards late results. If the result completed first, the completed
result is shown with that explanation. A separate generic **Stop waiting**
action must say that local work may still finish.

## Research and portfolio planning

The implemented surface is a neutral **market snapshot** and allocation
canvas, not token research or a recommendation engine. It starts blank:
no planning amount, asset, weight, scenario attribution, trade side, or
handoff leg is selected for the user. An optional generated mechanical example
is explicitly labeled not a recommendation and does nothing until the user
reviews the inputs.

Market source is an explicit choice between **Generated fixture** and one
fresh connected View-only product/BBO check. There is no silent fallback.
Every edit refreshes the entire selected product set from that same source;
adding an asset, retrying after a provider failure, or editing after expiry
never reuses the earlier incomplete or stale snapshot.
Presentation keeps provenance separate:

- `Generated fixture` or `Coinbase observed` for market facts;
- `Locally curated summary of primary source` for the checked-in educational
  paraphrase, publisher, catalog review date, content digest, and canonical
  source link;
- `Calculated locally` for concentration and scenario arithmetic;
- `User supplied` for selected allocations and scenario assumptions only
  after explicit acknowledgement, including any chosen zero values.

It exposes assumptions, uncertainty, liquidity and volatility risk,
concentration, and scenario inputs. It must not say “recommended for you,”
calculate suitability, promise returns, rank assets, or auto-optimize into a
trade.

Portfolio plans are editable planning objects. Converting a selected leg
requires an explicit choice of exactly one leg and `BUY` or `SELL`, then
creates a new editable one-action draft. Fee, slippage, and expiry suggestions
are visibly **Editable Guard defaults**, not inherited constraints. The draft
is not authorized, preflighted, Delta-evaluated, or eligible for execution;
the Advisor requires fresh mandate preparation, evidence, and separate human
authorization.

The visible terminal language is
`PLAN VALID FOR EDITING · NO TRADE AUTHORIZED` followed, only after explicit
handoff, by `DRAFT CREATED · NOT AUTHORIZED · ORDERS OFF`. There is no
portfolio-wide authorization, batch/rebalance path, implicit first-leg
selection, or automatic advisor mutation.

## Locked what-remains explanation

Only a fresh, complete View-only `PASS` with a verified, unexpired local
receipt may render a neutral **What remains** disclosure. Decision remains the
terminal state. The disclosure appears after `No order submitted`, before
technical receipt details, and is driven only by the server DTO plus the
enabled `live_readiness_preview` capability. The browser never derives it
from a client-observed `PASS`.

The information hierarchy is:

1. `WHAT REMAINS · LOCKED` and `ORDERS OFF`;
2. “This point-in-time View-only PASS is not authorization, eligibility, or
   readiness to trade”;
3. exact action and limit, estimated economics, and Preview check/expiry;
4. future one-order concept with no challenge or grant;
5. all nine missing production controls, each visibly marked `Missing`; and
6. “There is no final-confirmation, grant, or order route.”

The card has no button, link, input, positive `tabindex`, Trade-key field,
raw identifier, or Create bytes. It stacks its facts and checklist at mobile
width. A dry run, `BLOCK`, `REVIEW`, expired result, incomplete binding, or
tampered result never renders the disclosure or advances beyond Decision. The
server also requires
a valid sealed-record digest, exact supplied-versus-bound execution digest,
and receipt-bound View-only permission facts; none of those permission facts
or credential identifiers enter the card.

## Visual system

- Canvas: warm paper `#f4f1e8`
- Surface: soft ivory `#fffdf7`
- Primary ink: deep navy `#15233b`
- Secondary ink: slate `#5e6a7d`
- Trust/action: muted cobalt `#3157d5`
- Delta accent: teal `#1f8a70`
- Review: amber `#9a6412`
- Block: coral `#b84f4f`
- Hairline: translucent navy

Typography uses a local system stack. No remote font, third-party script,
analytics pixel, or decorative market feed is allowed.

The moment of delight is the user’s sentence resolving into an enforceable
mandate. Motion is subtle, interruptible, and removed under
`prefers-reduced-motion`.

## Responsive and accessible

- Desktop: approximately 60% conversation, 40% Delta context.
- Mobile: single column with sticky mode/boundary and one-check action.
- Minimum 44-pixel targets and visible keyboard focus.
- WCAG AA contrast, semantic headings, labels, and landmarks.
- Color is always paired with icon and text.
- Progress and decisions use `aria-live`.
- No hover-only action, horizontal mandate table, or focus trap.
- Support 320-pixel width and 200% zoom.
- Progress appears inside two seconds; after five seconds show the current
  check and a recovery/cancel option.

## Synthetic review status

The initial design input is a clearly labelled synthetic composite review,
not customer evidence. It prioritizes a one-minute credential-free dry run,
the editable mandate as the trust moment, a comprehensible View-only consent
screen, and an explicit “No order placed” line on every result.
